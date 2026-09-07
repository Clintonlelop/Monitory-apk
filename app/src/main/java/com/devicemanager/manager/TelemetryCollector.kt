package com.devicemanager.manager

import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import com.devicemanager.data.remote.model.DisplayInfo
import com.devicemanager.data.remote.model.PerformanceData
import com.devicemanager.data.remote.model.ServiceHealth
import com.devicemanager.data.remote.model.TelemetryRequest
import com.devicemanager.services.MainForegroundService
import com.devicemanager.services.NotificationListener
import com.devicemanager.services.RemoteInputService
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.BufferedReader
import java.io.FileReader
import kotlin.coroutines.resume

/**
 * Collects device telemetry: battery, network, WiFi, storage, and RAM.
 *
 * Battery: registers a BroadcastReceiver for ACTION_BATTERY_CHANGED.
 * Network: ConnectivityManager for active network type.
 * WiFi: WifiManager for SSID (requires location permission on Android 10+).
 * Storage: StatFs for total/available bytes.
 * RAM: ActivityManager.MemoryInfo for total/available.
 */
class TelemetryCollector(private val context: Context) {
    companion object {
        private const val TAG = "TelemetryCollector"
    }

    /**
     * Collect all telemetry data and return a TelemetryRequest.
     */
    suspend fun collect(): TelemetryRequest {
        val batteryInfo = getBatteryInfo()
        val networkInfo = getNetworkInfo()
        val storageInfo = getStorageInfo()
        val ramInfo = getRamInfo()
        val displayInfo = getDisplayInfo()
        val performance = getPerformanceData(batteryInfo.health)

        return TelemetryRequest(
            battery = batteryInfo.level,
            charging = batteryInfo.isCharging,
            batteryTemp = batteryInfo.temperature,
            networkType = networkInfo.type,
            wifiSsid = networkInfo.ssid,
            storageTotal = storageInfo.total,
            storageUsed = storageInfo.used,
            ramTotal = ramInfo.total,
            ramUsed = ramInfo.used,
            display = displayInfo,
            performance = performance
        )
    }

    // ── Battery ──────────────────────────────────────────────────────

    data class BatteryInfo(
        val level: Int,
        val isCharging: Boolean,
        val temperature: Float,
        val health: String
    )

    private suspend fun getBatteryInfo(): BatteryInfo = suspendCancellableCoroutine { cont ->
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action == Intent.ACTION_BATTERY_CHANGED) {
                    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                    val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                    val temp = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
                    val health = intent.getIntExtra(BatteryManager.EXTRA_HEALTH, BatteryManager.BATTERY_HEALTH_UNKNOWN)

                    val batteryPct = if (level != -1 && scale != -1) {
                        (level * 100 / scale.toFloat()).toInt()
                    } else 0

                    val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                            status == BatteryManager.BATTERY_STATUS_FULL

                    val temperature = temp / 10.0f
                    val healthStr = healthToString(health)

                    context.unregisterReceiver(this)
                    if (cont.isActive) {
                        cont.resume(BatteryInfo(batteryPct, isCharging, temperature, healthStr))
                    }
                }
            }
        }

        try {
            val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val stickyIntent = context.registerReceiver(receiver, filter)
            // If sticky intent is available, process immediately
            if (stickyIntent != null) {
                val level = stickyIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = stickyIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                val status = stickyIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                val temp = stickyIntent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
                val health = stickyIntent.getIntExtra(BatteryManager.EXTRA_HEALTH, BatteryManager.BATTERY_HEALTH_UNKNOWN)

                val batteryPct = if (level != -1 && scale != -1) {
                    (level * 100 / scale.toFloat()).toInt()
                } else 0

                val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                        status == BatteryManager.BATTERY_STATUS_FULL

                val temperature = temp / 10.0f
                val healthStr = healthToString(health)

                context.unregisterReceiver(receiver)
                if (cont.isActive) {
                    cont.resume(BatteryInfo(batteryPct, isCharging, temperature, healthStr))
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Battery info error: ${e.message}", e)
            if (cont.isActive) {
                cont.resume(BatteryInfo(0, false, 0f, "UNKNOWN"))
            }
        }
    }

    private fun healthToString(health: Int): String {
        return when (health) {
            BatteryManager.BATTERY_HEALTH_GOOD -> "GOOD"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "OVERHEAT"
            BatteryManager.BATTERY_HEALTH_DEAD -> "DEAD"
            BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "OVER_VOLTAGE"
            BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "UNSPECIFIED_FAILURE"
            BatteryManager.BATTERY_HEALTH_COLD -> "COLD"
            else -> "UNKNOWN"
        }
    }

    // ── Network ──────────────────────────────────────────────────────

    data class NetworkInfo(
        val type: String,
        val ssid: String?
    )

    private fun getNetworkInfo(): NetworkInfo {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = cm.activeNetwork
            if (network == null) {
                NetworkInfo("NONE", null)
            } else {
                val capabilities = cm.getNetworkCapabilities(network)
                if (capabilities == null) {
                    NetworkInfo("UNKNOWN", null)
                } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    val ssid = getWifiSsid()
                    NetworkInfo("WIFI", ssid)
                } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                    NetworkInfo("CELLULAR", null)
                } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                    NetworkInfo("ETHERNET", null)
                } else {
                    NetworkInfo("UNKNOWN", null)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Network info error: ${e.message}", e)
            NetworkInfo("UNKNOWN", null)
        }
    }

    private fun getWifiSsid(): String? {
        return try {
            val wifiManager = context.applicationContext
                .getSystemService(Context.WIFI_SERVICE) as WifiManager
            val wifiInfo = wifiManager.connectionInfo
            val ssid = wifiInfo.ssid
            if (ssid != null && ssid != "<unknown ssid>" && ssid != "\"\"") {
                ssid.removeSurrounding("\"")
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "WiFi SSID error: ${e.message}", e)
            null
        }
    }

    // ── Storage ──────────────────────────────────────────────────────

    data class StorageInfo(
        val total: Long,
        val used: Long
    )

    private fun getStorageInfo(): StorageInfo {
        return try {
            val statFs = StatFs(Environment.getDataDirectory().path)
            val totalBytes = statFs.totalBytes
            val availableBytes = statFs.availableBytes
            StorageInfo(totalBytes, totalBytes - availableBytes)
        } catch (e: Exception) {
            Log.e(TAG, "Storage info error: ${e.message}", e)
            StorageInfo(0, 0)
        }
    }

    // ── RAM ──────────────────────────────────────────────────────────

    data class RamInfo(
        val total: Long,
        val used: Long
    )

    private fun getRamInfo(): RamInfo {
        return try {
            val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val memoryInfo = ActivityManager.MemoryInfo()
            activityManager.getMemoryInfo(memoryInfo)
            val total = memoryInfo.totalMem
            val available = memoryInfo.availMem
            RamInfo(total, total - available)
        } catch (e: Exception) {
            Log.e(TAG, "RAM info error: ${e.message}", e)
            RamInfo(0, 0)
        }
    }

    // ── Display ──────────────────────────────────────────────────────

    /**
     * Collect display characteristics via DisplayManager + WindowManager.
     * Includes resolution, refresh rates, density, orientation, and physical size.
     */
    private fun getDisplayInfo(): DisplayInfo? {
        return try {
            val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
            val display = windowManager.defaultDisplay ?: return null

            val metrics = DisplayMetrics()
            display.getRealMetrics(metrics)

            val width = metrics.widthPixels
            val height = metrics.heightPixels
            val densityDpi = metrics.densityDpi
            val refreshRate = display.refreshRate

            // Current mode refresh rate
            val currentMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                display.mode?.refreshRate ?: refreshRate
            } else {
                refreshRate
            }

            // Supported refresh rates
            val supportedRates = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                display.supportedModes.map { it.refreshRate }.distinct().sorted()
            } else {
                listOf(refreshRate)
            }

            // Orientation
            val orientation = context.resources.configuration.orientation

            // Physical display size in inches (diagonal)
            val xdpi = metrics.xdpi
            val ydpi = metrics.ydpi
            val displaySizeInches = if (xdpi > 0 && ydpi > 0) {
                val widthInches = width / xdpi
                val heightInches = height / ydpi
                Math.sqrt((widthInches * widthInches + heightInches * heightInches).toDouble()).toFloat()
            } else {
                0f
            }

            DisplayInfo(
                resolutionWidth = width,
                resolutionHeight = height,
                refreshRate = refreshRate,
                currentMode = currentMode,
                supportedRates = supportedRates,
                densityDpi = densityDpi,
                orientation = orientation,
                displaySizeInches = displaySizeInches
            )
        } catch (e: Exception) {
            Log.e(TAG, "Display info error: ${e.message}", e)
            null
        }
    }

    // ── Performance Metrics ──────────────────────────────────────────

    /**
     * Collect performance metrics: CPU usage, app memory, uptime, thermal, service health.
     */
    private fun getPerformanceData(batteryHealth: String): PerformanceData? {
        return try {
            val cpuUsage = getCpuUsage()
            val appMemory = getAppMemoryMb()
            val uptime = SystemClock.elapsedRealtime() / 1000L
            val cpuFreq = getCpuFreqMhz()
            val thermal = getThermalStatus()
            val serviceHealth = getServiceHealth()

            PerformanceData(
                cpuUsagePct = cpuUsage,
                appMemoryMb = appMemory,
                uptimeSeconds = uptime,
                batteryHealth = batteryHealth,
                cpuFreqMhz = cpuFreq,
                thermalStatus = thermal,
                serviceHealth = serviceHealth
            )
        } catch (e: Exception) {
            Log.e(TAG, "Performance data error: ${e.message}", e)
            null
        }
    }

    /**
     * Read aggregate CPU usage from /proc/stat.
     * Returns percentage (0-100) or null if unavailable.
     */
    private fun getCpuUsage(): Float? {
        return try {
            val reader = BufferedReader(FileReader("/proc/stat"))
            val line = reader.readLine()
            reader.close()

            if (line == null || !line.startsWith("cpu ")) return null

            val parts = line.split("\\s+".toRegex())
            if (parts.size < 8) return null

            // user, nice, system, idle, iowait, irq, softirq, steal
            val user = parts[1].toLong()
            val nice = parts[2].toLong()
            val system = parts[3].toLong()
            val idle = parts[4].toLong()
            val iowait = parts[5].toLong()
            val irq = parts[6].toLong()
            val softirq = parts[7].toLong()

            val total = user + nice + system + idle + iowait + irq + softirq
            val idleTotal = idle + iowait

            if (total == 0L) return null

            // Single snapshot gives overall usage since boot
            // For real-time usage, we'd need two samples; this gives average since boot
            val usage = ((total - idleTotal) * 100.0f / total)
            usage.coerceIn(0f, 100f)
        } catch (e: Exception) {
            Log.e(TAG, "CPU usage error: ${e.message}", e)
            null
        }
    }

    /**
     * Get app-specific memory usage in MB via ActivityManager.
     */
    private fun getAppMemoryMb(): Float? {
        return try {
            val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val memInfo = activityManager.getProcessMemoryInfo(intArrayOf(android.os.Process.myPid()))
            if (memInfo.isNotEmpty()) {
                // totalPss is in KB
                memInfo[0].totalPss / 1024.0f
            } else null
        } catch (e: Exception) {
            Log.e(TAG, "App memory error: ${e.message}", e)
            null
        }
    }

    /**
     * Read current CPU frequency from sysfs if available.
     */
    private fun getCpuFreqMhz(): Int? {
        return try {
            val path = "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq"
            val reader = BufferedReader(FileReader(path))
            val khz = reader.readLine().trim().toInt()
            reader.close()
            khz / 1000
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Get thermal status via PowerManager (Android 11+).
     */
    private fun getThermalStatus(): String? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                when (powerManager.currentThermalStatus) {
                    PowerManager.THERMAL_STATUS_NONE -> "NONE"
                    PowerManager.THERMAL_STATUS_LIGHT -> "LIGHT"
                    PowerManager.THERMAL_STATUS_MODERATE -> "MODERATE"
                    PowerManager.THERMAL_STATUS_SEVERE -> "SEVERE"
                    PowerManager.THERMAL_STATUS_CRITICAL -> "CRITICAL"
                    PowerManager.THERMAL_STATUS_SHUTDOWN -> "SHUTDOWN"
                    else -> "UNKNOWN"
                }
            } else null
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Check service health: foreground service, notification listener, accessibility.
     */
    private fun getServiceHealth(): ServiceHealth {
        val foreground = try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            @Suppress("DEPRECATION")
            am.getRunningServices(Integer.MAX_VALUE).any {
                it.service.className == MainForegroundService::class.java.name
            }
        } catch (e: Exception) { false }

        val notificationListener = try {
            android.provider.Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")?.contains(context.packageName) == true
        } catch (e: Exception) { false }

        val accessibility = try {
            RemoteInputService.isServiceEnabled
        } catch (e: Exception) { false }

        return ServiceHealth(foreground, notificationListener, accessibility)
    }
}
