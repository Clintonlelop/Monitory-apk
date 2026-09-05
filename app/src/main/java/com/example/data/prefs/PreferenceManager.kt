package com.example.data.prefs

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

class PreferenceManager(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("device_manager_prefs", Context.MODE_PRIVATE)

    private val _isPairedFlow = MutableStateFlow(isPaired())
    val isPairedFlow: StateFlow<Boolean> = _isPairedFlow.asStateFlow()

    private val _lastSyncFlow = MutableStateFlow(getLastSyncTime())
    val lastSyncFlow: StateFlow<Long> = _lastSyncFlow.asStateFlow()

    fun getServerUrl(): String {
        val saved = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        if (saved.contains("10.0.2.2") || saved.contains("localhost")) {
            return DEFAULT_SERVER_URL
        }
        return saved
    }

    fun getPublicWebUrl(): String {
        return DEFAULT_SERVER_URL
    }

    fun setServerUrl(url: String) {
        val trimmed = url.trim().removeSuffix("/")
        prefs.edit().putString(KEY_SERVER_URL, trimmed).apply()
    }

    fun getUserEmail(): String? {
        return prefs.getString(KEY_USER_EMAIL, "clintonumelo15@gmail.com")
    }

    fun setUserEmail(email: String?) {
        prefs.edit().putString(KEY_USER_EMAIL, email).apply()
    }

    fun getUserToken(): String? {
        return prefs.getString(KEY_USER_TOKEN, null)
    }

    fun setUserToken(token: String?) {
        prefs.edit().putString(KEY_USER_TOKEN, token).apply()
    }

    fun getDeviceId(): String {
        var id = prefs.getString(KEY_DEVICE_ID, null)
        if (id.isNullOrEmpty()) {
            id = "dev_" + UUID.randomUUID().toString().replace("-", "").take(12)
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
        }
        return id
    }

    fun setDeviceId(id: String) {
        prefs.edit().putString(KEY_DEVICE_ID, id).apply()
    }

    fun getDeviceName(): String {
        return prefs.getString(KEY_DEVICE_NAME, "${Build.MANUFACTURER} ${Build.MODEL}") ?: "Android Device"
    }

    fun setDeviceName(name: String) {
        prefs.edit().putString(KEY_DEVICE_NAME, name).apply()
    }

    fun getAuthToken(): String? {
        return prefs.getString(KEY_AUTH_TOKEN, null)
    }

    fun setAuthToken(token: String?) {
        prefs.edit().putString(KEY_AUTH_TOKEN, token).apply()
    }

    fun isPaired(): Boolean {
        return prefs.getBoolean(KEY_IS_PAIRED, false) && !getAuthToken().isNullOrEmpty()
    }

    fun setPaired(paired: Boolean) {
        prefs.edit().putBoolean(KEY_IS_PAIRED, paired).apply()
        _isPairedFlow.value = paired
    }

    fun isOnboardingCompleted(): Boolean {
        return prefs.getBoolean(KEY_ONBOARDING_COMPLETED, false)
    }

    fun setOnboardingCompleted(completed: Boolean) {
        prefs.edit().putBoolean(KEY_ONBOARDING_COMPLETED, completed).apply()
    }

    fun isSetupCompleted(): Boolean {
        return prefs.getBoolean(KEY_SETUP_COMPLETED, false)
    }

    fun setSetupCompleted(completed: Boolean) {
        prefs.edit().putBoolean(KEY_SETUP_COMPLETED, completed).apply()
    }

    fun getLastSyncTime(): Long {
        return prefs.getLong(KEY_LAST_SYNC_TIME, 0L)
    }

    fun updateLastSyncTime(timestamp: Long = System.currentTimeMillis()) {
        prefs.edit().putLong(KEY_LAST_SYNC_TIME, timestamp).apply()
        _lastSyncFlow.value = timestamp
    }

    fun clearPairing() {
        prefs.edit()
            .remove(KEY_AUTH_TOKEN)
            .remove(KEY_USER_TOKEN)
            .putBoolean(KEY_IS_PAIRED, false)
            .putBoolean(KEY_ONBOARDING_COMPLETED, false)
            .putBoolean(KEY_SETUP_COMPLETED, false)
            .remove(KEY_LAST_SYNC_TIME)
            .apply()
        _isPairedFlow.value = false
        _lastSyncFlow.value = 0L
    }

    companion object {
        const val DEFAULT_SERVER_URL = "https://ais-dev-etjoqfdf2ox4fsj5y37jnh-77493896896.europe-west3.run.app"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_USER_EMAIL = "user_email"
        private const val KEY_USER_TOKEN = "user_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_NAME = "device_name"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_IS_PAIRED = "is_paired"
        private const val KEY_LAST_SYNC_TIME = "last_sync_time"
        private const val KEY_ONBOARDING_COMPLETED = "onboarding_completed"
        private const val KEY_SETUP_COMPLETED = "setup_completed"
    }
}
