package com.devicemanager.manager

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.devicemanager.data.remote.model.PermissionEntry
import com.devicemanager.data.remote.model.PermissionStatus
import com.devicemanager.util.Constants

/**
 * Checks and reports the status of all required permissions.
 *
 * Permission statuses:
 * - GRANTED: permission is granted
 * - DENIED: permission explicitly denied
 * - REQUIRES_USER_ACTION: special permission requiring user action in Settings
 * - NOT_AVAILABLE: not available on this device/Android version
 */
class PermissionManager(private val context: Context) {

    data class PermissionInfo(
        val key: String,
        val displayName: String,
        val description: String,
        val status: String,
        val isSpecial: Boolean = false
    )

    /**
     * Get the status of all permissions.
     */
    fun getAllPermissions(): List<PermissionInfo> {
        return listOf(
            PermissionInfo(
                key = Constants.PERM_LOCATION,
                displayName = "Location",
                description = "Required for GPS location tracking. Allows background location updates.",
                status = checkLocationPermission()
            ),
            PermissionInfo(
                key = Constants.PERM_CAMERA,
                displayName = "Camera",
                description = "Required for remote photo capture using CameraX.",
                status = checkCameraPermission()
            ),
            PermissionInfo(
                key = Constants.PERM_MICROPHONE,
                displayName = "Microphone",
                description = "Required for audio recording during screen recording.",
                status = checkMicrophonePermission()
            ),
            PermissionInfo(
                key = Constants.PERM_NOTIFICATIONS,
                displayName = "Notifications",
                description = "Required to post foreground service notifications (Android 13+).",
                status = checkNotificationPermission()
            ),
            PermissionInfo(
                key = Constants.PERM_CONTACTS,
                displayName = "Contacts",
                description = "Required to read and sync contact information.",
                status = checkContactsPermission()
            ),
            PermissionInfo(
                key = Constants.PERM_CALL_LOG,
                displayName = "Call Log",
                description = "Required to read and sync call history.",
                status = checkCallLogPermission()
            ),
            PermissionInfo(
                key = Constants.PERM_SMS,
                displayName = "SMS",
                description = "Required to read SMS messages. On Android 10+, the app must be set as the default SMS app for full access.",
                status = checkSmsPermission()
            ),
            PermissionInfo(
                key = Constants.PERM_STORAGE,
                displayName = "Storage / Media",
                description = "Required to read file metadata via MediaStore. Uses scoped storage on Android 10+.",
                status = checkStoragePermission()
            ),
            PermissionInfo(
                key = Constants.PERM_USAGE_ACCESS,
                displayName = "Usage Access",
                description = "Required to read app usage statistics. Must be enabled in Settings > Apps > Special app access > Usage access.",
                status = checkUsageAccessPermission(),
                isSpecial = true
            ),
            PermissionInfo(
                key = Constants.PERM_NOTIFICATION_ACCESS,
                displayName = "Notification Access",
                description = "Required to monitor notifications. Must be enabled in Settings > Notifications > Notification access.",
                status = checkNotificationAccessPermission(),
                isSpecial = true
            ),
            PermissionInfo(
                key = Constants.PERM_SCREEN_CAPTURE,
                displayName = "Screen Capture",
                description = "Required for screen recording. User must approve the MediaProjection consent dialog each session.",
                status = checkScreenCapturePermission(),
                isSpecial = true
            )
        )
    }

    /**
     * Get permission entries for server sync.
     */
    fun getPermissionEntries(): List<PermissionEntry> {
        return getAllPermissions().map {
            PermissionEntry(permissionName = it.key, status = it.status)
        }
    }

    // ── Individual permission checks ─────────────────────────────────

    fun checkLocationPermission(): String {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
        return if (fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val bg = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                if (bg == PackageManager.PERMISSION_GRANTED) PermissionStatus.GRANTED
                else PermissionStatus.REQUIRES_USER_ACTION
            } else {
                PermissionStatus.GRANTED
            }
        } else {
            PermissionStatus.DENIED
        }
    }

    fun checkCameraPermission(): String {
        return if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) PermissionStatus.GRANTED else PermissionStatus.DENIED
    }

    fun checkMicrophonePermission(): String {
        return if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED
        ) PermissionStatus.GRANTED else PermissionStatus.DENIED
    }

    fun checkNotificationPermission(): String {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED
            ) PermissionStatus.GRANTED else PermissionStatus.DENIED
        } else {
            PermissionStatus.GRANTED
        }
    }

    fun checkContactsPermission(): String {
        return if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS)
            == PackageManager.PERMISSION_GRANTED
        ) PermissionStatus.GRANTED else PermissionStatus.DENIED
    }

    fun checkCallLogPermission(): String {
        return if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG)
            == PackageManager.PERMISSION_GRANTED
        ) PermissionStatus.GRANTED else PermissionStatus.DENIED
    }

    fun checkSmsPermission(): String {
        val readSms = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS)
        return if (readSms == PackageManager.PERMISSION_GRANTED) {
            // On Android 10+, full SMS content access requires being the default SMS app
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                PermissionStatus.REQUIRES_USER_ACTION
            } else {
                PermissionStatus.GRANTED
            }
        } else {
            PermissionStatus.DENIED
        }
    }

    fun checkStoragePermission(): String {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Scoped storage: MediaStore is accessible without permission
            PermissionStatus.GRANTED
        } else {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED
            ) PermissionStatus.GRANTED else PermissionStatus.DENIED
        }
    }

    fun checkUsageAccessPermission(): String {
        return try {
            val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
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
            if (mode == AppOpsManager.MODE_ALLOWED) PermissionStatus.GRANTED
            else PermissionStatus.REQUIRES_USER_ACTION
        } catch (e: Exception) {
            PermissionStatus.REQUIRES_USER_ACTION
        }
    }

    fun checkNotificationAccessPermission(): String {
        return try {
            val contentResolver = context.contentResolver
            val enabledListeners = Settings.Secure.getString(
                contentResolver,
                "enabled_notification_listeners"
            )
            if (enabledListeners != null && enabledListeners.contains(context.packageName)) {
                PermissionStatus.GRANTED
            } else {
                PermissionStatus.REQUIRES_USER_ACTION
            }
        } catch (e: Exception) {
            PermissionStatus.REQUIRES_USER_ACTION
        }
    }

    fun checkScreenCapturePermission(): String {
        // MediaProjection requires user consent each time; cannot be pre-granted
        return PermissionStatus.REQUIRES_USER_ACTION
    }

    // ── Intent helpers for opening settings ──────────────────────────

    fun getUsageAccessIntent(): Intent {
        return Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
    }

    fun getNotificationAccessIntent(): Intent {
        return Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
    }

    fun getAppDetailsIntent(): Intent {
        return Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = android.net.Uri.fromParts("package", context.packageName, null)
        }
    }
}
