package com.example.telemetry

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.example.data.model.DevicePermissionsStatus
import java.io.File

class PermissionsHelper(private val context: Context) {

    fun checkAllPermissions(): DevicePermissionsStatus {
        return DevicePermissionsStatus(
            location = isLocationGranted(),
            notificationAccess = isNotificationAccessGranted(),
            filesAccess = isStorageGranted(),
            camera = isCameraGranted(),
            microphone = isAudioGranted(),
            usageAccess = isUsageAccessGranted(),
            screenSharing = false // Active on-demand with MediaProjection
        )
    }

    fun isLocationGranted(): Boolean {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    fun isNotificationAccessGranted(): Boolean {
        val packages = NotificationManagerCompat.getEnabledListenerPackages(context)
        return packages.contains(context.packageName)
    }

    fun isStorageGranted(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
        } else {
            @Suppress("DEPRECATION")
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
    }

    fun isCameraGranted(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }

    fun isAudioGranted(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    fun isUsageAccessGranted(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
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
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(intent)
    }

    fun openNotificationAccessSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(intent)
    }

    fun openUsageAccessSettings() {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(intent)
    }
}

class AudioRecorderHelper(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var currentOutputFile: File? = null
    private var startTimeMillis: Long = 0L

    var isRecording: Boolean = false
        private set

    fun startRecording(): File? {
        if (isRecording) return currentOutputFile

        val file = File(context.cacheDir, "record_${System.currentTimeMillis()}.m4a")
        currentOutputFile = file
        startTimeMillis = System.currentTimeMillis()

        try {
            recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(128000)
                setAudioSamplingRate(44100)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            isRecording = true
            return file
        } catch (e: Exception) {
            recorder?.release()
            recorder = null
            isRecording = false
            return null
        }
    }

    fun stopRecording(): Pair<File?, Long> {
        if (!isRecording) return Pair(null, 0L)
        val duration = System.currentTimeMillis() - startTimeMillis
        try {
            recorder?.stop()
        } catch (_: Exception) {}
        recorder?.release()
        recorder = null
        isRecording = false
        return Pair(currentOutputFile, duration)
    }
}
