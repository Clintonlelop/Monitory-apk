package com.example.telemetry

import android.Manifest
import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.example.data.model.DevicePermissionsStatus

class PermissionsHelper(private val context: Context) {

    fun checkAllPermissions(): DevicePermissionsStatus {
        return DevicePermissionsStatus(
            location = isLocationGranted(),
            notificationAccess = isNotificationAccessGranted(),
            filesAccess = isStorageGranted(),
            camera = isCameraGranted(),
            microphone = isAudioGranted(),
            usageAccess = isUsageAccessGranted(),
            // Screen capture is a user-approved session, not a persistent permission.
            screenSharing = false,
            contacts = isContactsGranted(),
            calls = isCallsGranted(),
            sms = isSmsGranted(),
            accessibility = isAccessibilityEnabled()
        )
    }

    fun isAccessibilityEnabled(): Boolean {
        return try {
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ).orEmpty()
            val expectedService = ComponentName(
                context,
                com.example.service.DeviceAccessibilityService::class.java
            ).flattenToString()
            enabledServices.split(':').any { it.equals(expectedService, ignoreCase = true) }
        } catch (_: Exception) {
            false
        }
    }

    fun isContactsGranted(): Boolean = hasPermission(Manifest.permission.READ_CONTACTS)

    fun isCallsGranted(): Boolean = hasPermission(Manifest.permission.READ_CALL_LOG)

    fun isSmsGranted(): Boolean = hasPermission(Manifest.permission.READ_SMS)

    fun isLocationGranted(): Boolean {
        val fine = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        return fine || coarse
    }

    fun isNotificationAccessGranted(): Boolean {
        return try {
            NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Reports the storage access this app can actually use on this OS version.
     * Android 11+ full-file access is a special app access toggle; Android 13+
     * media permissions alone do not grant arbitrary file-system access.
     */
    fun isStorageGranted(): Boolean {
        return when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
                android.os.Environment.isExternalStorageManager()
            else -> hasPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    fun isCameraGranted(): Boolean = hasPermission(Manifest.permission.CAMERA)

    fun isAudioGranted(): Boolean = hasPermission(Manifest.permission.RECORD_AUDIO)

    fun isUsageAccessGranted(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
        val mode = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName
                )
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName
                )
            }
        } catch (_: Exception) {
            return false
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    fun openNotificationAccessSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    fun openUsageAccessSettings() {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    fun openAccessibilitySettings() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
