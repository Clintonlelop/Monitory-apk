package com.devicemanager.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.Choreographer
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.devicemanager.DeviceManagerApp
import com.devicemanager.R
import com.devicemanager.manager.AdaptiveStreamManager
import com.devicemanager.util.Constants
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * Foreground service for real-time screen streaming via WebSocket.
 *
 * Uses MediaProjection + VirtualDisplay + ImageReader to capture screen frames,
 * compresses to JPEG, and sends as base64 over WebSocket.
 *
 * Requires:
 * - MediaProjection user consent (result code + data from consent dialog)
 * - Foreground service permission
 *
 * Connection quality monitoring (Feature 5):
 * - Ping/latency via WebSocket ping/pong
 * - Jitter from latency variance
 * - Packet loss from frame sequence numbers
 * - Upload/download speed tracking
 * - Connection type from ConnectivityManager
 * - Reconnection attempt tracking
 */
class ScreenStreamService : Service() {
    companion object {
        private const val TAG = "ScreenStreamService"

        const val ACTION_START = "com.devicemanager.START_SCREEN_STREAM"
        const val ACTION_STOP = "com.devicemanager.STOP_SCREEN_STREAM"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "data"
        const val EXTRA_COMMAND_ID = "command_id"
        const val EXTRA_TARGET_FPS = "target_fps"
        const val EXTRA_TARGET_QUALITY = "target_quality"
        const val EXTRA_LOW_LATENCY = "low_latency"

        // Static reference for MediaProjection result (set by MainActivity)
        var pendingResultCode: Int = 0
        var pendingData: Intent? = null

        // Singleton instance for external control (e.g., from WebSocket message handlers)
        @Volatile
        var instance: ScreenStreamService? = null
            private set
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var streamJob: Job? = null
    private var pingJob: Job? = null

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null
    private var choreographer: Choreographer? = null

    private var currentCommandId: String? = null
    private var isStreaming = false
    private var sessionStartTimeMs: Long = 0

    // Frame tracking
    private var lastFrameTimeMs: Long = 0
    private var frameSequence: Long = 0
    private var framesSent: Long = 0
    private var framesAcked: Long = 0

    // Connection quality metrics
    private var bytesSent: Long = 0
    private var bytesReceived: Long = 0
    private var lastSpeedCalcMs: Long = 0
    private var lastBytesSent: Long = 0
    private var lastBytesReceived: Long = 0
    private var uploadSpeedKbps: Int = 0
    private var downloadSpeedKbps: Int = 0
    private var reconnectionAttempts: Int = 0
    private var wsState: String = "disconnected"

    // Ping tracking
    private var pendingPingTime: Long = 0
    private var pingSequence: Int = 0

    private lateinit var adaptiveManager: AdaptiveStreamManager
    private lateinit var gson: Gson

    // Vsync callback for low-latency mode
    private val vsyncCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (isStreaming && adaptiveManager.lowLatencyMode) {
                captureAndSendFrame()
                choreographer?.postFrameCallback(this)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        gson = (application as DeviceManagerApp).gson
        adaptiveManager = AdaptiveStreamManager(this)
        adaptiveManager.onQualityReport = { report -> sendQualityReport(report) }
        Log.d(TAG, "ScreenStreamService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startStreaming(intent)
            ACTION_STOP -> stopStreaming()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        cleanup()
        instance = null
        super.onDestroy()
        Log.d(TAG, "ScreenStreamService destroyed")
    }

    /**
     * Start screen streaming.
     */
    private fun startStreaming(intent: Intent) {
        if (isStreaming) {
            Log.w(TAG, "Already streaming")
            return
        }

        currentCommandId = intent.getStringExtra(EXTRA_COMMAND_ID)
        val targetFps = intent.getIntExtra(EXTRA_TARGET_FPS, 30)
        val targetQuality = intent.getIntExtra(EXTRA_TARGET_QUALITY, AdaptiveStreamManager.QUALITY_MEDIUM)
        val lowLatency = intent.getBooleanExtra(EXTRA_LOW_LATENCY, false)

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
            // Start foreground service
            val notification = buildNotification("Screen sharing active")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    Constants.NOTIF_ID_SCREEN_STREAM,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
            } else {
                startForeground(Constants.NOTIF_ID_SCREEN_STREAM, notification)
            }

            // Initialize MediaProjection
            val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = projectionManager.getMediaProjection(resultCode, data)

            if (mediaProjection == null) {
                updateCommandStatus(currentCommandId, "FAILED", error = "Failed to obtain MediaProjection")
                stopSelf()
                return
            }

            // Get display metrics
            val metrics = DisplayMetrics()
            val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            windowManager.defaultDisplay.getRealMetrics(metrics)

            val width = metrics.widthPixels
            val height = metrics.heightPixels
            val density = metrics.densityDpi

            // Create ImageReader
            handlerThread = HandlerThread("ScreenCaptureThread").apply { start() }
            handler = Handler(handlerThread!!.looper)

            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
            imageReader?.setOnImageAvailableListener({ reader ->
                // Image available — capture handled in the main loop for pacing
            }, handler)

            // Create VirtualDisplay
            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "ScreenStream",
                width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader?.surface, null, null
            )

            // Start adaptive manager
            adaptiveManager.start(targetFps, targetQuality, lowLatency)
            adaptiveManager.recordNetworkType(getConnectionType())

            // Reset metrics
            sessionStartTimeMs = System.currentTimeMillis()
            frameSequence = 0
            framesSent = 0
            framesAcked = 0
            bytesSent = 0
            bytesReceived = 0
            reconnectionAttempts = 0
            lastSpeedCalcMs = System.currentTimeMillis()

            isStreaming = true
            wsState = "connected"

            // Start streaming loop
            if (lowLatency) {
                choreographer = Choreographer.getInstance()
                choreographer?.postFrameCallback(vsyncCallback)
            }
            startStreamingLoop()
            startPingLoop()
            startSpeedMonitor()

            Log.d(TAG, "Screen streaming started: ${width}x${height}, fps=$targetFps, quality=$targetQuality, lowLatency=$lowLatency")
            updateCommandStatus(currentCommandId, "EXECUTING", result = "Screen streaming started")

        } catch (e: Exception) {
            Log.e(TAG, "Start streaming error: ${e.message}", e)
            updateCommandStatus(currentCommandId, "FAILED", error = "Failed to start streaming: ${e.message}")
            cleanup()
            stopSelf()
        }
    }

    /**
     * Stop screen streaming.
     */
    private fun stopStreaming() {
        if (!isStreaming) {
            stopSelf()
            return
        }

        Log.d(TAG, "Stopping screen streaming")
        isStreaming = false
        adaptiveManager.stop()

        val durationSec = (System.currentTimeMillis() - sessionStartTimeMs) / 1000
        updateCommandStatus(currentCommandId, "COMPLETED",
            result = "Screen streaming stopped. Duration: ${durationSec}s, Frames: $framesSent")

        cleanup()
        stopSelf()
    }

    /**
     * Main streaming loop — captures frames at adaptive interval.
     */
    private fun startStreamingLoop() {
        streamJob?.cancel()
        streamJob = serviceScope.launch {
            while (isStreaming) {
                if (!adaptiveManager.lowLatencyMode) {
                    if (adaptiveManager.shouldSendFrame(lastFrameTimeMs)) {
                        captureAndSendFrame()
                    }
                    delay(5) // Small sleep to avoid busy-wait
                } else {
                    // Low-latency mode uses vsync callback, just yield
                    delay(16)
                }
            }
        }
    }

    /**
     * Capture a frame from ImageReader and send via WebSocket.
     */
    private fun captureAndSendFrame() {
        if (!isStreaming) return

        val reader = imageReader ?: return
        val image: Image = try {
            reader.acquireLatestImage() ?: return
        } catch (e: Exception) {
            Log.e(TAG, "Acquire image error: ${e.message}", e)
            return
        }

        try {
            val planes = image.planes
            val buffer: ByteBuffer = planes[0].buffer
            val pixelStride = planes[0].pixelStride
            val rowStride = planes[0].rowStride
            val rowPadding = rowStride - pixelStride * image.width

            val width = image.width
            val height = image.height

            // Apply resolution scale from adaptive manager
            val scale = adaptiveManager.currentResolutionScale
            val scaledWidth = (width * scale).toInt()
            val scaledHeight = (height * scale).toInt()

            val bitmap = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888)
            bitmap.copyPixelsFromBuffer(buffer)

            // Crop to actual width if there's row padding
            val croppedBitmap = if (rowPadding > 0) {
                Bitmap.createBitmap(bitmap, 0, 0, width, height)
            } else {
                bitmap
            }

            // Scale if needed
            val finalBitmap = if (scale < 1.0f) {
                Bitmap.createScaledBitmap(croppedBitmap, scaledWidth, scaledHeight, true)
            } else {
                croppedBitmap
            }

            // Compress to JPEG with adaptive quality
            val stream = ByteArrayOutputStream()
            finalBitmap.compress(Bitmap.CompressFormat.JPEG, adaptiveManager.currentQuality, stream)
            val jpegBytes = stream.toByteArray()
            stream.close()

            if (croppedBitmap !== bitmap) bitmap.recycle()
            if (finalBitmap !== croppedBitmap) croppedBitmap.recycle()
            if (finalBitmap !== bitmap) finalBitmap.recycle()

            // Send frame via WebSocket
            sendScreenFrame(jpegBytes, scaledWidth, scaledHeight)

            lastFrameTimeMs = System.currentTimeMillis()
            framesSent++
            bytesSent += jpegBytes.size
            adaptiveManager.recordFrameSent(jpegBytes.size)

        } catch (e: Exception) {
            Log.e(TAG, "Frame capture error: ${e.message}", e)
        } finally {
            try { image.close() } catch (_: Exception) {}
        }
    }

    /**
     * Send a screen frame as base64 JPEG over WebSocket.
     */
    private fun sendScreenFrame(jpegBytes: ByteArray, width: Int, height: Int) {
        try {
            val app = application as DeviceManagerApp
            val base64 = android.util.Base64.encodeToString(jpegBytes, android.util.Base64.NO_WRAP)

            val message = mapOf(
                "type" to "SCREEN_FRAME",
                "device_id" to app.preferences.deviceId,
                "frame_data" to base64,
                "width" to width,
                "height" to height,
                "timestamp" to System.currentTimeMillis(),
                "fps" to adaptiveManager.currentFps,
                "quality" to adaptiveManager.currentQuality,
                "sequence" to frameSequence++
            )

            val json = gson.toJson(message)
            app.webSocketClient.sendMessage(json)
        } catch (e: Exception) {
            Log.e(TAG, "Send frame error: ${e.message}", e)
        }
    }

    /**
     * Send quality report to dashboard.
     */
    private fun sendQualityReport(report: AdaptiveStreamManager.QualityReport) {
        try {
            val app = application as DeviceManagerApp
            val packetLoss = if (framesSent > 0) {
                ((framesSent - framesAcked).toFloat() / framesSent.toFloat() * 100).coerceIn(0f, 100f)
            } else 0f

            val message = mapOf(
                "type" to "QUALITY_REPORT",
                "device_id" to app.preferences.deviceId,
                "latency_ms" to report.latencyMs,
                "jitter_ms" to report.jitterMs,
                "packet_loss_pct" to packetLoss,
                "fps" to report.fps,
                "resolution" to report.resolution,
                "bitrate_kbps" to report.bitrateKbps,
                "network_type" to report.networkType,
                "quality" to report.quality,
                "frame_interval_ms" to report.frameIntervalMs,
                "low_latency" to report.lowLatency,
                "adjustment_reason" to report.adjustmentReason,
                "input_latency_ms" to report.inputLatencyMs,
                "upload_speed_kbps" to uploadSpeedKbps,
                "download_speed_kbps" to downloadSpeedKbps,
                "ws_state" to wsState,
                "reconnection_attempts" to reconnectionAttempts,
                "battery_temp" to report.batteryTemp,
                "battery_level" to report.batteryLevel,
                "cpu_load" to report.cpuLoad,
                "session_duration_ms" to (System.currentTimeMillis() - sessionStartTimeMs),
                "timestamp" to System.currentTimeMillis()
            )

            app.webSocketClient.sendMessage(gson.toJson(message))
        } catch (e: Exception) {
            Log.e(TAG, "Send quality report error: ${e.message}", e)
        }
    }

    // ── Connection quality monitoring ────────────────────────────────

    /**
     * Ping loop — send ping every 3s and measure pong response time.
     */
    private fun startPingLoop() {
        pingJob?.cancel()
        pingJob = serviceScope.launch {
            while (isStreaming) {
                delay(3000)
                sendPing()
            }
        }
    }

    private fun sendPing() {
        try {
            val app = application as DeviceManagerApp
            pendingPingTime = System.currentTimeMillis()
            pingSequence++
            val message = mapOf(
                "type" to "PING",
                "seq" to pingSequence,
                "timestamp" to pendingPingTime
            )
            app.webSocketClient.sendMessage(gson.toJson(message))
        } catch (e: Exception) {
            Log.e(TAG, "Ping error: ${e.message}", e)
        }
    }

    /**
     * Called when a PONG is received — calculate latency.
     */
    fun onPongReceived(seq: Int) {
        if (pendingPingTime > 0) {
            val latency = System.currentTimeMillis() - pendingPingTime
            adaptiveManager.recordLatency(latency)
            pendingPingTime = 0
            Log.d(TAG, "Ping/pong latency: ${latency}ms")
        }
    }

    /**
     * Monitor upload/download speeds.
     */
    private fun startSpeedMonitor() {
        serviceScope.launch {
            while (isStreaming) {
                delay(2000)
                val now = System.currentTimeMillis()
                val elapsed = (now - lastSpeedCalcMs) / 1000.0
                if (elapsed > 0) {
                    uploadSpeedKbps = ((bytesSent - lastBytesSent) * 8 / elapsed / 1000).toInt()
                    downloadSpeedKbps = ((bytesReceived - lastBytesReceived) * 8 / elapsed / 1000).toInt()
                    lastBytesSent = bytesSent
                    lastBytesReceived = bytesReceived
                    lastSpeedCalcMs = now
                }
            }
        }
    }

    /**
     * Get current connection type.
     */
    private fun getConnectionType(): String {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = cm.activeNetwork ?: return "NONE"
            val capabilities = cm.getNetworkCapabilities(network) ?: return "UNKNOWN"
            when {
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        when {
                            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_TEMPORARILY_NOT_METERED) -> "5G"
                            else -> "4G"
                        }
                    } else "CELLULAR"
                }
                else -> "UNKNOWN"
            }
        } catch (e: Exception) {
            "UNKNOWN"
        }
    }

    /**
     * Called when WebSocket reconnects.
     */
    fun onReconnected() {
        reconnectionAttempts++
        wsState = "connected"
        Log.d(TAG, "WebSocket reconnected (attempt $reconnectionAttempts)")
    }

    /**
     * Called when WebSocket disconnects.
     */
    fun onDisconnected() {
        wsState = "disconnected"
    }

    /**
     * Update stream targets from dashboard STREAM_CONTROL.
     */
    fun updateStreamTargets(targetFps: Int?, targetQuality: Int?, lowLatency: Boolean?) {
        adaptiveManager.updateTargets(targetFps, targetQuality, lowLatency)

        // If switching to low-latency mode, start vsync capture
        if (lowLatency == true && adaptiveManager.lowLatencyMode) {
            if (choreographer == null) {
                choreographer = Choreographer.getInstance()
            }
            choreographer?.removeFrameCallback(vsyncCallback)
            choreographer?.postFrameCallback(vsyncCallback)
        } else if (lowLatency == false) {
            choreographer?.removeFrameCallback(vsyncCallback)
        }
    }

    /**
     * Get session duration in milliseconds.
     */
    fun getSessionDurationMs(): Long {
        return if (sessionStartTimeMs > 0) System.currentTimeMillis() - sessionStartTimeMs else 0
    }

    // ── Cleanup ──────────────────────────────────────────────────────

    private fun cleanup() {
        try {
            streamJob?.cancel()
            pingJob?.cancel()
            choreographer?.removeFrameCallback(vsyncCallback)
            virtualDisplay?.release()
            virtualDisplay = null
            imageReader?.close()
            imageReader = null
            handlerThread?.quitSafely()
            handlerThread = null
            mediaProjection?.stop()
            mediaProjection = null
        } catch (e: Exception) {
            Log.e(TAG, "Cleanup error: ${e.message}", e)
        }
        isStreaming = false
    }

    // ── Command status helper ────────────────────────────────────────

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
                Constants.CHANNEL_SCREEN_STREAM,
                "Screen Streaming",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Screen sharing and remote control notification"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(contentText: String): Notification {
        return NotificationCompat.Builder(this, Constants.CHANNEL_SCREEN_STREAM)
            .setContentTitle("Screen Sharing")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
