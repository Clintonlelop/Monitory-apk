package com.example.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.example.DeviceManagerApp
import com.example.R
import kotlinx.coroutines.launch
import java.io.File

class ScreenRecordService : Service() {
    private var mediaProjection: MediaProjection? = null
    private var mediaRecorder: MediaRecorder? = null
    private var virtualDisplay: android.hardware.display.VirtualDisplay? = null
    private var videoFile: File? = null
    private var commandId: String = ""

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == "START") {
            val resultCode = intent.getIntExtra("result_code", 0)
            val resultData = intent.getParcelableExtra<Intent>("result_data")
            commandId = intent.getStringExtra("command_id") ?: ""

            if (resultCode != 0 && resultData != null) {
                startRecording(resultCode, resultData)
            } else {
                stopSelf()
            }
        } else if (action == "STOP") {
            stopRecording()
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startRecording(resultCode: Int, resultData: Intent) {
        // Start foreground with notification first to satisfy background restrictions
        val notification = createNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(2002, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(2002, notification)
        }

        try {
            val mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = mediaProjectionManager.getMediaProjection(resultCode, resultData)

            val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val metrics = DisplayMetrics()
            windowManager.defaultDisplay.getRealMetrics(metrics)
            
            // Limit recording resolution to 720p for max stability and performance
            val screenWidth = if (metrics.widthPixels > 720) 720 else metrics.widthPixels
            val screenHeight = if (metrics.heightPixels > 1280) 1280 else metrics.heightPixels
            val density = metrics.densityDpi

            videoFile = File(cacheDir, "screen_rec_${System.currentTimeMillis()}.mp4")

            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(this)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }.apply {
                setVideoSource(MediaRecorder.VideoSource.SURFACE)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                setVideoSize(screenWidth, screenHeight)
                setVideoEncodingBitRate(3_000_000) // 3 Mbps
                setVideoFrameRate(25)
                setOutputFile(videoFile!!.absolutePath)
                prepare()
            }

            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "ScreenRecorder",
                screenWidth,
                screenHeight,
                density,
                android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                mediaRecorder?.surface,
                null,
                null
            )

            mediaRecorder?.start()
            Log.d("ScreenRecord", "Screen recording started successfully")

            val app = application as DeviceManagerApp
            app.repository.scope.launch {
                app.repository.reportCommandSuccess(commandId, "Screen recording session authorized and started successfully.")
            }

        } catch (e: Exception) {
            Log.e("ScreenRecord", "Failed to start recording: ${e.message}", e)
            val app = application as DeviceManagerApp
            app.repository.scope.launch {
                app.repository.reportCommandFailure(commandId, "Screen recording failed to start: ${e.message}")
            }
            stopSelf()
        }
    }

    private fun stopRecording() {
        try {
            mediaRecorder?.stop()
        } catch (e: Exception) {
            Log.e("ScreenRecord", "Error stopping recorder: ${e.message}")
        }
        mediaRecorder?.release()
        mediaRecorder = null

        virtualDisplay?.release()
        virtualDisplay = null

        mediaProjection?.stop()
        mediaProjection = null

        val file = videoFile
        if (file != null && file.exists()) {
            val app = application as DeviceManagerApp
            app.repository.scope.launch {
                val success = app.repository.uploadGenericFile(file, "/uploads/screen_${file.name}")
                if (success) {
                    app.repository.syncFilesList()
                }
                file.delete()
            }
        }
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, "screen_rec_channel")
            .setContentTitle("Screen Recorder Active")
            .setContentText("Recording phone screen to dashboard...")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "screen_rec_channel",
                "Screen Recording Monitor",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
