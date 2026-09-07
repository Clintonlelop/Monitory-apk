package com.devicemanager.util

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.text.format.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Extension functions and utility helpers.
 */
object Extensions {

    /**
     * Generate a new UUID for device token.
     */
    fun generateDeviceToken(): String = UUID.randomUUID().toString()

    /**
     * Format timestamp to readable date string.
     */
    fun formatTimestamp(timestamp: Long): String {
        if (timestamp == 0L) return "Never"
        val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
        return sdf.format(Date(timestamp))
    }

    /**
     * Format bytes to human-readable string.
     */
    fun formatBytes(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        val kb = bytes / 1024.0
        if (kb < 1024) return "%.1f KB".format(kb)
        val mb = kb / 1024.0
        if (mb < 1024) return "%.1f MB".format(mb)
        val gb = mb / 1024.0
        return "%.2f GB".format(gb)
    }

    /**
     * Get app name from package name.
     */
    fun getAppName(context: Context, packageName: String): String {
        return try {
            val pm = context.packageManager
            val appInfo = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(appInfo).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            packageName
        }
    }

    /**
     * Check if a permission is granted.
     */
    fun hasPermission(context: Context, permission: String): Boolean {
        return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Get device model string.
     */
    fun getDeviceModel(): String = Build.MODEL

    /**
     * Get device manufacturer.
     */
    fun getDeviceManufacturer(): String = Build.MANUFACTURER

    /**
     * Get Android version string.
     */
    fun getAndroidVersion(): String = Build.VERSION.RELEASE

    /**
     * Get app version name.
     */
    fun getAppVersion(context: Context): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "1.0.0"
        } catch (e: Exception) {
            "1.0.0"
        }
    }

    /**
     * Convert WebSocket URL from HTTP base URL.
     */
    fun toWebSocketUrl(baseUrl: String, deviceId: String): String {
        val wsBase = baseUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://")
            .trimEnd('/')
        return "$wsBase/ws/device?deviceId=$deviceId"
    }

    /**
     * Normalize server URL (ensure no trailing slash).
     */
    fun normalizeServerUrl(url: String): String {
        return url.trim().trimEnd('/')
    }

    /**
     * Programmatically request the highest supported refresh rate (e.g. 120Hz) for the window.
     */
    fun setHighestRefreshRate(window: android.view.Window) {
        try {
            val context = window.context
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val display = context.display ?: return
                val modes = display.supportedModes
                if (modes.isNotEmpty()) {
                    val highestMode = modes.maxByOrNull { it.refreshRate }
                    if (highestMode != null) {
                        val params = window.attributes
                        params.preferredDisplayModeId = highestMode.modeId
                        window.attributes = params
                    }
                }
            } else {
                val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? android.view.WindowManager
                val display = windowManager?.defaultDisplay
                val modes = display?.supportedModes
                if (modes != null && modes.isNotEmpty()) {
                    val highestMode = modes.maxByOrNull { it.refreshRate }
                    if (highestMode != null) {
                        val params = window.attributes
                        params.preferredDisplayModeId = highestMode.modeId
                        window.attributes = params
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("Extensions", "Failed to set high refresh rate: ${e.message}")
        }
    }

    /**
     * Get the current display refresh rate.
     */
    fun getCurrentRefreshRate(context: Context): Float {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                context.display?.refreshRate ?: 60f
            } else {
                val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? android.view.WindowManager
                windowManager?.defaultDisplay?.refreshRate ?: 60f
            }
        } catch (e: Exception) {
            60f
        }
    }
}
