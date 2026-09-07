package com.devicemanager.services

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.devicemanager.DeviceManagerApp
import com.devicemanager.data.remote.model.NotificationRequest
import com.devicemanager.data.repository.SyncRepository
import com.devicemanager.util.Constants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * NotificationListenerService for monitoring notifications.
 *
 * The user must manually grant notification access in Settings.
 * Overrides onNotificationPosted to extract package, title, text, category,
 * and postTime, then POSTs to /api/notifications.
 *
 * Sends permission status update when service connects/disconnects.
 */
class NotificationListener : NotificationListenerService() {
    companion object {
        private const val TAG = "NotificationListener"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.d(TAG, "Notification listener connected")
        // Permission is now granted — sync status to server
        syncPermissionStatus(true)
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.d(TAG, "Notification listener disconnected")
        syncPermissionStatus(false)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        super.onNotificationPosted(sbn)
        Log.d(TAG, "Notification posted: ${sbn.packageName}")

        val notification = sbn.notification ?: return
        val extras = notification.extras

        val title = extras?.getCharSequence("android.title")?.toString()
        val text = extras?.getCharSequence("android.text")?.toString()
        val category = notification.category

        val request = NotificationRequest(
            packageName = sbn.packageName,
            title = title,
            text = text,
            category = category,
            postedTime = sbn.postTime
        )

        scope.launch {
            sendNotification(request)
        }
    }

    /**
     * Send notification to server, queue for retry on failure.
     */
    private suspend fun sendNotification(request: NotificationRequest) {
        try {
            val app = application as DeviceManagerApp
            val response = app.apiService.sendNotification(request)
            if (!response.isSuccessful) {
                queueForRetry(request)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Send notification error: ${e.message}", e)
            queueForRetry(request)
        }
    }

    /**
     * Queue notification for retry when network is unavailable.
     */
    private suspend fun queueForRetry(request: NotificationRequest) {
        try {
            val app = application as DeviceManagerApp
            app.syncRepository.queueEvent(
                "NOTIFICATION",
                Constants.API_NOTIFICATIONS,
                request,
                "notif_${request.postedTime}_${request.packageName}"
            )
        } catch (e: Exception) {
            Log.e(TAG, "Queue notification error: ${e.message}", e)
        }
    }

    /**
     * Sync notification access permission status to server.
     */
    private fun syncPermissionStatus(granted: Boolean) {
        scope.launch {
            try {
                val app = application as DeviceManagerApp
                val deviceId = app.preferences.deviceId
                if (deviceId.isNotBlank()) {
                    val status = if (granted) "GRANTED" else "REQUIRES_USER_ACTION"
                    val permissions = listOf(
                        com.devicemanager.data.remote.model.PermissionEntry(
                            permissionName = Constants.PERM_NOTIFICATION_ACCESS,
                            status = status
                        )
                    )
                    app.deviceRepository.updatePermissions(deviceId, permissions)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Sync permission status error: ${e.message}", e)
            }
        }
    }
}
