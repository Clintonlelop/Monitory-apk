package com.devicemanager.manager

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.os.SystemClock
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import com.devicemanager.data.remote.WebSocketClient
import com.devicemanager.data.remote.model.BatterySnapshot
import com.devicemanager.data.remote.model.ConnectionSnapshot
import com.devicemanager.data.remote.model.DeviceInfoSnapshot
import com.devicemanager.data.remote.model.DisplaySnapshot
import com.devicemanager.data.remote.model.NetworkSnapshot
import com.devicemanager.data.remote.model.RamSnapshot
import com.devicemanager.data.remote.model.ServiceStatusSnapshot
import com.devicemanager.data.remote.model.SnapshotData
import com.devicemanager.data.remote.model.StorageSnapshot
import com.devicemanager.data.remote.model.SyncStateSnapshot
import com.devicemanager.services.MainForegroundService
import com.devicemanager.services.NotificationListener
import com.devicemanager.services.RemoteInputService
import com.devicemanager.util.Preferences

/**
 * Collects a full device state snapshot at a point in time.
 *
 * Captures: device info, battery, storage, RAM, network, permissions,
 * service status, sync state, display info, and connection state.
 */
class SnapshotCollector(
    private val context: Context,
    private val permissionManager: PermissionManager,
    private val webSocketClient: WebSocketClient,
    private val preferences: Preferences
) {
    companion object {
        private const val TAG = "SnapshotCollector"
    }

    /**
     * Collect a full device state snapshot.
     */
    fun collect(): SnapshotData {
        return SnapshotData(
            deviceInfo = collectDeviceInfo(),
            battery = collectBattery(),
            storage = collectStorage(),
            ram = collectRam(),
            network = collectNetwork(),
            permissions = collectPermissions(),
            serviceStatus = collectServiceStatus(),
            syncState = collectSyncState(),
            display = collectDisplay(),
            connection = collectConnection()
        )
    }

    private fun collectDeviceInfo(): DeviceInfoSnapshot {
        return try {
            val pm = context.packageManager
            val appVersion = try {
                pm.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
            } catch (_: Exception) { "unknown" }

            DeviceInfoSnapshot(
                name = preferences.deviceName.ifBlank { Build.MODEL },
                model = Build.MODEL,
                manufacturer = Build.MANUFACTURER,
                androidVersion = Build.VERSION.RELEASE,
                appVersion = appVersion
            )
        } catch (e: Exception) {
            Log.e(TAG, "Device info error: ${e.message}", e)
            DeviceInfoSnapshot("unknown", Build.MODEL, Build.MANUFACTURER, Build.VERSION.RELEASE, "unknown")
        }
    }

    private fun collectBattery(): BatterySnapshot {
        return try {
            val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val batteryIntent = context.registerReceiver(null, filter)
            val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val temp = batteryIntent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
            val health = batteryIntent?.getIntExtra(BatteryManager.EXTRA_HEALTH, BatteryManager.BATTERY_HEALTH_UNKNOWN) ?: BatteryManager.BATTERY_HEALTH_UNKNOWN

            val batteryPct = if (level != -1 && scale != -1) (level * 100 / scale.toFloat()).toInt() else 0
            val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
            val healthStr = when (health) {
                BatteryManager.BATTERY_HEALTH_GOOD -> "GOOD"
                BatteryManager.BATTERY_HEALTH_OVERHEAT -> "OVERHEAT"
                BatteryManager.BATTERY_HEALTH_DEAD -> "DEAD"
                BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "OVER_VOLTAGE"
                BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "UNSPECIFIED_FAILURE"
                BatteryManager.BATTERY_HEALTH_COLD -> "COLD"
                else -> "UNKNOWN"
            }

            BatterySnapshot(batteryPct, isCharging, temp / 10.0f, healthStr)
        } catch (e: Exception) {
            Log.e(TAG, "Battery snapshot error: ${e.message}", e)
            BatterySnapshot(0, false, 0f, "UNKNOWN")
        }
    }

    private fun collectStorage(): StorageSnapshot {
        return try {
            val statFs = StatFs(Environment.getDataDirectory().path)
            val total = statFs.totalBytes
            val available = statFs.availableBytes
            StorageSnapshot(total, total - available, available)
        } catch (e: Exception) {
            Log.e(TAG, "Storage snapshot error: ${e.message}", e)
            StorageSnapshot(0, 0, 0)
        }
    }

    private fun collectRam(): RamSnapshot {
        return try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mi = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            RamSnapshot(mi.totalMem, mi.totalMem - mi.availMem, mi.availMem)
        } catch (e: Exception) {
            Log.e(TAG, "RAM snapshot error: ${e.message}", e)
            RamSnapshot(0, 0, 0)
        }
    }

    private fun collectNetwork(): NetworkSnapshot {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = cm.activeNetwork
            if (network == null) {
                NetworkSnapshot("NONE", null, null)
            } else {
                val caps = cm.getNetworkCapabilities(network)
                val type = when {
                    caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "WIFI"
                    caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "CELLULAR"
                    caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "ETHERNET"
                    else -> "UNKNOWN"
                }
                val ssid = if (type == "WIFI") getWifiSsid() else null
                NetworkSnapshot(type, ssid, null)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Network snapshot error: ${e.message}", e)
            NetworkSnapshot("UNKNOWN", null, null)
        }
    }

    private fun getWifiSsid(): String? {
        return try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val ssid = wifiManager.connectionInfo.ssid
            if (ssid != null && ssid != "<unknown ssid>" && ssid != "\"\"") {
                ssid.removeSurrounding("\"")
            } else null
        } catch (e: Exception) { null }
    }

    private fun collectPermissions(): Map<String, String> {
        return try {
            permissionManager.getAllPermissions().associate { it.key to it.status }
        } catch (e: Exception) {
            Log.e(TAG, "Permissions snapshot error: ${e.message}", e)
            emptyMap()
        }
    }

    private fun collectServiceStatus(): ServiceStatusSnapshot {
        val foregroundRunning = try {
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

        return ServiceStatusSnapshot(foregroundRunning, notificationListener, accessibility)
    }

    private fun collectSyncState(): SyncStateSnapshot {
        return try {
            val pendingSize = try {
                val app = context.applicationContext as com.devicemanager.DeviceManagerApp
                kotlinx.coroutines.runBlocking { app.syncRepository.getQueueSize() }
            } catch (_: Exception) { 0 }

            SyncStateSnapshot(
                lastTelemetrySync = preferences.lastTelemetryTime,
                lastLocationSync = preferences.lastLocationTime,
                pendingQueueSize = pendingSize
            )
        } catch (e: Exception) {
            Log.e(TAG, "Sync state error: ${e.message}", e)
            SyncStateSnapshot(0, 0, 0)
        }
    }

    private fun collectDisplay(): DisplaySnapshot? {
        return try {
            val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val display = wm.defaultDisplay ?: return null
            val metrics = DisplayMetrics()
            display.getRealMetrics(metrics)

            DisplaySnapshot(
                resolutionWidth = metrics.widthPixels,
                resolutionHeight = metrics.heightPixels,
                refreshRate = display.refreshRate,
                density = metrics.densityDpi,
                orientation = context.resources.configuration.orientation
            )
        } catch (e: Exception) {
            Log.e(TAG, "Display snapshot error: ${e.message}", e)
            null
        }
    }

    private fun collectConnection(): ConnectionSnapshot {
        return try {
            val wsConnected = webSocketClient.connectionState.value == WebSocketClient.ConnectionState.CONNECTED
            ConnectionSnapshot(
                wsConnected = wsConnected,
                serverUrl = preferences.serverUrl,
                lastPingMs = null
            )
        } catch (e: Exception) {
            ConnectionSnapshot(false, preferences.serverUrl, null)
        }
    }
}
