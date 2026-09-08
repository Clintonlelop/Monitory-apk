package com.devicemanager.manager

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.WorkManager
import com.devicemanager.data.remote.ApiService
import com.devicemanager.data.remote.WebSocketClient
import com.devicemanager.data.remote.model.DiagnosticCheck
import com.devicemanager.data.remote.model.DiagnosticCheckName
import com.devicemanager.data.remote.model.DiagnosticReport
import com.devicemanager.data.remote.model.DiagnosticStatus
import com.devicemanager.services.NotificationListener
import com.devicemanager.services.RemoteInputService
import com.devicemanager.util.Constants
import com.devicemanager.util.Preferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Runs device-side diagnostic checks.
 *
 * Checks: LOCATION, PERMISSIONS, BACKGROUND_SYNC, NETWORK, WEBSOCKET,
 * STORAGE, BATTERY, SCREEN_CAPTURE, NOTIFICATION_ACCESS, ACCESSIBILITY.
 *
 * Consent-based: if a permission is denied, reports that clearly rather than failing silently.
 */
class DiagnosticRunner(
    private val context: Context,
    private val apiService: ApiService,
    private val webSocketClient: WebSocketClient,
    private val permissionManager: PermissionManager,
    private val preferences: Preferences
) {
    companion object {
        private const val TAG = "DiagnosticRunner"
    }

    /**
     * Run all diagnostic checks and return a report.
     */
    suspend fun runAll(): DiagnosticReport = withContext(Dispatchers.IO) {
        val checks = mutableListOf<DiagnosticCheck>()

        checks.add(checkLocation())
        checks.add(checkPermissions())
        checks.add(checkBackgroundSync())
        checks.add(checkNetwork())
        checks.add(checkWebSocket())
        checks.add(checkStorage())
        checks.add(checkBattery())
        checks.add(checkScreenCapture())
        checks.add(checkNotificationAccess())
        checks.add(checkAccessibility())

        val hasFail = checks.any { it.status == DiagnosticStatus.FAIL }
        val hasWarning = checks.any { it.status == DiagnosticStatus.WARNING }
        val overall = if (hasFail) DiagnosticStatus.FAIL else if (hasWarning) DiagnosticStatus.WARNING else DiagnosticStatus.PASS

        DiagnosticReport(
            deviceId = preferences.deviceId,
            checks = checks,
            overallStatus = overall,
            timestamp = java.util.Date().toInstant().toString()
        )
    }

    private fun checkLocation(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            val fineGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val coarseGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

            if (fineGranted || coarseGranted) {
                DiagnosticCheck(
                    name = DiagnosticCheckName.LOCATION,
                    status = DiagnosticStatus.PASS,
                    message = "Location permission granted (${if (fineGranted) "FINE" else "COARSE"})",
                    details = mapOf("fine_location" to fineGranted, "coarse_location" to coarseGranted),
                    durationMs = System.currentTimeMillis() - start
                )
            } else {
                DiagnosticCheck(
                    name = DiagnosticCheckName.LOCATION,
                    status = DiagnosticStatus.FAIL,
                    message = "Location permission not granted. Please grant location permission in Settings.",
                    details = mapOf("fine_location" to false, "coarse_location" to false),
                    durationMs = System.currentTimeMillis() - start
                )
            }
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.LOCATION,
                status = DiagnosticStatus.FAIL,
                message = "Location check error: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private fun checkPermissions(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            val all = permissionManager.getAllPermissions()
            val granted = all.count { it.status == "GRANTED" }
            val denied = all.count { it.status == "DENIED" }
            val requiresAction = all.count { it.status == "REQUIRES_USER_ACTION" }
            val total = all.size

            val status = when {
                denied > 0 || requiresAction > 0 -> DiagnosticStatus.WARNING
                else -> DiagnosticStatus.PASS
            }

            DiagnosticCheck(
                name = DiagnosticCheckName.PERMISSIONS,
                status = status,
                message = "$granted/$total granted" + (if (denied > 0) ", $denied denied" else "") + (if (requiresAction > 0) ", $requiresAction requires action" else ""),
                details = mapOf(
                    "total" to total,
                    "granted" to granted,
                    "denied" to denied,
                    "requires_user_action" to requiresAction
                ),
                durationMs = System.currentTimeMillis() - start
            )
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.PERMISSIONS,
                status = DiagnosticStatus.FAIL,
                message = "Permission check error: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private fun checkBackgroundSync(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            val workManager = WorkManager.getInstance(context)
            // Check if WorkManager is initialized by getting work info
            val workInfos = workManager.getWorkInfosByTag(Constants.WORK_SYNC).get()
            val scheduled = workInfos.isNotEmpty()

            DiagnosticCheck(
                name = DiagnosticCheckName.BACKGROUND_SYNC,
                status = if (scheduled) DiagnosticStatus.PASS else DiagnosticStatus.WARNING,
                message = if (scheduled) "WorkManager initialized, sync workers scheduled" else "WorkManager available but no sync workers scheduled yet",
                details = mapOf("workers_scheduled" to scheduled, "sync_tag" to Constants.WORK_SYNC),
                durationMs = System.currentTimeMillis() - start
            )
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.BACKGROUND_SYNC,
                status = DiagnosticStatus.FAIL,
                message = "Background sync check error: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private suspend fun checkNetwork(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = cm.activeNetwork
            if (network == null) {
                DiagnosticCheck(
                    name = DiagnosticCheckName.NETWORK,
                    status = DiagnosticStatus.FAIL,
                    message = "No active network connection",
                    durationMs = System.currentTimeMillis() - start
                )
            } else {
                val caps = cm.getNetworkCapabilities(network)
                val type = when {
                    caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "WIFI"
                    caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "CELLULAR"
                    caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "ETHERNET"
                    else -> "UNKNOWN"
                }

                // Test HTTP request to server
                val serverReachable = testServerConnectivity()

                DiagnosticCheck(
                    name = DiagnosticCheckName.NETWORK,
                    status = if (serverReachable) DiagnosticStatus.PASS else DiagnosticStatus.WARNING,
                    message = "$type connected" + if (serverReachable) ", server reachable" else ", server unreachable",
                    details = mapOf("network_type" to type, "server_reachable" to serverReachable),
                    durationMs = System.currentTimeMillis() - start
                )
            }
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.NETWORK,
                status = DiagnosticStatus.FAIL,
                message = "Network check error: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private fun testServerConnectivity(): Boolean {
        return try {
            val serverUrl = preferences.serverUrl.ifBlank { return false }
            val url = URL("$serverUrl/api/health")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.requestMethod = "GET"
            val code = conn.responseCode
            conn.disconnect()
            code in 200..299
        } catch (e: Exception) {
            false
        }
    }

    private fun checkWebSocket(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            val state = webSocketClient.connectionState.value
            val connected = state == WebSocketClient.ConnectionState.CONNECTED

            DiagnosticCheck(
                name = DiagnosticCheckName.WEBSOCKET,
                status = if (connected) DiagnosticStatus.PASS else DiagnosticStatus.WARNING,
                message = if (connected) "WebSocket connected" else "WebSocket ${state.name.lowercase()} — commands will use polling fallback",
                details = mapOf("state" to state.name),
                durationMs = System.currentTimeMillis() - start
            )
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.WEBSOCKET,
                status = DiagnosticStatus.FAIL,
                message = "WebSocket check error: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private fun checkStorage(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            val statFs = StatFs(Environment.getDataDirectory().path)
            val available = statFs.availableBytes
            val total = statFs.totalBytes
            val lowSpace = available < 100 * 1024 * 1024 // < 100MB

            // Check Room DB accessibility
            val dbAccessible = try {
                val app = context.applicationContext as com.devicemanager.DeviceManagerApp
                app.database.openHelper.writableDatabase.isOpen
            } catch (_: Exception) { false }

            DiagnosticCheck(
                name = DiagnosticCheckName.STORAGE,
                status = if (lowSpace) DiagnosticStatus.WARNING else DiagnosticStatus.PASS,
                message = "${formatBytes(available)} available of ${formatBytes(total)}" + if (!dbAccessible) ", Room DB inaccessible" else "",
                details = mapOf(
                    "available_bytes" to available,
                    "total_bytes" to total,
                    "room_db_accessible" to dbAccessible
                ),
                durationMs = System.currentTimeMillis() - start
            )
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.STORAGE,
                status = DiagnosticStatus.FAIL,
                message = "Storage check error: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private fun checkBattery(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val batteryIntent = context.registerReceiver(null, filter)
            val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val temp = batteryIntent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
            val health = batteryIntent?.getIntExtra(BatteryManager.EXTRA_HEALTH, BatteryManager.BATTERY_HEALTH_UNKNOWN) ?: BatteryManager.BATTERY_HEALTH_UNKNOWN

            val batteryPct = if (level != -1 && scale != -1) (level * 100 / scale.toFloat()).toInt() else 0
            val tempC = temp / 10.0f
            val healthGood = health == BatteryManager.BATTERY_HEALTH_GOOD
            val tempHigh = tempC > 40.0f

            // Check battery optimization
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val ignoringOptimization = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                powerManager.isIgnoringBatteryOptimizations(context.packageName)
            } else true

            val status = when {
                !healthGood -> DiagnosticStatus.WARNING
                tempHigh -> DiagnosticStatus.WARNING
                batteryPct < 15 -> DiagnosticStatus.WARNING
                else -> DiagnosticStatus.PASS
            }

            DiagnosticCheck(
                name = DiagnosticCheckName.BATTERY,
                status = status,
                message = "$batteryPct%, ${tempC}°C, health ${if (healthGood) "GOOD" else "DEGRADED"}" + if (!ignoringOptimization) ", battery optimization active" else "",
                details = mapOf(
                    "level" to batteryPct,
                    "temperature_c" to tempC,
                    "health" to health,
                    "ignoring_battery_optimization" to ignoringOptimization
                ),
                durationMs = System.currentTimeMillis() - start
            )
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.BATTERY,
                status = DiagnosticStatus.FAIL,
                message = "Battery check error: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private fun checkScreenCapture(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            // MediaProjection consent is per-session; check if the app has the permission declared
            val hasProjection = try {
                com.devicemanager.services.ScreenRecordService.instance != null ||
                com.devicemanager.services.ScreenStreamService.instance != null
            } catch (_: Exception) { false }

            DiagnosticCheck(
                name = DiagnosticCheckName.SCREEN_CAPTURE,
                status = if (hasProjection) DiagnosticStatus.PASS else DiagnosticStatus.WARNING,
                message = if (hasProjection) "MediaProjection session active" else "No active MediaProjection session — user must approve consent when starting screen capture/stream",
                details = mapOf("projection_active" to hasProjection),
                durationMs = System.currentTimeMillis() - start
            )
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.SCREEN_CAPTURE,
                status = DiagnosticStatus.WARNING,
                message = "Screen capture check: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private fun checkNotificationAccess(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            val connected = NotificationListener.isConnected
            DiagnosticCheck(
                name = DiagnosticCheckName.NOTIFICATION_ACCESS,
                status = if (connected) DiagnosticStatus.PASS else DiagnosticStatus.FAIL,
                message = if (connected) "NotificationListenerService connected" else "Notification access not granted. Please enable in Settings > Notifications > Notification access.",
                details = mapOf("connected" to connected),
                durationMs = System.currentTimeMillis() - start
            )
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.NOTIFICATION_ACCESS,
                status = DiagnosticStatus.FAIL,
                message = "Notification access check error: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private fun checkAccessibility(): DiagnosticCheck {
        val start = System.currentTimeMillis()
        return try {
            val enabled = RemoteInputService.isServiceEnabled
            DiagnosticCheck(
                name = DiagnosticCheckName.ACCESSIBILITY,
                status = if (enabled) DiagnosticStatus.PASS else DiagnosticStatus.FAIL,
                message = if (enabled) "Accessibility service (RemoteInput) enabled" else "Accessibility service not enabled. Please enable in Settings > Accessibility > Device Manager Remote Control.",
                details = mapOf("enabled" to enabled),
                durationMs = System.currentTimeMillis() - start
            )
        } catch (e: Exception) {
            DiagnosticCheck(
                name = DiagnosticCheckName.ACCESSIBILITY,
                status = DiagnosticStatus.FAIL,
                message = "Accessibility check error: ${e.message}",
                durationMs = System.currentTimeMillis() - start
            )
        }
    }

    private fun formatBytes(bytes: Long): String {
        if (bytes <= 0) return "0 B"
        val k = 1024.0
        val sizes = arrayOf("B", "KB", "MB", "GB", "TB")
        val i = Math.floor(Math.log(bytes.toDouble()) / Math.log(k)).toInt()
        return String.format("%.1f %s", bytes / Math.pow(k, i.toDouble()), sizes[i])
    }
}
