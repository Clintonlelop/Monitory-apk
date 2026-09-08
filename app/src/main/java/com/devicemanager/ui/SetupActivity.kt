package com.devicemanager.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.devicemanager.DeviceManagerApp
import com.devicemanager.R
import com.devicemanager.databinding.ActivitySetupBinding
import com.devicemanager.services.MainForegroundService
import com.devicemanager.util.Extensions
import kotlinx.coroutines.launch

/**
 * First-launch setup activity.
 *
 * - Server URL input field (default http://10.0.2.2:3000 for emulator)
 * - Device token display (generated, with copy button)
 * - "Pair Device" button → calls /api/devices/register
 * - Connection status indicator
 * - Explanation of required permissions
 * - "Continue" button after pairing
 */
class SetupActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySetupBinding
    private lateinit var app: DeviceManagerApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySetupBinding.inflate(layoutInflater)
        setContentView(binding.root)

        app = application as DeviceManagerApp

        // If already set up, go to MainActivity
        if (app.preferences.isSetupComplete) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }

        setupViews()
    }

    private fun setupViews() {
        // Set default server URL
        val defaultUrl = com.devicemanager.BuildConfig.DEFAULT_SERVER_URL
        binding.serverUrlInput.setText(app.preferences.serverUrl.ifBlank { defaultUrl })

        // Display device token
        binding.deviceTokenText.text = app.preferences.deviceToken

        // Copy token button
        binding.copyTokenButton.setOnClickListener {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("Device Token", app.preferences.deviceToken)
            clipboard.setPrimaryClip(clip)
            Toast.makeText(this, "Token copied to clipboard", Toast.LENGTH_SHORT).show()
        }

        // Pair device button
        binding.pairButton.setOnClickListener {
            pairDevice()
        }

        // Continue button (initially disabled)
        binding.continueButton.isEnabled = false
        binding.continueButton.setOnClickListener {
            completeSetup()
        }
    }

    /**
     * Pair the device with the backend.
     */
    private fun pairDevice() {
        val serverUrl = binding.serverUrlInput.text.toString().trim()
        if (serverUrl.isBlank()) {
            binding.statusText.text = "Please enter a server URL"
            return
        }

        binding.pairButton.isEnabled = false
        binding.statusText.text = "Pairing with server..."

        // Save server URL and reinitialize API service
        app.preferences.serverUrl = Extensions.normalizeServerUrl(serverUrl)
        app.reinitializeApiService()

        lifecycleScope.launch {
            val result = app.deviceRepository.registerDevice(
                deviceToken = app.preferences.deviceToken,
                name = android.os.Build.MODEL,
                model = android.os.Build.MODEL,
                manufacturer = android.os.Build.MANUFACTURER,
                androidVersion = android.os.Build.VERSION.RELEASE,
                appVersion = Extensions.getAppVersion(this@SetupActivity)
            )

            result.onSuccess { response ->
                binding.statusText.text = "Device paired successfully! Device ID: ${response.id}"
                app.preferences.deviceName = android.os.Build.MODEL
                binding.continueButton.isEnabled = true
                binding.pairButton.isEnabled = true
            }

            result.onFailure { error ->
                binding.statusText.text = "Pairing failed: ${error.message}"
                binding.pairButton.isEnabled = true
            }
        }
    }

    /**
     * Complete setup and proceed to MainActivity.
     */
    private fun completeSetup() {
        app.preferences.isSetupComplete = true
        app.preferences.isPaired = true

        // Start foreground service
        MainForegroundService.start(this)

        // Initialize WorkManager tasks
        app.initializeWorkManagerPublic()

        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
