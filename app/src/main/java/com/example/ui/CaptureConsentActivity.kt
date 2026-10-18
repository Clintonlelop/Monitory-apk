package com.example.ui

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import com.example.DeviceManagerApp
import com.example.service.CaptureCoordinator
import com.example.service.ScreenCaptureService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

/**
 * Visible, consent-based capture flow. Opened by tapping the pending-request
 * notification. Shows exactly what the dashboard asked for; nothing is
 * captured unless the user taps Allow AND passes the Android system dialog
 * (MediaProjection) or the system camera app (photo).
 */
class CaptureConsentActivity : Activity() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var acted = false
    private var photoFile: File? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pending = CaptureCoordinator.pending
        if (pending == null) {
            Toast.makeText(this, "No capture request is waiting.", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val (title, body) = when (pending.mode) {
            CaptureCoordinator.MODE_SCREENSHOT -> "Screen capture requested" to
                "The management dashboard asked for a single screenshot of this screen.\n\n" +
                "Android will show its system screen-capture dialog next. The capture is one frame " +
                "only, uploaded over the authenticated connection, and visible in the dashboard history."
            CaptureCoordinator.MODE_RECORD_START -> "Screen recording requested" to
                "The management dashboard asked to start recording this screen (video, no microphone, " +
                "max 5 minutes).\n\nA visible notification stays active while recording. Android will " +
                "show its system screen-capture dialog next."
            CaptureCoordinator.MODE_PHOTO -> "Photo requested" to
                "The management dashboard asked for a photo. The system camera app will open — " +
                "you control the shutter. The photo is uploaded only after you take it."
            else -> "Capture requested" to "The management dashboard requested a capture."
        }

        val root = ScrollView(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 48)
        }
        val titleView = TextView(this).apply {
            text = title
            textSize = 22f
            gravity = Gravity.START
        }
        val bodyView = TextView(this).apply {
            text = body
            textSize = 15f
            setPadding(0, 24, 0, 32)
        }
        val allow = Button(this).apply {
            text = "Allow"
            setOnClickListener { onAllow(pending.mode, pending.commandId) }
        }
        val deny = Button(this).apply {
            text = "Deny"
            setOnClickListener { onDeny(pending.commandId) }
        }
        column.addView(titleView, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        column.addView(bodyView, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        column.addView(allow, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        column.addView(deny, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(column)
        setContentView(root)
    }

    private fun onAllow(mode: String, commandId: String) {
        acted = true
        when (mode) {
            CaptureCoordinator.MODE_PHOTO -> launchCamera(commandId)
            else -> {
                val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                @Suppress("DEPRECATION")
                startActivityForResult(mgr.createScreenCaptureIntent(), RC_PROJECTION)
            }
        }
    }

    private fun launchCamera(commandId: String) {
        try {
            val capturesDir = File(cacheDir, "captures").apply { mkdirs() }
            val file = File(capturesDir, "photo_${System.currentTimeMillis()}.jpg")
            photoFile = file
            val uri: Uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            @Suppress("DEPRECATION")
            startActivityForResult(intent, RC_CAMERA)
        } catch (e: Exception) {
            scope.launch {
                DeviceManagerApp.instance.repository.reportCommandFailure(
                    commandId, "Camera unavailable: ${e.message}"
                )
            }
            finish()
        }
    }

    private fun onDeny(commandId: String) {
        acted = true
        CaptureCoordinator.takePending(commandId)
        scope.launch {
            DeviceManagerApp.instance.repository.reportCommandRejected(
                commandId, "User declined the capture request on the device"
            )
        }
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val pending = CaptureCoordinator.pending
        if (pending == null) {
            finish()
            return
        }
        when (requestCode) {
            RC_PROJECTION -> {
                if (resultCode == Activity.RESULT_OK && data != null) {
                    CaptureCoordinator.takePending(pending.commandId)
                    val action = if (pending.mode == CaptureCoordinator.MODE_RECORD_START) {
                        CaptureCoordinator.ACTION_RECORD_START
                    } else {
                        CaptureCoordinator.ACTION_SCREENSHOT
                    }
                    val svc = CaptureCoordinator.buildServiceIntent(
                        this, action, pending.commandId, pending.mode, resultCode, data
                    )
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(svc)
                    } else {
                        startService(svc)
                    }
                } else {
                    CaptureCoordinator.takePending(pending.commandId)
                    scope.launch {
                        DeviceManagerApp.instance.repository.reportCommandRejected(
                            pending.commandId,
                            "User denied the Android screen-capture authorization"
                        )
                    }
                }
                finish()
            }
            RC_CAMERA -> {
                CaptureCoordinator.takePending(pending.commandId)
                val file = photoFile
                if (resultCode == Activity.RESULT_OK && file != null && file.exists() && file.length() > 0) {
                    scope.launch {
                        val repo = DeviceManagerApp.instance.repository
                        val ok = repo.uploadScreenshotFile(file, "camera", 0, 0)
                        if (ok) {
                            repo.reportCommandSuccess(
                                pending.commandId,
                                "{\"message\":\"Photo captured and uploaded\",\"file\":\"${file.name}\",\"bytes\":${file.length()}}"
                            )
                        } else {
                            repo.reportCommandFailure(pending.commandId, "Photo captured but upload failed")
                        }
                        file.delete()
                    }
                } else {
                    scope.launch {
                        DeviceManagerApp.instance.repository.reportCommandFailure(
                            pending.commandId, "Photo was not taken (camera cancelled or empty)"
                        )
                    }
                    file?.delete()
                }
                finish()
            }
            else -> finish()
        }
    }

    override fun onBackPressed() {
        // Back without choosing is an explicit decline (the request will not
        // silently execute later).
        val pending = CaptureCoordinator.pending
        if (pending != null && !acted) {
            onDeny(pending.commandId)
        } else {
            super.onBackPressed()
        }
    }

    companion object {
        private const val RC_PROJECTION = 4201
        private const val RC_CAMERA = 4202
    }
}
