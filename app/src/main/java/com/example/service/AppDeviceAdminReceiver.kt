package com.example.service

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Minimal device-admin receiver so the device owner can opt in to remote policy
 * features (e.g. lock screen) from the management dashboard. Enabling it is
 * always an explicit, visible Android system decision — nothing is forced.
 */
class AppDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
    }

    companion object {
        fun component(context: Context): ComponentName =
            ComponentName(context.applicationContext, AppDeviceAdminReceiver::class.java)
    }
}
