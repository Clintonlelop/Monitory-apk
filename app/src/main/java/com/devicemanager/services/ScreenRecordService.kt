package com.devicemanager.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.Surface
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.devicemanager.DeviceManagerApp
import com.devicemanager.R
import com.devicemanager.util.Constants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Screen recording service using MediaProjection API.
 *
 * The user must receive and approve Android's screen-capture consent dialog
 * (handled by MainActivity via createScreenCaptureIntent).
 *
 * Recording lifecycle:
 * 1. User approves MediaProjection consent (result code + data passed via intent)
 * 2. Foreground service starts with mediaProjection type
 * 3. MediaRecorder records screen to a file
 * 4. On stop: video file is uploaded via /api/upload with file_type=screen_recording
 * 5. Command status is updated throughout
 */
class ScreenRecordService : Service() {
    companion object {
        private const val TAG = "ScreenRecordService"

        const val ACTION_START = "com.devicemanager.START_SCREEN_RECORD"
        const val ACTION_STOP = "com.devicemanager.STOP_SCREEN_RECORD"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "data"
        const val EXTRA_COMMAND_ID = "command_id"

        // Static reference for MediaProjection result (set by MainActivity)
        var pendingResultCode: Int = 0
        var pendingData: Intent? = null
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var mediaProjection: MediaProjection? = null
    private var mediaRecorder: MediaRecorder? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var outputFile: File? = null
    private var currentCommandId: String? = null
    private var isRecording = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startRecording(intent)
            ACTION_STOP -> stopRecording()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        cleanup()
        super.onDestroy()
    }

    /**
     * Start screen recording.
     */
    private fun startRecording(intent: Intent) {
        if (isRecording) {
            Log.w(TAG, "Already recording")
            return
        }

        currentCommandId = intent.getStringExtra(EXTRA_COMMAND_ID)

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, pendingResultCode)
        val data = intent.getParcelableExtra<Intent>(EXTRA_DATA) ?: pendingData

        if (data == null || resultCode == 0) {
            Log.e(TAG, "No MediaProjection result available. User must approve consent first.")
            updateCommandStatus(currentCommandId, "FAILED",
                error = "Screen capture consent not approved. User must approve the MediaProjection dialog.")
            stopSelf()
            return
        }

        try {
            // Start foreground service with mediaProjection type
            val notification = buildNotification("Screen recording in progress...")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    Constants.NOTIF_ID_SCREEN_RECORD,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
            } else {
                startForeground(Constants.NOTIF_ID_SCREEN_RECORD, notification)
            }

            // Initialize MediaProjection
            val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = projectionManager.getMediaProjection(resultCode, data)

            if (mediaProjection == null) {
                updateCommandStatus(currentCommandId, "FAILED", error = "Failed to obtain MediaProjection")
                stopSelf()
                return
            }

            // Create output file
            val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
            val recordingsDir = File(filesDir, "recordings")
            if (!recordingsDir.exists()) recordingsDir.mkdirs()
            outputFile = File(recordingsDir, "screen_recording_$timeStamp.mp4")

            // Configure MediaRecorder
            val metrics = DisplayMetrics()
            val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            windowManager.defaultDisplay.getRealMetrics(metrics)

            val width = metrics.widthPixels
            val height = metrics.heightPixels
            val density = metrics.densityDpi

            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(this)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            mediaRecorder?.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setVideoSource(MediaRecorder.VideoSource.SURFACE)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setOutputFile(outputFile!!.absolutePath)
                setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setVideoEncodingBitRate(5000000)
                setVideoFrameRate(30)
                setVideoSize(width, height)
                prepare()
            }

            // Create VirtualDisplay
            val surface: Surface = mediaRecorder!!.surface
            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "ScreenRecord",
                width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                surface, null, null
            )

            // Start recording
            mediaRecorder?.start()
            isRecording = true

            Log.d(TAG, "Screen recording started: ${outputFile?.absolutePath}")
            updateCommandStatus(currentCommandId, "EXECUTING", result = "Recording started")

        } catch (e: Exception) {
            Log.e(TAG, "Start recording error: ${e.message}", e)
            updateCommandStatus(currentCommandId, "FAILED", error = "Failed to start recording: ${e.message}")
            cleanup()
            stopSelf()
        }
    }

    /**
     * Stop screen recording and upload the video.
     */
    private fun stopRecording() {
        if (!isRecording) {
            Log.w(TAG, "Not recording")
            stopSelf()
            return
        }

        try {
            mediaRecorder?.stop()
            isRecording = false
            Log.d(TAG, "Screen recording stopped")

            // Upload the video file
            val file = outputFile
            if (file != null && file.exists()) {
                serviceScope.launch {
                    uploadRecording(file)
                }
            } else {
                updateCommandStatus(currentCommandId, "FAILED", error = "Recording file not found")
                cleanup()
                stopSelf()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Stop recording error: ${e.message}", e)
            updateCommandStatus(currentCommandId, "FAILED", error = "Failed to stop recording: ${e.message}")
            cleanup()
            stopSelf()
        }
    }

    /**
     * Upload the recording to the server via /api/upload.
     */
    private suspend fun uploadRecording(file: File) {
        try {
            val app = application as DeviceManagerApp
            val deviceId = app.preferences.deviceId

            val requestFile = file.asRequestBody("video/mp4".toMediaTypeOrNull())
            val body = MultipartBody.Part.createFormData("file", file.name, requestFile)
            val deviceIdBody = deviceId.toRequestBody("text/plain".toMediaTypeOrNull())
            val fileTypeBody = Constants.FILE_TYPE_SCREEN_RECORDING.toRequestBody("text/plain".toMediaTypeOrNull())

            val response = app.apiService.uploadFile(deviceIdBody, fileTypeBody, body)

            if (response.isSuccessful) {
                Log.d(TAG, "Recording uploaded successfully")
                updateCommandStatus(currentCommandId, "COMPLETED",
                    result = "Recording uploaded: ${file.name} (${file.length()} bytes)")
            } else {
                updateCommandStatus(currentCommandId, "FAILED",
                    error = "Upload failed: HTTP ${response.code()}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Upload recording error: ${e.message}", e)
            updateCommandStatus(currentCommandId, "FAILED",
                error = "Upload failed: ${e.message}")
        } finally {
            cleanup()
            stopSelf()
        }
    }

    /**
     * Clean up resources.
     */
    private fun cleanup() {
        try {
            virtualDisplay?.release()
            virtualDisplay = null
            mediaRecorder?.release()
            mediaRecorder = null
            mediaProjection?.stop()
            mediaProjection = null
        } catch (e: Exception) {
            Log.e(TAG, "Cleanup error: ${e.message}", e)
        }
        isRecording = false
    }

    /**
     * Update command status via WebSocket or REST.
     */
    private fun updateCommandStatus(commandId: String?, status: String, result: String? = null, error: String? = null) {
        if (commandId.isNullOrBlank()) return
        serviceScope.launch {
            try {
                val app = application as DeviceManagerApp
                val sent = app.webSocketClient.sendCommandStatus(commandId, status, result, error)
                if (!sent) {
                    app.deviceRepository.updateCommandStatus(commandId, status, result, error)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Update command status error: ${e.message}", e)
            }
        }
    }

    // ── Notification helpers ─────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                Constants.CHANNEL_SCREEN_RECORD,
                "Screen Recording",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Screen recording service notification"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(contentText: String): Notification {
        return NotificationCompat.Builder(this, Constants.CHANNEL_SCREEN_RECORD)
            .setContentTitle("Screen Recording")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
