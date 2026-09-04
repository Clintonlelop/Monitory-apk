package com.example.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.DeviceManagerApp
import com.example.data.local.entity.CommandEntity
import com.example.data.model.DevicePermissionsStatus
import com.example.data.model.DeviceTelemetry
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

sealed class Screen {
    data object Auth : Screen()
    data object Activation : Screen()
    data object Dashboard : Screen()
    data object Privacy : Screen()
}

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as DeviceManagerApp
    private val repo = app.repository
    private val prefs = app.preferenceManager

    val isPaired: StateFlow<Boolean> = prefs.isPairedFlow
    val isOnline: StateFlow<Boolean> = app.webSocketManager.isConnected
    val isSyncing: StateFlow<Boolean> = repo.isSyncing
    val lastSyncTime: StateFlow<Long> = prefs.lastSyncFlow

    val telemetry: StateFlow<DeviceTelemetry?> = repo.telemetryFlow
    val permissions: StateFlow<DevicePermissionsStatus> = repo.permissionsFlow

    val pendingOfflineCount: StateFlow<Int> = app.database.eventDao()
        .getPendingEventsCountFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)

    val commandHistory: StateFlow<List<CommandEntity>> = app.database.commandDao()
        .getAllCommandsFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _currentScreen = MutableStateFlow<Screen>(
        if (prefs.isPaired()) Screen.Dashboard else Screen.Auth
    )
    val currentScreen: StateFlow<Screen> = _currentScreen.asStateFlow()

    val serverUrl = MutableStateFlow(prefs.getServerUrl())
    val userEmail = MutableStateFlow(prefs.getUserEmail() ?: "clintonumelo15@gmail.com")
    val userPassword = MutableStateFlow("admin123")
    val username = MutableStateFlow("Clinton")
    val isRegisterMode = MutableStateFlow(false)
    val pairingCode = MutableStateFlow("")
    val deviceName = MutableStateFlow(prefs.getDeviceName())

    val webDashboardUrl: String
        get() = prefs.getPublicWebUrl()

    private val _uiState = MutableStateFlow<UiState>(UiState.Idle)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init {
        // Automatically start service if already paired
        if (prefs.isPaired()) {
            repo.startManagementService()
            app.webSocketManager.connect()
        }
    }

    fun navigateTo(screen: Screen) {
        _currentScreen.value = screen
    }

    fun setServerUrl(url: String) {
        serverUrl.value = url
        prefs.setServerUrl(url)
    }

    fun setUserEmail(email: String) {
        userEmail.value = email
        prefs.setUserEmail(email)
    }

    fun setUserPassword(password: String) {
        userPassword.value = password
    }

    fun setUsername(name: String) {
        username.value = name
    }

    fun setRegisterMode(register: Boolean) {
        isRegisterMode.value = register
    }

    fun setPairingCode(code: String) {
        pairingCode.value = code
    }

    fun setDeviceName(name: String) {
        deviceName.value = name
        prefs.setDeviceName(name)
    }

    fun signIn() {
        val email = userEmail.value.trim()
        val pass = userPassword.value
        if (email.isBlank() || pass.isBlank()) {
            _uiState.value = UiState.Error("Please enter email and password")
            return
        }

        val targetUrl = if (serverUrl.value.contains("10.0.2.2")) prefs.getServerUrl() else serverUrl.value
        serverUrl.value = targetUrl

        viewModelScope.launch {
            _uiState.value = UiState.Loading("Signing in to account...")
            val result = repo.signInAndConnect(targetUrl, email, pass)
            result.onSuccess { msg ->
                _uiState.value = UiState.Success(msg)
                _currentScreen.value = Screen.Activation
            }.onFailure { err ->
                // If login failed because user not registered yet, give helpful message
                _uiState.value = UiState.Error(err.message ?: "Login failed. Click 'Create Account' if this is your first time.")
            }
        }
    }

    fun registerAccount() {
        val email = userEmail.value.trim()
        val pass = userPassword.value
        if (email.isBlank() || pass.isBlank()) {
            _uiState.value = UiState.Error("Please enter email and password")
            return
        }

        val targetUrl = if (serverUrl.value.contains("10.0.2.2")) prefs.getServerUrl() else serverUrl.value
        serverUrl.value = targetUrl

        viewModelScope.launch {
            _uiState.value = UiState.Loading("Creating your account & linking device...")
            val result = repo.registerAndConnect(targetUrl, email, pass, username.value)
            result.onSuccess { msg ->
                _uiState.value = UiState.Success(msg)
                _currentScreen.value = Screen.Activation
            }.onFailure { err ->
                _uiState.value = UiState.Error(err.message ?: "Registration failed")
            }
        }
    }

    fun activateDevice() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading("Activating device management...")
            repo.startManagementService()
            app.webSocketManager.connect()
            repo.syncTelemetry()
            repo.syncPermissions()
            repo.syncLocation()
            _uiState.value = UiState.Success("Device Activated & Synced Successfully!")
            _currentScreen.value = Screen.Dashboard
        }
    }

    fun pairDevice() {
        val code = pairingCode.value.trim()
        if (code.isBlank()) {
            _uiState.value = UiState.Error("Please enter a 6-digit pairing code from the dashboard")
            return
        }

        viewModelScope.launch {
            _uiState.value = UiState.Loading("Pairing device with server...")
            val result = repo.pairDevice(serverUrl.value, code)
            result.onSuccess { msg ->
                _uiState.value = UiState.Success(msg)
                _currentScreen.value = Screen.Dashboard
            }.onFailure { err ->
                _uiState.value = UiState.Error(err.message ?: "Failed to pair device")
            }
        }
    }

    fun syncNow() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading("Synchronizing with management server...")
            val success = repo.syncTelemetry()
            repo.syncPermissions()
            repo.syncLocation()
            if (success) {
                _uiState.value = UiState.Success("Synchronization complete")
            } else {
                _uiState.value = UiState.Error("Server unreachable. Data queued for offline sync.")
            }
        }
    }

    fun refreshPermissions() {
        viewModelScope.launch {
            repo.syncPermissions()
        }
    }

    fun disconnect() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading("Disconnecting device...")
            repo.disconnectDevice()
            _uiState.value = UiState.Success("Device disconnected from management server")
            _currentScreen.value = Screen.Auth
        }
    }

    fun clearUiState() {
        _uiState.value = UiState.Idle
    }

    sealed class UiState {
        data object Idle : UiState()
        data class Loading(val message: String) : UiState()
        data class Success(val message: String) : UiState()
        data class Error(val message: String) : UiState()
    }
}
