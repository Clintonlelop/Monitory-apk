package com.example.service

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import com.example.DeviceManagerApp
import kotlinx.coroutines.launch

class ScreenRecordHelperActivity : ComponentActivity() {
    companion object {
        private const val REQUEST_CODE = 455
    }

    private var commandId: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        commandId = intent.getStringExtra("command_id") ?: ""

        val mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(mediaProjectionManager.createScreenCaptureIntent(), REQUEST_CODE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE) {
            if (resultCode == RESULT_OK && data != null) {
                // User authorized recording!
                val serviceIntent = Intent(this, ScreenRecordService::class.java).apply {
                    action = "START"
                    putExtra("result_code", resultCode)
                    putExtra("result_data", data)
                    putExtra("command_id", commandId)
                }
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent)
                } else {
                    startService(serviceIntent)
                }
            } else {
                // User declined/canceled projection request!
                val app = application as DeviceManagerApp
                app.repository.scope.launch {
                    app.repository.reportCommandFailure(commandId, "Screen recording authorization declined by user.")
                }
            }
        }
        finish()
    }
}
