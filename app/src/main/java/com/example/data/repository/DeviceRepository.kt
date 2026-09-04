package com.example.data.repository

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

class DeviceRepository(
    private val context: Context,
    private val database: AppDatabase,
    val preferenceManager: PreferenceManager,
    private val apiClient: ApiClient,
    val webSocketManager: DeviceWebSocketManager
) {
    private val scope = CoroutineScope(Dispatchers.IO + Job())

    val telemetryCollector = TelemetryCollector(context, preferenceManager)
    val locationHelper = LocationHelper(context, preferenceManager)
    val appInventoryHelper = AppInventoryHelper(context)
    val usageStatsHelper = UsageStatsHelper(context)
    val permissionsHelper = PermissionsHelper(context)
    val audioRecorderHelper = AudioRecorderHelper(context)

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
            preferenceManager.setServerUrl(serverUrl)
            val request = PairingRequest(
                pairingCode = pairingCode.trim(),
                deviceName = preferenceManager.getDeviceName(),
                manufacturer = Build.MANUFACTURER,
                model = Build.MODEL,
                osVersion = Build.VERSION.RELEASE
            )

            val service = apiClient.getService()
            val response = service.pairDevice(request)

            if (response.isSuccessful && response.body()?.success == true) {
                val body = response.body()!!
                preferenceManager.setAuthToken(body.token)
                body.deviceId?.let { preferenceManager.setPaired(true) }
                preferenceManager.setPaired(true)

                // Start Foreground Service & WebSocket
                startManagementService()
                webSocketManager.connect()

                // Initial sync
                syncTelemetry()
                syncPermissions()

                Result.success("Device paired successfully!")
            } else {
                val errorMsg = response.body()?.message ?: "Pairing failed (${response.code()})"
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun startManagementService() {
        try {
            val intent = Intent(context, DeviceManagementService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        } catch (e: Exception) {
            Log.e("DeviceRepository", "Failed to start foreground service", e)
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
        // Log in Room
        database.commandDao().insertOrUpdate(
            CommandEntity(
                commandId = command.commandId,
                deviceId = command.deviceId,
                commandType = command.commandType,
                parametersJson = null,
                status = "RUNNING",
                result = null,
                errorMessage = null,
                timestamp = command.timestamp,
                completionTimestamp = null
            )
        )

        webSocketManager.sendCommandStatus(command.commandId, "RUNNING")

        try {
            when (command.commandType.uppercase()) {
                "REQUEST_INFO", "SYNC_DEVICE" -> {
                    syncTelemetry()
                    syncPermissions()
                    reportCommandSuccess(command.commandId, "Device telemetry and permissions synchronized")
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
                "REQUEST_APPS" -> {
                    syncAppInventory()
                    val count = appInventoryHelper.getInstalledApplications().size
                    reportCommandSuccess(command.commandId, "$count applications inventoried and synced")
                }
                "REQUEST_USAGE" -> {
                    syncUsageStats()
                    reportCommandSuccess(command.commandId, "Usage statistics synchronized")
                }
                "SEND_NOTIFICATION" -> {
                    val title = command.parameters?.get("title") ?: "Administrator Notification"
                    val message = command.parameters?.get("message") ?: "Notice from management dashboard"
                    showAdminAlertNotification(title, message)
                    reportCommandSuccess(command.commandId, "Notification displayed on device")
                }
                "START_RECORDING" -> {
                    val file = audioRecorderHelper.startRecording()
                    if (file != null) {
                        reportCommandSuccess(command.commandId, "Recording started")
                    } else {
                        reportCommandFailure(command.commandId, "Failed to start recording. Check microphone permission.")
                    }
                }
                "STOP_RECORDING" -> {
                    val (file, duration) = audioRecorderHelper.stopRecording()
                    if (file != null && file.exists()) {
                        uploadRecordingFile(file, duration)
                        reportCommandSuccess(command.commandId, "Recording completed (${duration / 1000}s) and uploaded")
                    } else {
                        reportCommandFailure(command.commandId, "No active recording to stop")
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

    private suspend fun reportCommandSuccess(commandId: String, result: String) {
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

    private suspend fun reportCommandFailure(commandId: String, error: String) {
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
