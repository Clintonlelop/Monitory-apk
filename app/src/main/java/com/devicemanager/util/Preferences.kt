package com.devicemanager.util

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences wrapper for persistent app state.
 */
class Preferences(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

    var deviceToken: String
        get() = prefs.getString(Constants.KEY_DEVICE_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(Constants.KEY_DEVICE_TOKEN, value).apply()

    var deviceId: String
        get() = prefs.getString(Constants.KEY_DEVICE_ID, "") ?: ""
        set(value) = prefs.edit().putString(Constants.KEY_DEVICE_ID, value).apply()

    var serverUrl: String
        get() = prefs.getString(Constants.KEY_SERVER_URL, "") ?: ""
        set(value) = prefs.edit().putString(Constants.KEY_SERVER_URL, value).apply()

    var deviceName: String
        get() = prefs.getString(Constants.KEY_DEVICE_NAME, "") ?: ""
        set(value) = prefs.edit().putString(Constants.KEY_DEVICE_NAME, value).apply()

    var isPaired: Boolean
        get() = prefs.getBoolean(Constants.KEY_IS_PAIRED, false)
        set(value) = prefs.edit().putBoolean(Constants.KEY_IS_PAIRED, value).apply()

    var isSetupComplete: Boolean
        get() = prefs.getBoolean(Constants.KEY_IS_SETUP_COMPLETE, false)
        set(value) = prefs.edit().putBoolean(Constants.KEY_IS_SETUP_COMPLETE, value).apply()

    var lastSyncTime: Long
        get() = prefs.getLong(Constants.KEY_LAST_SYNC_TIME, 0L)
        set(value) = prefs.edit().putLong(Constants.KEY_LAST_SYNC_TIME, value).apply()

    var lastTelemetryTime: Long
        get() = prefs.getLong(Constants.KEY_LAST_TELEMETRY_TIME, 0L)
        set(value) = prefs.edit().putLong(Constants.KEY_LAST_TELEMETRY_TIME, value).apply()

    var lastLocationTime: Long
        get() = prefs.getLong(Constants.KEY_LAST_LOCATION_TIME, 0L)
        set(value) = prefs.edit().putLong(Constants.KEY_LAST_LOCATION_TIME, value).apply()

    fun clearAll() {
        prefs.edit().clear().apply()
    }
}
