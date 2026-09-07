package com.devicemanager.services

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import com.devicemanager.DeviceManagerApp
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * AccessibilityService for remote input injection.
 *
 * This is the ONLY legitimate method for input injection on Android.
 * The user MUST explicitly enable this service in Android Accessibility Settings.
 * No attempt is made to bypass this requirement.
 *
 * Receives INPUT_EVENT messages via WebSocket and uses dispatchGesture() to inject:
 * - tap: single tap at (x, y)
 * - swipe: swipe from (x, y) to (x2, y2) over duration
 * - scroll: vertical scroll via swipe gesture
 * - key: key event (home, back, recent, etc.)
 *
 * Input injection latency is measured and reported in QUALITY_REPORT.
 */
class RemoteInputService : AccessibilityService() {
    companion object {
        private const val TAG = "RemoteInputService"

        // Singleton instance for checking if service is enabled
        @Volatile
        var instance: RemoteInputService? = null
            private set

        @Volatile
        var isServiceEnabled: Boolean = false
            private set

        // Input event listener for WebSocket integration
        private var inputEventListener: ((Map<String, Any>) -> Unit)? = null
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var gson: Gson

    // Low-latency mode flag
    @Volatile
    private var lowLatencyMode: Boolean = false

    // Input latency tracking
    @Volatile
    private var lastInputLatencyMs: Long = 0

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        isServiceEnabled = true
        gson = (application as DeviceManagerApp).gson
        Log.d(TAG, "RemoteInputService connected. Remote control input injection available.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not needed for input injection — we only use dispatchGesture
    }

    override fun onInterrupt() {
        Log.d(TAG, "RemoteInputService interrupted")
    }

    override fun onDestroy() {
        isServiceEnabled = false
        instance = null
        super.onDestroy()
        Log.d(TAG, "RemoteInputService destroyed")
    }

    /**
     * Set low-latency mode. When enabled, process INPUT_EVENT within 16ms.
     */
    fun setLowLatencyMode(enabled: Boolean) {
        lowLatencyMode = enabled
        Log.d(TAG, "Low-latency mode: $enabled")
    }

    /**
     * Process an input event from the dashboard.
     * Called from WebSocket message handler.
     *
     * @param event Map containing: action, x, y, x2, y2, duration, key_code
     */
    fun processInputEvent(event: Map<String, Any>) {
        val receiveTime = System.currentTimeMillis()
        val action = event["action"] as? String ?: return

        // In low-latency mode, process immediately on main thread
        if (lowLatencyMode) {
            mainHandler.post {
                executeGesture(action, event, receiveTime)
            }
        } else {
            scope.launch {
                executeGesture(action, event, receiveTime)
            }
        }
    }

    /**
     * Execute the actual gesture injection.
     */
    private fun executeGesture(action: String, event: Map<String, Any>, receiveTime: Long) {
        try {
            when (action) {
                "tap" -> injectTap(event)
                "swipe" -> injectSwipe(event)
                "scroll" -> injectScroll(event)
                "key" -> injectKeyEvent(event)
                else -> Log.w(TAG, "Unknown input action: $action")
            }

            // Measure input injection latency
            lastInputLatencyMs = System.currentTimeMillis() - receiveTime

            // Report to adaptive manager if screen stream is active
            ScreenStreamService.instance?.let { streamService ->
                // We can't directly access adaptiveManager, but we track it here
                // and it's reported via QUALITY_REPORT
            }

            Log.d(TAG, "Input injected: $action, latency=${lastInputLatencyMs}ms")
        } catch (e: Exception) {
            Log.e(TAG, "Input injection error: ${e.message}", e)
        }
    }

    /**
     * Inject a tap gesture at (x, y).
     */
    private fun injectTap(event: Map<String, Any>) {
        val x = (event["x"] as? Number)?.toFloat() ?: return
        val y = (event["y"] as? Number)?.toFloat() ?: return

        val path = Path().apply {
            moveTo(x, y)
        }

        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
            .build()

        dispatchGesture(gesture, null, null)
        Log.d(TAG, "Tap injected at ($x, $y)")
    }

    /**
     * Inject a swipe gesture from (x, y) to (x2, y2).
     */
    private fun injectSwipe(event: Map<String, Any>) {
        val x = (event["x"] as? Number)?.toFloat() ?: return
        val y = (event["y"] as? Number)?.toFloat() ?: return
        val x2 = (event["x2"] as? Number)?.toFloat() ?: return
        val y2 = (event["y2"] as? Number)?.toFloat() ?: return
        val duration = (event["duration"] as? Number)?.toLong() ?: 300L

        val path = Path().apply {
            moveTo(x, y)
            lineTo(x2, y2)
        }

        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
            .build()

        dispatchGesture(gesture, null, null)
        Log.d(TAG, "Swipe injected ($x,$y) -> ($x2,$y2), duration=${duration}ms")
    }

    /**
     * Inject a scroll gesture (vertical swipe).
     * Positive scroll = scroll down, negative = scroll up.
     */
    private fun injectScroll(event: Map<String, Any>) {
        val x = (event["x"] as? Number)?.toFloat() ?: 540f
        val y = (event["y"] as? Number)?.toFloat() ?: 1000f
        val scrollAmount = (event["duration"] as? Number)?.toFloat() ?: 500f

        // Scroll down = swipe up, scroll up = swipe down
        val y2 = if (scrollAmount > 0) y - scrollAmount else y + Math.abs(scrollAmount)

        val path = Path().apply {
            moveTo(x, y)
            lineTo(x, y2)
        }

        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 200L))
            .build()

        dispatchGesture(gesture, null, null)
        Log.d(TAG, "Scroll injected at x=$x, amount=$scrollAmount")
    }

    /**
     * Inject a key event (home, back, recent, etc.)
     * Uses performGlobalAction for system-level key events.
     */
    private fun injectKeyEvent(event: Map<String, Any>) {
        val keyCode = (event["key_code"] as? String) ?: return

        val action = when (keyCode.uppercase()) {
            "HOME" -> GLOBAL_ACTION_HOME
            "BACK" -> GLOBAL_ACTION_BACK
            "RECENT" -> GLOBAL_ACTION_RECENTS
            "NOTIFICATIONS" -> GLOBAL_ACTION_NOTIFICATIONS
            "QUICK_SETTINGS" -> GLOBAL_ACTION_QUICK_SETTINGS
            "POWER" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    GLOBAL_ACTION_LOCK_SCREEN
                } else {
                    Log.w(TAG, "Power key not supported on this Android version")
                    return
                }
            }
            else -> {
                Log.w(TAG, "Unsupported key code: $keyCode")
                return
            }
        }

        performGlobalAction(action)
        Log.d(TAG, "Key event injected: $keyCode")
    }

    /**
     * Get the last measured input injection latency.
     */
    fun getLastInputLatencyMs(): Long = lastInputLatencyMs

    /**
     * Check if the accessibility service is enabled.
     */
    fun isEnabled(): Boolean = isServiceEnabled
}
