package com.example.service

import android.app.Notification
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.example.DeviceManagerApp
import com.example.data.model.NotificationData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class NotificationMonitorService : NotificationListenerService() {

    private val scope = CoroutineScope(Dispatchers.IO + Job())

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        try {
            val app = application as? DeviceManagerApp ?: return
            if (!app.preferenceManager.isPaired()) return

            val packageName = sbn.packageName ?: return
            // Avoid recording our own notifications
            if (packageName == applicationContext.packageName) return

            val extras = sbn.notification?.extras ?: return
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
                ?: extras.getCharSequence(Notification.EXTRA_TITLE_BIG)?.toString()
                ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
                ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
                ?: ""

            if (title.isBlank() && text.isBlank()) return

            val pm = applicationContext.packageManager
            val appName = try {
                val appInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    pm.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
                } else {
                    pm.getApplicationInfo(packageName, 0)
                }
                pm.getApplicationLabel(appInfo).toString()
            } catch (_: Exception) {
                packageName
            }

            val category = sbn.notification?.category

            val notificationData = NotificationData(
                deviceId = app.preferenceManager.getDeviceId(),
                packageName = packageName,
                appName = appName,
                title = title,
                text = text,
                category = category,
                postTime = sbn.postTime
            )

            scope.launch {
                app.repository.recordNotification(notificationData)
            }
        } catch (e: Exception) {
            Log.e("NotifMonitor", "Error processing notification", e)
        }
    }
}
