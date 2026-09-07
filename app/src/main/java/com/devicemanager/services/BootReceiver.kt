package com.devicemanager.services

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Boot receiver that restarts the MainForegroundService after device boot.
 *
 * Only starts if the device has been paired (setup complete).
 */
class BootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.d(TAG, "Boot completed received")

            val prefs = context.getSharedPreferences("device_prefs", Context.MODE_PRIVATE)
            val isPaired = prefs.getBoolean("is_paired", false)
            val isSetupComplete = prefs.getBoolean("is_setup_complete", false)

            if (isPaired && isSetupComplete) {
                Log.d(TAG, "Device is paired, starting foreground service")
                MainForegroundService.start(context)
            } else {
                Log.d(TAG, "Device not paired, skipping service start")
            }
        }
    }
}
