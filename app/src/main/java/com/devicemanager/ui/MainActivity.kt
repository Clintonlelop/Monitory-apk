package com.devicemanager.ui

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.devicemanager.DeviceManagerApp
import com.devicemanager.R
import com.devicemanager.databinding.ActivityMainBinding
import com.devicemanager.ui.adapter.PermissionAdapter
import com.devicemanager.ui.viewmodel.MainViewModel
import com.devicemanager.util.Extensions
import kotlinx.coroutines.launch

/**
 * Main activity showing device status, telemetry, and quick actions.
 *
 * - Device name, model, Android version
 * - Connection status (online/offline, last sync time)
 * - Battery level, charging state
 * - Current network type
 * - Quick actions: Sync Now, Check Permissions
 * - Recent commands list
 * - Navigation to PermissionsActivity
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var viewModel: MainViewModel
    private lateinit var app: DeviceManagerApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        app = application as DeviceManagerApp
        viewModel = ViewModelProvider(this)[MainViewModel::class.java]

        setupViews()
        observeViewModel()
        viewModel.refreshTelemetry()
    }

    private fun setupViews() {
        // Sync Now button
        binding.syncNowButton.setOnClickListener {
            viewModel.syncNow()
        }

        // Check Permissions button
        binding.checkPermissionsButton.setOnClickListener {
            startActivity(Intent(this, PermissionsActivity::class.java))
        }

        // Recent commands recycler view
        binding.recentCommandsRecycler.layoutManager = LinearLayoutManager(this)
    }

    private fun observeViewModel() {
        viewModel.deviceName.observe(this) { name ->
            binding.deviceNameText.text = name
        }

        viewModel.deviceModel.observe(this) { model ->
            binding.deviceModelText.text = model
        }

        viewModel.androidVersion.observe(this) { version ->
            binding.androidVersionText.text = version
        }

        viewModel.isOnline.observe(this) { online ->
            binding.connectionStatusText.text = if (online) "Online" else "Offline"
            binding.connectionStatusText.setTextColor(
                getColor(if (online) R.color.status_granted else R.color.status_denied)
            )
        }

        viewModel.lastSyncTime.observe(this) { time ->
            binding.lastSyncText.text = "Last sync: ${Extensions.formatTimestamp(time)}"
        }

        viewModel.batteryLevel.observe(this) { level ->
            binding.batteryLevelText.text = "$level%"
        }

        viewModel.isCharging.observe(this) { charging ->
            binding.chargingStatusText.text = if (charging) "Charging" else "Not charging"
        }

        viewModel.networkType.observe(this) { type ->
            binding.networkTypeText.text = type
        }

        viewModel.isLoading.observe(this) { loading ->
            binding.syncNowButton.isEnabled = !loading
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.refreshTelemetry()
    }
}
