package com.example.service

import android.content.Context
import android.content.Intent
import android.os.SystemClock

/**
 * In-process coordination between the command dispatcher (DeviceRepository),
 * the visible consent UI (CaptureConsentActivity) and the capture foreground
 * service (ScreenCaptureService).
 *
 * Consent model: every screenshot / photo / screen-recording command stores a
 * pending request and posts a visible notification. Nothing is captured until
 * the device user explicitly taps "Allow" in the system consent dialog. If the
 * request is not answered within [TIMEOUT_MS], it fails truthfully.
 */
data class PendingCapture(
    val commandId: String,
    val mode: String, // MODE_SCREENSHOT | MODE_RECORD_START | MODE_PHOTO
    val requestedAt: Long = SystemClock.elapsedRealtime()
) {
    fun ageMs(): Long = SystemClock.elapsedRealtime() - requestedAt
}

object CaptureCoordinator {
    const val MODE_SCREENSHOT = "SCREENSHOT"
    const val MODE_RECORD_START = "RECORD_START"
    const val MODE_PHOTO = "PHOTO"

    const val TIMEOUT_MS = 120_000L // 2 minutes to answer the consent UI

    @Volatile
    var pending: PendingCapture? = null

    @Volatile
    var activeRecordingCommandId: String? = null

    fun startPending(commandId: String, mode: String): PendingCapture {
        val p = PendingCapture(commandId, mode)
        pending = p
        return p
    }

    fun takePending(commandId: String): PendingCapture? {
        val p = pending
        if (p != null && p.commandId == commandId) {
            pending = null
            return p
        }
        return null
    }

    fun clearIfStale(): PendingCapture? {
        val p = pending ?: return null
        return if (p.ageMs() > TIMEOUT_MS) {
            pending = null
            p
        } else {
            null
        }
    }

    /** Intent extras shared between the consent activity and the service. */
    const val EXTRA_COMMAND_ID = "extra_command_id"
    const val EXTRA_MODE = "extra_mode"
    const val EXTRA_RESULT_CODE = "extra_result_code"
    const val EXTRA_RESULT_DATA = "extra_result_data"

    const val ACTION_SCREENSHOT = "com.example.service.action.SCREENSHOT"
    const val ACTION_RECORD_START = "com.example.service.action.RECORD_START"
    const val ACTION_RECORD_STOP = "com.example.service.action.RECORD_STOP"

    fun buildServiceIntent(
        context: Context,
        action: String,
        commandId: String,
        mode: String,
        resultCode: Int,
        resultData: Intent?
    ): Intent {
        return Intent(context, ScreenCaptureService::class.java).apply {
            this.action = action
            putExtra(EXTRA_COMMAND_ID, commandId)
            putExtra(EXTRA_MODE, mode)
            putExtra(EXTRA_RESULT_CODE, resultCode)
            putExtra(EXTRA_RESULT_DATA, resultData)
        }
    }
}
