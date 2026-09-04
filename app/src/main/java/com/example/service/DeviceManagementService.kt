package com.example.service

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.example.DeviceManagerApp
import com.example.MainActivity
import com.example.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class DeviceManagementService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private var syncJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        startPeriodicSync()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundNotification()
        val app = application as DeviceManagerApp
        if (app.preferenceManager.isPaired()) {
            app.webSocketManager.connect()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        syncJob?.cancel()
        val app = application as DeviceManagerApp
        app.webSocketManager.disconnect()
        super.onDestroy()
    }

    private fun startForegroundNotification() {
        val app = application as DeviceManagerApp
        val serverUrl = app.preferenceManager.getServerUrl()

        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("navigate_to", "permissions")
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, DeviceManagerApp.CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.service_notification_title))
            .setContentText("Connected to $serverUrl • Tap to view status")
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                startForeground(SERVICE_NOTIFICATION_ID, notification, type)
            } else {
                startForeground(SERVICE_NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e("DeviceManagementService", "Failed to start foreground service gracefully: ${e.message}", e)
        }
    }

    private fun startPeriodicSync() {
        syncJob?.cancel()
        syncJob = scope.launch {
            val app = application as DeviceManagerApp
            while (isActive) {
                try {
                    if (app.preferenceManager.isPaired()) {
                        app.repository.syncTelemetry()
                        app.repository.syncPermissions()
                    }
                } catch (e: Exception) {
                    Log.w("DeviceManagementService", "Periodic sync error: ${e.message}")
                }
                delay(60_000) // Sync every 60 seconds
            }
        }
    }

    companion object {
        const val SERVICE_NOTIFICATION_ID = 1001
    }
}
