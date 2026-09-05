package com.example.data.remote

import android.util.Log
import com.example.data.model.RemoteCommand
import com.example.data.prefs.PreferenceManager
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class DeviceWebSocketManager(
    private val preferenceManager: PreferenceManager
) {
    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private var webSocket: WebSocket? = null
    private var pingJob: Job? = null
    private var reconnectJob: Job? = null

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _incomingCommands = MutableSharedFlow<RemoteCommand>()
    val incomingCommands: SharedFlow<RemoteCommand> = _incomingCommands.asSharedFlow()

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
    private val commandAdapter = moshi.adapter(RemoteCommand::class.java)

    fun connect() {
        if (!preferenceManager.isPaired()) return
        if (_isConnected.value) return

        val serverUrl = preferenceManager.getServerUrl()
        val wsUrl = serverUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://")
            .let { if (it.endsWith("/")) it else "$it/" } +
                "ws/device?deviceId=${preferenceManager.getDeviceId()}&token=${preferenceManager.getAuthToken() ?: ""}"

        val request = Request.Builder().url(wsUrl).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d("DeviceWS", "Connected to device management WebSocket")
                _isConnected.value = true
                startHeartbeat()
                
                // Send initial ONLINE notification
                val onlineMsg = JSONObject().apply {
                    put("type", "DEVICE_ONLINE")
                    put("deviceId", preferenceManager.getDeviceId())
                    put("timestamp", System.currentTimeMillis())
                }
                webSocket.send(onlineMsg.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d("DeviceWS", "Received WS message: $text")
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type")
                    if (type == "COMMAND") {
                        val commandJson = json.optJSONObject("command")?.toString() ?: text
                        val command = commandAdapter.fromJson(commandJson)
                        if (command != null) {
                            scope.launch {
                                _incomingCommands.emit(command)
                            }
                        }
                    } else if (type == "PONG") {
                        // Heartbeat acknowledged
                    }
                } catch (e: Exception) {
                    Log.e("DeviceWS", "Error parsing message", e)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                _isConnected.value = false
                stopHeartbeat()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _isConnected.value = false
                stopHeartbeat()
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w("DeviceWS", "WebSocket failure: ${t.message}")
                _isConnected.value = false
                stopHeartbeat()
                scheduleReconnect()
            }
        })
    }

    fun disconnect() {
        stopHeartbeat()
        reconnectJob?.cancel()
        try {
            webSocket?.close(1000, "Device disconnecting")
        } catch (_: Exception) {}
        webSocket = null
        _isConnected.value = false
    }

    fun sendCommandStatus(commandId: String, status: String, result: String? = null, error: String? = null) {
        val payload = JSONObject().apply {
            put("type", "COMMAND_STATUS")
            put("commandId", commandId)
            put("deviceId", preferenceManager.getDeviceId())
            put("status", status)
            if (result != null) put("result", result)
            if (error != null) put("errorMessage", error)
            put("timestamp", System.currentTimeMillis())
        }
        webSocket?.send(payload.toString())
    }

    fun sendAccessibilityEvent(packageName: String, className: String, text: String) {
        if (!_isConnected.value) return
        val payload = JSONObject().apply {
            put("type", "ACCESSIBILITY_EVENT")
            put("deviceId", preferenceManager.getDeviceId())
            put("packageName", packageName)
            put("className", className)
            put("text", text)
            put("timestamp", System.currentTimeMillis())
        }
        webSocket?.send(payload.toString())
    }

    private fun startHeartbeat() {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (isActive && _isConnected.value) {
                delay(20_000)
                try {
                    val ping = JSONObject().apply {
                        put("type", "PING")
                        put("deviceId", preferenceManager.getDeviceId())
                        put("timestamp", System.currentTimeMillis())
                    }
                    webSocket?.send(ping.toString())
                } catch (e: Exception) {
                    break
                }
            }
        }
    }

    private fun stopHeartbeat() {
        pingJob?.cancel()
        pingJob = null
    }

    private fun scheduleReconnect() {
        if (!preferenceManager.isPaired()) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(5_000)
            if (!_isConnected.value) {
                connect()
            }
        }
    }
}
