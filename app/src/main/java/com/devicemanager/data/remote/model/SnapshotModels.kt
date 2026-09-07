package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Full device state snapshot data.
 * Collected by SnapshotCollector and sent to server.
 */
data class SnapshotData(
    @SerializedName("device_info") val deviceInfo: DeviceInfoSnapshot,
    @SerializedName("battery") val battery: BatterySnapshot,
    @SerializedName("storage") val storage: StorageSnapshot,
    @SerializedName("ram") val ram: RamSnapshot,
    @SerializedName("network") val network: NetworkSnapshot,
    @SerializedName("permissions") val permissions: Map<String, String>,
    @SerializedName("service_status") val serviceStatus: ServiceStatusSnapshot,
    @SerializedName("sync_state") val syncState: SyncStateSnapshot,
    @SerializedName("display") val display: DisplaySnapshot?,
    @SerializedName("connection") val connection: ConnectionSnapshot
)

data class DeviceInfoSnapshot(
    @SerializedName("name") val name: String?,
    @SerializedName("model") val model: String,
    @SerializedName("manufacturer") val manufacturer: String,
    @SerializedName("android_version") val androidVersion: String,
    @SerializedName("app_version") val appVersion: String
)

data class BatterySnapshot(
    @SerializedName("level") val level: Int,
    @SerializedName("charging") val charging: Boolean,
    @SerializedName("temperature") val temperature: Float,
    @SerializedName("health") val health: String
)

data class StorageSnapshot(
    @SerializedName("total") val total: Long,
    @SerializedName("used") val used: Long,
    @SerializedName("available") val available: Long
)

data class RamSnapshot(
    @SerializedName("total") val total: Long,
    @SerializedName("used") val used: Long,
    @SerializedName("available") val available: Long
)

data class NetworkSnapshot(
    @SerializedName("type") val type: String,
    @SerializedName("wifi_ssid") val wifiSsid: String?,
    @SerializedName("signal_strength") val signalStrength: Int?
)

data class ServiceStatusSnapshot(
    @SerializedName("foreground_service") val foregroundService: Boolean,
    @SerializedName("notification_listener") val notificationListener: Boolean,
    @SerializedName("accessibility") val accessibility: Boolean
)

data class SyncStateSnapshot(
    @SerializedName("last_telemetry_sync") val lastTelemetrySync: Long,
    @SerializedName("last_location_sync") val lastLocationSync: Long,
    @SerializedName("pending_queue_size") val pendingQueueSize: Int
)

data class DisplaySnapshot(
    @SerializedName("resolution_width") val resolutionWidth: Int,
    @SerializedName("resolution_height") val resolutionHeight: Int,
    @SerializedName("refresh_rate") val refreshRate: Float,
    @SerializedName("density") val density: Int,
    @SerializedName("orientation") val orientation: Int
)

data class ConnectionSnapshot(
    @SerializedName("ws_connected") val wsConnected: Boolean,
    @SerializedName("server_url") val serverUrl: String,
    @SerializedName("last_ping_ms") val lastPingMs: Long?
)

/**
 * Response from snapshot creation.
 */
data class SnapshotResponse(
    @SerializedName("id") val id: Int,
    @SerializedName("device_id") val deviceId: Int,
    @SerializedName("created_at") val createdAt: String
)
