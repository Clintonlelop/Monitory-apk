package com.devicemanager.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.devicemanager.DeviceManagerApp
import com.devicemanager.data.local.entity.PendingCommand
import com.devicemanager.data.remote.model.TelemetryRequest
import com.devicemanager.manager.PermissionManager
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * ViewModel for MainActivity.
 *
 * Holds device info, connection status, telemetry data, and recent commands.
 */
class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as DeviceManagerApp

    // Device info
    private val _deviceName = MutableLiveData<String>()
    val deviceName: LiveData<String> = _deviceName

    private val _deviceModel = MutableLiveData<String>()
    val deviceModel: LiveData<String> = _deviceModel

    private val _androidVersion = MutableLiveData<String>()
    val androidVersion: LiveData<String> = _androidVersion

    // Connection status
    private val _isOnline = MutableLiveData<Boolean>()
    val isOnline: LiveData<Boolean> = _isOnline

    private val _lastSyncTime = MutableLiveData<Long>()
    val lastSyncTime: LiveData<Long> = _lastSyncTime

    // Telemetry
    private val _batteryLevel = MutableLiveData<Int>()
    val batteryLevel: LiveData<Int> = _batteryLevel

    private val _isCharging = MutableLiveData<Boolean>()
    val isCharging: LiveData<Boolean> = _isCharging

    private val _networkType = MutableLiveData<String>()
    val networkType: LiveData<String> = _networkType

    // Recent commands
    private val _recentCommands = MutableLiveData<List<PendingCommand>>()
    val recentCommands: LiveData<List<PendingCommand>> = _recentCommands

    // Loading state
    private val _isLoading = MutableLiveData<Boolean>()
    val isLoading: LiveData<Boolean> = _isLoading

    init {
        loadDeviceInfo()
        observeConnectionState()
        observeRecentCommands()
    }

    private fun loadDeviceInfo() {
        _deviceName.value = app.preferences.deviceName.ifBlank { "My Device" }
        _deviceModel.value = android.os.Build.MODEL
        _androidVersion.value = "Android ${android.os.Build.VERSION.RELEASE}"
        _lastSyncTime.value = app.preferences.lastSyncTime
    }

    private fun observeConnectionState() {
        viewModelScope.launch {
            app.webSocketClient.connectionState.collectLatest { state ->
                _isOnline.value = state == com.devicemanager.data.remote.WebSocketClient.ConnectionState.CONNECTED
            }
        }
    }

    private fun observeRecentCommands() {
        viewModelScope.launch {
            app.database.pendingCommandDao()
                .observeRecentCommands(20)
                .collectLatest { commands ->
                    _recentCommands.value = commands
                }
        }
    }

    /**
     * Refresh telemetry data.
     */
    fun refreshTelemetry() {
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val telemetry = app.telemetryCollector.collect()
                _batteryLevel.value = telemetry.battery
                _isCharging.value = telemetry.charging
                _networkType.value = telemetry.networkType
            } catch (e: Exception) {
                // Handle error
            } finally {
                _isLoading.value = false
            }
        }
    }

    /**
     * Sync now — upload telemetry and sync queue.
     */
    fun syncNow() {
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val telemetry = app.telemetryCollector.collect()
                app.telemetryRepository.sendTelemetry(telemetry)
                app.syncRepository.syncQueuedEvents()
                app.preferences.lastSyncTime = System.currentTimeMillis()
                _lastSyncTime.value = app.preferences.lastSyncTime
                _batteryLevel.value = telemetry.battery
                _isCharging.value = telemetry.charging
                _networkType.value = telemetry.networkType
            } catch (e: Exception) {
                // Handle error
            } finally {
                _isLoading.value = false
            }
        }
    }

    /**
     * Get permission status summary.
     */
    fun getPermissionStatus(): List<PermissionManager.PermissionInfo> {
        return app.permissionManager.getAllPermissions()
    }
}
