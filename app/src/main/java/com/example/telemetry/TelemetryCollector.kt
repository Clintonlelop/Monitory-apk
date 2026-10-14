package com.example.telemetry

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
import com.example.BuildConfig
import com.example.data.model.DeviceTelemetry
import com.example.data.prefs.PreferenceManager

class TelemetryCollector(
    private val context: Context,
    private val preferenceManager: PreferenceManager
) {

    fun collectTelemetry(): DeviceTelemetry {
        val (batteryLevel, isCharging) = getBatteryInfo()
        val (storageAvail, storageTotal) = getStorageInfo()
        val (ramAvail, ramTotal) = getRamInfo()
        val (networkType, wifiSsid, isWifiConnected) = getNetworkInfo()

        return DeviceTelemetry(
            deviceId = preferenceManager.getDeviceId(),
            deviceName = preferenceManager.getDeviceName(),
            manufacturer = Build.MANUFACTURER,
            model = Build.MODEL,
            osVersion = Build.VERSION.RELEASE,
            sdkVersion = Build.VERSION.SDK_INT,
            appVersion = BuildConfig.VERSION_NAME,
            batteryLevel = batteryLevel,
            isCharging = isCharging,
            storageAvailableBytes = storageAvail,
            storageTotalBytes = storageTotal,
            ramAvailableBytes = ramAvail,
            ramTotalBytes = ramTotal,
            networkType = networkType,
            wifiSsid = wifiSsid,
            isWifiConnected = isWifiConnected,
            uptimeMillis = SystemClock.elapsedRealtime(),
            timestamp = System.currentTimeMillis()
        )
    }

    private fun getBatteryInfo(): Pair<Int, Boolean> {
        val intentFilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        val batteryStatus: Intent? = context.registerReceiver(null, intentFilter)
        val level = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val percentage = if (level >= 0 && scale > 0) ((level / scale.toFloat()) * 100).toInt() else 100

        val status = batteryStatus?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL

        return Pair(percentage, isCharging)
    }

    private fun getStorageInfo(): Pair<Long, Long> {
        return try {
            val statFs = StatFs(Environment.getDataDirectory().path)
            val available = statFs.availableBlocksLong * statFs.blockSizeLong
            val total = statFs.blockCountLong * statFs.blockSizeLong
            Pair(available, total)
        } catch (e: Exception) {
            Pair(0L, 0L)
        }
    }

    private fun getRamInfo(): Pair<Long, Long> {
        return try {
            val actManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val memInfo = ActivityManager.MemoryInfo()
            actManager.getMemoryInfo(memInfo)
            Pair(memInfo.availMem, memInfo.totalMem)
        } catch (e: Exception) {
            Pair(0L, 0L)
        }
    }

    private fun getNetworkInfo(): Triple<String, String?, Boolean> {
        try {
            val connManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = connManager.activeNetwork ?: return Triple("Disconnected", null, false)
            val capabilities = connManager.getNetworkCapabilities(network) ?: return Triple("Unknown", null, false)

            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                val info = wifiManager.connectionInfo
                val ssid = info?.ssid?.removeSurrounding("\"")?.let { if (it == "<unknown ssid>") null else it }
                return Triple("Wi-Fi", ssid, true)
            } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                return Triple("Cellular", null, false)
            } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                return Triple("Ethernet", null, false)
            }
        } catch (_: Exception) {}
        return Triple("Unknown", null, false)
    }
}
