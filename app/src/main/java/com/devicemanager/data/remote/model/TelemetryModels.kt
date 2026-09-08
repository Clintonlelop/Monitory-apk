package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Display information collected from DisplayManager + WindowManager.
 */
data class DisplayInfo(
    @SerializedName("resolution_width") val resolutionWidth: Int,
    @SerializedName("resolution_height") val resolutionHeight: Int,
    @SerializedName("refresh_rate") val refreshRate: Float,
    @SerializedName("current_mode") val currentMode: Float,
    @SerializedName("supported_rates") val supportedRates: List<Float>,
    @SerializedName("density_dpi") val densityDpi: Int,
    @SerializedName("orientation") val orientation: Int,
    @SerializedName("display_size_inches") val displaySizeInches: Float
)

/**
 * Performance metrics collected from /proc and system APIs.
 */
data class PerformanceData(
    @SerializedName("cpu_usage_pct") val cpuUsagePct: Float?,
    @SerializedName("app_memory_mb") val appMemoryMb: Float?,
    @SerializedName("uptime_seconds") val uptimeSeconds: Long?,
    @SerializedName("battery_health") val batteryHealth: String?,
    @SerializedName("cpu_freq_mhz") val cpuFreqMhz: Int?,
    @SerializedName("thermal_status") val thermalStatus: String?,
    @SerializedName("service_health") val serviceHealth: ServiceHealth?
)

/**
 * Service health indicators.
 */
data class ServiceHealth(
    @SerializedName("foreground") val foreground: Boolean,
    @SerializedName("notification_listener") val notificationListener: Boolean,
    @SerializedName("accessibility") val accessibility: Boolean
)

/**
 * Telemetry data request.
 * POST /api/telemetry
 */
data class TelemetryRequest(
    @SerializedName("battery") val battery: Int,
    @SerializedName("charging") val charging: Boolean,
    @SerializedName("battery_temp") val batteryTemp: Float,
    @SerializedName("network_type") val networkType: String,
    @SerializedName("wifi_ssid") val wifiSsid: String?,
    @SerializedName("storage_total") val storageTotal: Long,
    @SerializedName("storage_used") val storageUsed: Long,
    @SerializedName("ram_total") val ramTotal: Long,
    @SerializedName("ram_used") val ramUsed: Long,
    @SerializedName("display") val display: DisplayInfo? = null,
    @SerializedName("performance") val performance: PerformanceData? = null
)

/**
 * Telemetry data response.
 */
data class TelemetryResponse(
    @SerializedName("id") val id: String,
    @SerializedName("timestamp") val timestamp: String
)
