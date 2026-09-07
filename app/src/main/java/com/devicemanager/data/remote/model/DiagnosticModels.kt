package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Device-side diagnostic check result.
 */
data class DiagnosticCheck(
    @SerializedName("name") val name: String,
    @SerializedName("status") val status: String,
    @SerializedName("message") val message: String,
    @SerializedName("details") val details: Map<String, Any>? = null,
    @SerializedName("duration_ms") val durationMs: Long
)

/**
 * Full diagnostic report from device.
 * Sent to server via RUN_DIAGNOSTICS command.
 */
data class DiagnosticReport(
    @SerializedName("device_id") val deviceId: String,
    @SerializedName("checks") val checks: List<DiagnosticCheck>,
    @SerializedName("overall_status") val overallStatus: String,
    @SerializedName("timestamp") val timestamp: String
)

/**
 * Diagnostic status constants.
 */
object DiagnosticStatus {
    const val PASS = "PASS"
    const val WARNING = "WARNING"
    const val FAIL = "FAIL"
}

/**
 * Diagnostic check name constants.
 */
object DiagnosticCheckName {
    const val LOCATION = "LOCATION"
    const val PERMISSIONS = "PERMISSIONS"
    const val BACKGROUND_SYNC = "BACKGROUND_SYNC"
    const val NETWORK = "NETWORK"
    const val WEBSOCKET = "WEBSOCKET"
    const val STORAGE = "STORAGE"
    const val BATTERY = "BATTERY"
    const val SCREEN_CAPTURE = "SCREEN_CAPTURE"
    const val NOTIFICATION_ACCESS = "NOTIFICATION_ACCESS"
    const val ACCESSIBILITY = "ACCESSIBILITY"
}
