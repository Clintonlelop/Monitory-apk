package com.example

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.example.data.local.AppDatabase
import com.example.data.prefs.PreferenceManager
import com.example.data.remote.ApiClient
import com.example.data.remote.DeviceWebSocketManager
import com.example.data.repository.DeviceRepository

class DeviceManagerApp : Application() {

    lateinit var database: AppDatabase
        private set
    lateinit var preferenceManager: PreferenceManager
        private set
    lateinit var apiClient: ApiClient
        private set
    lateinit var webSocketManager: DeviceWebSocketManager
        private set
    lateinit var repository: DeviceRepository
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        createNotificationChannels()

        database = AppDatabase.getInstance(this)
        preferenceManager = PreferenceManager(this)
        apiClient = ApiClient(preferenceManager)
        webSocketManager = DeviceWebSocketManager(preferenceManager)
        repository = DeviceRepository(this, database, preferenceManager, apiClient, webSocketManager)
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val serviceChannel = NotificationChannel(
                CHANNEL_SERVICE,
                getString(R.string.service_notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.service_notification_channel_desc)
                setShowBadge(false)
            }

            val recordingChannel = NotificationChannel(
                CHANNEL_RECORDING,
                getString(R.string.recording_notification_title),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = getString(R.string.recording_notification_text)
            }

            val alertsChannel = NotificationChannel(
                CHANNEL_ALERTS,
                "Device Management Alerts",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "System command notifications and administrative alerts"
            }

            notificationManager.createNotificationChannel(serviceChannel)
            notificationManager.createNotificationChannel(recordingChannel)
            notificationManager.createNotificationChannel(alertsChannel)
        }
    }

    companion object {
        const val CHANNEL_SERVICE = "channel_device_management_service"
        const val CHANNEL_RECORDING = "channel_device_recording"
        const val CHANNEL_ALERTS = "channel_device_alerts"

        lateinit var instance: DeviceManagerApp
            private set
    }
}
