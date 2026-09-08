package com.devicemanager.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.devicemanager.DeviceManagerApp
import com.devicemanager.R
import com.devicemanager.data.remote.model.Command
import com.devicemanager.data.remote.WebSocketClient
import com.devicemanager.manager.CommandExecutor
import com.devicemanager.ui.MainActivity
import com.devicemanager.util.Constants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Main foreground service that keeps the app alive and manages the WebSocket connection.
 *
 * - Maintains a persistent WebSocket connection for real-time command reception
 * - Falls back to polling for pending commands when WebSocket is disconnected
 * - Shows a persistent notification indicating the app is running
 * - Handles command execution via CommandExecutor
 */
class MainForegroundService : Service() {
    companion object {
        private const val TAG = "MainForegroundService"
        private const val POLL_INTERVAL_MS = 30000L

        fun start(context: Context) {
            val intent = Intent(context, MainForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MainForegroundService::class.java))
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null
    private var commandExecutor: CommandExecutor? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var isNetworkAvailable = true

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        createNotificationChannel()
        startForeground(Constants.NOTIF_ID_MAIN, buildNotification("Device Manager running"))

        val app = application as DeviceManagerApp
        commandExecutor = app.commandExecutor

        // Connect WebSocket
        connectWebSocket()

        // Register network callback for polling mode on network loss
        registerNetworkCallback()

        // Start command polling as fallback
        startCommandPolling()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.d(TAG, "Service destroyed")
        pollJob?.cancel()
        serviceScope.cancel()
        unregisterNetworkCallback()
        val app = application as DeviceManagerApp
        app.webSocketClient.disconnect()
        super.onDestroy()
    }

    /**
     * Connect to WebSocket and set up command listener.
     */
    private fun connectWebSocket() {
        val app = application as DeviceManagerApp
        val serverUrl = app.preferences.serverUrl
        val deviceToken = app.preferences.deviceToken

        if (serverUrl.isNotBlank() && deviceToken.isNotBlank()) {
            app.webSocketClient.setCommandListener { command ->
                handleIncomingCommand(command)
            }
            app.webSocketClient.connect(serverUrl, deviceToken)
        } else {
            Log.w(TAG, "Server URL or device token not set")
        }
    }

    /**
     * Handle an incoming command from WebSocket.
     */
    private fun handleIncomingCommand(command: Command) {
        serviceScope.launch {
            commandExecutor?.executeSuspend(command)
        }
    }

    /**
     * Start periodic polling for pending commands as a fallback.
     */
    private fun startCommandPolling() {
        pollJob?.cancel()
        pollJob = serviceScope.launch {
            while (true) {
                delay(POLL_INTERVAL_MS)
                pollPendingCommands()
            }
        }
    }

    /**
     * Poll the server for pending commands.
     * When network is lost, switches to polling mode every 30s.
     * When network restores, reconnects WS and flushes queue.
     */
    private suspend fun pollPendingCommands() {
        val app = application as DeviceManagerApp
        val deviceId = app.preferences.deviceId
        if (deviceId.isBlank()) return

        // Only poll if WebSocket is not connected
        if (app.webSocketClient.connectionState.value ==
            WebSocketClient.ConnectionState.CONNECTED
        ) {
            return
        }

        // Don't poll if no network available
        if (!isNetworkAvailable) {
            Log.d(TAG, "No network — skipping poll, queued commands will flush on restore")
            return
        }

        try {
            val result = app.deviceRepository.getPendingCommands(deviceId)
            result.onSuccess { commands ->
                for (command in commands) {
                    handleIncomingCommand(command)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Poll pending commands error: ${e.message}", e)
        }
    }

    /**
     * Register network callback to detect network loss/restore.
     * On loss: switch to polling mode.
     * On restore: reconnect WS, flush queue, stop polling.
     */
    private fun registerNetworkCallback() {
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()

            networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.d(TAG, "Network available — reconnecting WS, flushing queue")
                    isNetworkAvailable = true
                    val app = application as DeviceManagerApp
                    // Trigger immediate WS reconnect
                    app.webSocketClient.triggerImmediateReconnect()
                    // Flush any pending sync tasks
                    serviceScope.launch {
                        try {
                            app.syncRepository.syncQueuedEvents()
                        } catch (e: Exception) {
                            Log.e(TAG, "Queue flush error: ${e.message}", e)
                        }
                    }
                }

                override fun onLost(network: Network) {
                    Log.d(TAG, "Network lost — switching to polling mode")
                    isNetworkAvailable = false
                }

                override fun onUnavailable() {
                    isNetworkAvailable = false
                }
            }

            cm.registerNetworkCallback(request, networkCallback!!)
            Log.d(TAG, "Network callback registered")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register network callback: ${e.message}", e)
        }
    }

    private fun unregisterNetworkCallback() {
        try {
            networkCallback?.let {
                val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                cm.unregisterNetworkCallback(it)
            }
            networkCallback = null
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unregister network callback: ${e.message}", e)
        }
    }

    // ── Notification helpers ─────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                Constants.CHANNEL_MAIN,
                "Device Manager Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Persistent notification for device management service"
                setShowBadge(false)
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(contentText: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, Constants.CHANNEL_MAIN)
            .setContentTitle("Device Manager")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
