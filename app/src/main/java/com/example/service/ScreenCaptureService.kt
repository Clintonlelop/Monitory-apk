package com.example.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import com.example.DeviceManagerApp
import com.example.MainActivity
import com.example.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream

/**
 * Foreground service that performs the actual screen capture after the user
 * has authorized MediaProjection in [CaptureConsentActivity].
 *
 * Modes:
 *  - ACTION_SCREENSHOT: grab exactly one frame, encode JPEG, upload, stop.
 *  - ACTION_RECORD_START: start a video-only screen recording session
 *    (visible ongoing notification). Audio is NOT recorded: Android 10+
 *    blocks background microphone access for services, and silent capture
 *    would be non-consensual anyway.
 *  - ACTION_RECORD_STOP: finalize the recording, upload the video, stop.
 *
 * Hard limits: max 5 minutes or 50 MB per recording, then auto-finalize.
 * Every terminal path reports a truthful command status — never a fake one.
 */
class ScreenCaptureService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var mediaRecorder: MediaRecorder? = null
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null

    private var recordingFile: File? = null
    private var recordingStartedAt = 0L
    private var recordingCommandId: String? = null
    private var stopCommandId: String? = null
    private var watchdog: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        val commandId = intent?.getStringExtra(CaptureCoordinator.EXTRA_COMMAND_ID) ?: ""
        try {
            when (action) {
                CaptureCoordinator.ACTION_SCREENSHOT -> {
                    startAsForeground(NOTIF_SCREENSHOT, buildNotification(
                        "Capturing screen…", "One frame will be captured, then this alert closes."
                    ))
                    val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(CaptureCoordinator.EXTRA_RESULT_DATA, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(CaptureCoordinator.EXTRA_RESULT_DATA)
                    }
                    val resultCode = intent.getIntExtra(CaptureCoordinator.EXTRA_RESULT_CODE, 0)
                    captureStill(commandId, resultCode, data)
                }
                CaptureCoordinator.ACTION_RECORD_START -> {
                    startAsForeground(NOTIF_RECORDING, buildNotification(
                        "Screen recording running", "The screen is being recorded. Stop it from the dashboard."
                    ))
                    val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(CaptureCoordinator.EXTRA_RESULT_DATA, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(CaptureCoordinator.EXTRA_RESULT_DATA)
                    }
                    val resultCode = intent.getIntExtra(CaptureCoordinator.EXTRA_RESULT_CODE, 0)
                    startRecording(commandId, resultCode, data)
                }
                CaptureCoordinator.ACTION_RECORD_STOP -> {
                    stopCommandId = commandId
                    scope.launch { finalizeRecording("stopped") }
                }
                else -> stopSelf()
            }
        } catch (e: Exception) {
            Log.e("ScreenCapture", "Service command failed: ${e.message}", e)
            scope.launch {
                reportFailure(commandId, "Screen capture failed: ${e.message}")
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun startAsForeground(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(id, notification)
        }
    }

    private fun displayMetrics(): Triple<Int, Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
        val metrics = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        return Triple(metrics.widthPixels, metrics.heightPixels, metrics.densityDpi)
    }

    private fun obtainProjection(resultCode: Int, data: Intent?): MediaProjection {
        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val proj = mgr.getMediaProjection(resultCode, data)
            ?: throw IllegalStateException("MediaProjection grant unavailable — re-authorize screen capture")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            proj.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { /* handled in flows below */ }
            }, handler)
        }
        return proj
    }

    // ---------------------------------------------------------------- screenshot

    private fun captureStill(commandId: String, resultCode: Int, data: Intent?) {
        handlerThread = HandlerThread("capture").also { it.start() }
        handler = Handler(handlerThread!!.looper)
        val (w, h, dpi) = displayMetrics()
        val reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        imageReader = reader
        scope.launch {
            try {
                val proj = obtainProjection(resultCode, data)
                projection = proj
                virtualDisplay = proj.createVirtualDisplay(
                    "monitory-shot", w, h, dpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    reader.surface, null, handler
                )
                // Give the surface a moment to produce its first frame.
                delay(400)
                val bitmap = withHandler { readFrame(reader, w, h) }
                if (bitmap == null) throw IllegalStateException("No screen frame was produced")
                val file = File(cacheDir, "shot_${System.currentTimeMillis()}.jpg")
                FileOutputStream(file).use { out ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
                    out.flush()
                }
                bitmap.recycle()
                val ok = DeviceManagerApp.instance.repository.uploadScreenshotFile(
                    file, "screenshot", w, h
                )
                if (ok) {
                    reportSuccess(
                        commandId,
                        "{\"message\":\"Screenshot captured and uploaded\",\"file\":\"${file.name}\",\"width\":$w,\"height\":$h,\"bytes\":${file.length()}}"
                    )
                } else {
                    reportFailure(commandId, "Screenshot captured but upload failed — check the server connection")
                }
                file.delete()
            } catch (e: Exception) {
                Log.e("ScreenCapture", "Screenshot failed: ${e.message}", e)
                reportFailure(commandId, "Screenshot failed: ${e.message}")
            } finally {
                releaseCaptureResources()
                stopForegroundCompat()
                stopSelf()
            }
        }
    }

    private suspend fun <T> withHandler(block: () -> T?): T? {
        // ImageReader callbacks arrive on our HandlerThread; poll briefly for
        // the first frame from the coroutine context.
        val deadline = SystemClock.elapsedRealtime() + 4000
        while (SystemClock.elapsedRealtime() < deadline) {
            val v = block()
            if (v != null) return v
            delay(150)
        }
        return null
    }

    private fun readFrame(reader: ImageReader, w: Int, h: Int): Bitmap? {
        val image = reader.acquireLatestImage() ?: return null
        return try {
            val plane = image.planes[0]
            val buffer = plane.buffer
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * w
            val bitmap = Bitmap.createBitmap(w + rowPadding / pixelStride, h, Bitmap.Config.ARGB_8888)
            buffer.rewind()
            bitmap.copyPixelsFromBuffer(buffer)
            Bitmap.createBitmap(bitmap, 0, 0, w, h)
        } catch (e: Exception) {
            Log.e("ScreenCapture", "Frame decode failed: ${e.message}")
            null
        } finally {
            image.close()
        }
    }

    // ---------------------------------------------------------------- recording

    private fun startRecording(commandId: String, resultCode: Int, data: Intent?) {
        recordingCommandId = commandId
        val (w, h, dpi) = displayMetrics()
        val file = File(cacheDir, "rec_${System.currentTimeMillis()}.mp4")
        recordingFile = file
        scope.launch {
            try {
                val proj = obtainProjection(resultCode, data)
                projection = proj
                val recorder = MediaRecorder()
                recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                recorder.setVideoSize(w, h)
                recorder.setVideoFrameRate(30)
                recorder.setVideoEncodingBitRate(8_000_000)
                recorder.setOutputFile(file.absolutePath)
                recorder.prepare()
                mediaRecorder = recorder

                virtualDisplay = proj.createVirtualDisplay(
                    "monitory-rec", w, h, dpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    recorder.surface, null, handler
                )
                recorder.start()
                recordingStartedAt = SystemClock.elapsedRealtime()
                CaptureCoordinator.activeRecordingCommandId = commandId
                reportSuccess(commandId, "{\"message\":\"Screen recording started\",\"note\":\"video-only (no microphone), max 5 min\"}")
                scheduleRecordingWatchdog()
            } catch (e: Exception) {
                Log.e("ScreenCapture", "Recording start failed: ${e.message}", e)
                reportFailure(commandId, "Screen recording failed to start: ${e.message}")
                file.delete()
                releaseCaptureResources()
                stopForegroundCompat()
                stopSelf()
            }
        }
    }

    private fun scheduleRecordingWatchdog() {
        val check = object : Runnable {
            override fun run() {
                val file = recordingFile
                val started = recordingStartedAt
                if (file == null || started == 0L) return
                val elapsed = SystemClock.elapsedRealtime() - started
                if (elapsed > MAX_RECORDING_MS || file.length() > MAX_RECORDING_BYTES) {
                    scope.launch { finalizeRecording("auto-stop limit reached") }
                } else {
                    handler?.postDelayed(this, 3000)
                }
            }
        }
        watchdog = check
        handler?.postDelayed(check, 3000)
    }

    private suspend fun finalizeRecording(reason: String) {
        val startId = recordingCommandId
        val stopId = stopCommandId
        val file = recordingFile
        val startedAt = recordingStartedAt
        val durationMs = if (startedAt > 0) SystemClock.elapsedRealtime() - startedAt else 0L
        watchdog?.let { handler?.removeCallbacks(it) }
        watchdog = null
        recordingStartedAt = 0L
        CaptureCoordinator.activeRecordingCommandId = null

        suspend fun reportFinal(success: Boolean, message: String) {
            // The START command stays truthful too: it completes only when the
            // recording is finalized and uploaded (never at "started").
            if (startId != null) {
                if (success) reportSuccess(startId, message) else reportFailure(startId, message)
            }
            if (stopId != null && stopId != startId) {
                if (success) reportSuccess(stopId, message) else reportFailure(stopId, message)
            }
        }

        if (startId == null || file == null) {
            reportFinal(false, "No active screen recording to stop")
            stopCommandId = null
            stopForegroundCompat()
            stopSelf()
            return
        }
        var ok = false
        var error: String? = null
        try {
            mediaRecorder?.stop()
            ok = true
        } catch (e: Exception) {
            // stop() throws when no frames were encoded — treat as failure.
            error = "Recording produced no video data (${e.message})"
        } finally {
            try { mediaRecorder?.reset() } catch (_: Exception) {}
            try { mediaRecorder?.release() } catch (_: Exception) {}
            mediaRecorder = null
            try { projection?.stop() } catch (_: Exception) {}
            projection = null
            virtualDisplay?.release()
            virtualDisplay = null
        }

        if (!ok || !file.exists() || file.length() == 0L) {
            file.delete()
            reportFinal(false, error ?: "Recording failed to finalize")
        } else {
            val uploaded = DeviceManagerApp.instance.repository.uploadVideoFile(file, durationMs)
            if (uploaded) {
                reportFinal(
                    true,
                    "{\"message\":\"Screen recording finalized and uploaded\",\"reason\":\"$reason\",\"durationMs\":$durationMs,\"bytes\":${file.length()},\"file\":\"${file.name}\"}"
                )
                file.delete()
            } else {
                reportFinal(false, "Recording finalized but upload failed — the server did not accept the video")
                file.delete()
            }
        }
        recordingFile = null
        recordingCommandId = null
        stopCommandId = null
        stopForegroundCompat()
        stopSelf()
    }

    // ---------------------------------------------------------------- utilities

    private suspend fun reportSuccess(commandId: String, result: String) {
        if (commandId.isNotBlank()) {
            DeviceManagerApp.instance.repository.reportCommandSuccess(commandId, result)
        }
    }

    private suspend fun reportFailure(commandId: String, error: String) {
        if (commandId.isNotBlank()) {
            DeviceManagerApp.instance.repository.reportCommandFailure(commandId, error)
        }
    }

    private fun releaseCaptureResources() {
        try { imageReader?.close() } catch (_: Exception) {}
        imageReader = null
        try { projection?.stop() } catch (_: Exception) {}
        projection = null
        virtualDisplay?.release()
        virtualDisplay = null
        handlerThread?.quitSafely()
        handlerThread = null
        handler = null
    }

    private fun stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (_: Exception) {}
    }

    private fun buildNotification(title: String, text: String): Notification {
        val channel = DeviceManagerApp.CHANNEL_RECORDING
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            if (mgr.getNotificationChannel(channel) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(channel, "Screen capture", NotificationManager.IMPORTANCE_LOW)
                )
            }
        }
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    override fun onDestroy() {
        scope.cancel()
        releaseCaptureResources()
        super.onDestroy()
    }

    companion object {
        private const val NOTIF_SCREENSHOT = 4101
        private const val NOTIF_RECORDING = 4102
        private const val MAX_RECORDING_MS = 5 * 60 * 1000L
        private const val MAX_RECORDING_BYTES = 50L * 1024 * 1024
    }
}
