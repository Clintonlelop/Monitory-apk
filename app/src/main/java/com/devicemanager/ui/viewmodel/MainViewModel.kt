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

    private val _batteryTemp = MutableLiveData<Float>()
    val batteryTemp: LiveData<Float> = _batteryTemp

    private val _wifiSsid = MutableLiveData<String?>()
    val wifiSsid: LiveData<String?> = _wifiSsid

    private val _storageTotal = MutableLiveData<Long>()
    val storageTotal: LiveData<Long> = _storageTotal

    private val _storageUsed = MutableLiveData<Long>()
    val storageUsed: LiveData<Long> = _storageUsed

    private val _ramTotal = MutableLiveData<Long>()
    val ramTotal: LiveData<Long> = _ramTotal

    private val _ramUsed = MutableLiveData<Long>()
    val ramUsed: LiveData<Long> = _ramUsed

    private val _hardwareCpu = MutableLiveData<String>()
    val hardwareCpu: LiveData<String> = _hardwareCpu

    private val _cpuAbis = MutableLiveData<String>()
    val cpuAbis: LiveData<String> = _cpuAbis

    private val _manufacturer = MutableLiveData<String>()
    val manufacturer: LiveData<String> = _manufacturer

    private val _brand = MutableLiveData<String>()
    val brand: LiveData<String> = _brand

    private val _displayResolution = MutableLiveData<String>()
    val displayResolution: LiveData<String> = _displayResolution

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
        refreshTelemetry()
    }

    private fun loadDeviceInfo() {
        _deviceName.value = app.preferences.deviceName.ifBlank { "My Device" }
        _deviceModel.value = android.os.Build.MODEL
        _androidVersion.value = "Android ${android.os.Build.VERSION.RELEASE}"
        _lastSyncTime.value = app.preferences.lastSyncTime
        _hardwareCpu.value = android.os.Build.HARDWARE
        _cpuAbis.value = android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"
        _manufacturer.value = android.os.Build.MANUFACTURER
        _brand.value = android.os.Build.BRAND
        _displayResolution.value = "1080x2400" // default, updated in telemetry
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
                _batteryTemp.value = telemetry.batteryTemp
                _wifiSsid.value = telemetry.wifiSsid
                _storageTotal.value = telemetry.storageTotal
                _storageUsed.value = telemetry.storageUsed
                _ramTotal.value = telemetry.ramTotal
                _ramUsed.value = telemetry.ramUsed
                val width = telemetry.display?.resolutionWidth ?: 1080
                val height = telemetry.display?.resolutionHeight ?: 2400
                _displayResolution.value = "${width}x${height}"
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
                _batteryTemp.value = telemetry.batteryTemp
                _wifiSsid.value = telemetry.wifiSsid
                _storageTotal.value = telemetry.storageTotal
                _storageUsed.value = telemetry.storageUsed
                _ramTotal.value = telemetry.ramTotal
                _ramUsed.value = telemetry.ramUsed
                val width = telemetry.display?.resolutionWidth ?: 1080
                val height = telemetry.display?.resolutionHeight ?: 2400
                _displayResolution.value = "${width}x${height}"
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
