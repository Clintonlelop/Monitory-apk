package com.devicemanager.data.remote

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import com.devicemanager.data.remote.model.Command
import com.devicemanager.data.remote.model.CommandMessage
import com.devicemanager.data.remote.model.CommandStatusMessage
import com.devicemanager.util.Constants
import com.devicemanager.util.Extensions
import com.google.gson.Gson
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * OkHttp WebSocket client for real-time command reception and status updates.
 *
 * Connects to ws://<host>/ws?device_token=<token>
 * Receives: {type: "COMMAND", command: {id, type, payload}}
 * Sends: {type: "COMMAND_STATUS", command_id, status, result, error}
 *
 * Handles automatic reconnection with exponential backoff.
 */
class WebSocketClient(
    private val okHttpClient: OkHttpClient,
    private val gson: Gson,
    private val context: Context? = null
) {
    companion object {
        private const val TAG = "WebSocketClient"
        private const val PING_INTERVAL_MS = 15000L
        private const val PONG_TIMEOUT_MS = 30000L
        private const val MAX_RECONNECT_DELAY_MS = 60000L
        private const val RECONNECT_BASE_DELAY_MS = 1000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var webSocket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var pingJob: Job? = null
    private var pongTimeoutJob: Job? = null

    private var currentServerUrl: String = ""
    private var currentDeviceToken: String = ""
    private var currentDeviceId: String = ""

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _incomingCommands = MutableStateFlow<Command?>(null)
    val incomingCommands: StateFlow<Command?> = _incomingCommands.asStateFlow()

    private var commandListener: ((Command) -> Unit)? = null

    // Reconnection tracking
    private val reconnectAttempts = AtomicInteger(0)
    private var lastDisconnectReason: String = "unknown"
    private var lastDisconnectTime = 0L
    private var lastPongTime = 0L
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    enum class ConnectionState {
        CONNECTING, CONNECTED, DISCONNECTED, RECONNECTING
    }

    /**
     * Set a listener for incoming commands.
     */
    fun setCommandListener(listener: (Command) -> Unit) {
        this.commandListener = listener
    }

    /**
     * Connect to the WebSocket server.
     */
    fun connect(serverUrl: String, deviceToken: String, deviceId: String) {
        if (deviceToken.isBlank()) {
            Log.w(TAG, "Cannot connect: device token is blank")
            return
        }

        currentServerUrl = serverUrl
        currentDeviceToken = deviceToken
        currentDeviceId = deviceId

        if (_connectionState.value == ConnectionState.CONNECTED ||
            _connectionState.value == ConnectionState.CONNECTING
        ) {
            Log.d(TAG, "Already connected or connecting")
            return
        }

        _connectionState.value = ConnectionState.CONNECTING
        registerNetworkCallback()

        val wsUrl = Extensions.toWebSocketUrl(serverUrl, deviceId)
        Log.d(TAG, "Connecting to: $wsUrl")

        val request = Request.Builder()
            .url(wsUrl)
            .header("X-Device-Token", deviceToken)
            .build()

        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket connected")
                _connectionState.value = ConnectionState.CONNECTED
                reconnectAttempts.set(0)
                lastPongTime = System.currentTimeMillis()
                startPingLoop()
                sendConnectionStateChanged("CONNECTED", null)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleIncomingMessage(text)
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                handleIncomingMessage(bytes.utf8())
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code $reason")
                lastDisconnectReason = "closing_$code"
                ws.close(1000, null)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code $reason")
                lastDisconnectReason = "closed_$code"
                lastDisconnectTime = System.currentTimeMillis()
                _connectionState.value = ConnectionState.DISCONNECTED
                stopPingLoop()
                stopPongTimeout()
                sendConnectionStateChanged("DISCONNECTED", lastDisconnectReason)
                scheduleReconnect()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}", t)
                lastDisconnectReason = t.message ?: "error"
                lastDisconnectTime = System.currentTimeMillis()
                _connectionState.value = ConnectionState.DISCONNECTED
                stopPingLoop()
                stopPongTimeout()
                sendConnectionStateChanged("DISCONNECTED", lastDisconnectReason)
                scheduleReconnect()
            }
        })
    }

    /**
     * Disconnect from the WebSocket server.
     */
    fun disconnect() {
        Log.d(TAG, "Disconnecting WebSocket")
        reconnectJob?.cancel()
        stopPingLoop()
        webSocket?.close(1000, "Client disconnecting")
        webSocket = null
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    /**
     * Send a command status update.
     */
    fun sendCommandStatus(
        commandId: String,
        status: String,
        result: String? = null,
        error: String? = null
    ): Boolean {
        val message = CommandStatusMessage(
            commandId = commandId,
            status = status,
            result = result,
            error = error
        )
        val json = gson.toJson(message)
        return sendMessage(json)
    }

    /**
     * Send a raw JSON message.
     */
    fun sendMessage(json: String): Boolean {
        val ws = webSocket
        if (ws == null || _connectionState.value != ConnectionState.CONNECTED) {
            Log.w(TAG, "Cannot send message: not connected")
            return false
        }
        return try {
            ws.send(json)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send message: ${e.message}", e)
            false
        }
    }

    /**
     * Handle incoming WebSocket messages.
     */
    private fun handleIncomingMessage(text: String) {
        try {
            val jsonElement = JsonParser.parseString(text)
            if (!jsonElement.isJsonObject) return

            val jsonObject = jsonElement.asJsonObject
            val type = jsonObject.get("type")?.asString ?: return

            when (type) {
                "COMMAND" -> {
                    val command = gson.fromJson(jsonObject.get("command"), Command::class.java)
                    Log.d(TAG, "Received command: ${command.type} (id=${command.id})")
                    _incomingCommands.value = command
                    commandListener?.invoke(command)
                }
                "PING" -> {
                    sendMessage("""{"type":"PONG"}""")
                }
                "PONG" -> {
                    lastPongTime = System.currentTimeMillis()
                    stopPongTimeout()
                    // Notify screen stream service of pong for latency calculation
                    try {
                        val seq = jsonObject.get("seq")?.asInt ?: 0
                        com.devicemanager.services.ScreenStreamService.instance?.onPongReceived(seq)
                    } catch (e: Exception) {
                        Log.e(TAG, "PONG handling error: ${e.message}", e)
                    }
                }
                "INPUT_EVENT" -> {
                    // Route input event to RemoteInputService for gesture injection
                    try {
                        val inputService = com.devicemanager.services.RemoteInputService.instance
                        if (inputService != null && inputService.isEnabled()) {
                            val eventMap = mutableMapOf<String, Any>()
                            jsonObject.entrySet().forEach { (key, value) ->
                                if (key != "type" && key != "device_id") {
                                    when {
                                        value.isJsonPrimitive -> {
                                            val prim = value.asJsonPrimitive
                                            when {
                                                prim.isNumber -> eventMap[key] = prim.asNumber
                                                prim.isBoolean -> eventMap[key] = prim.asBoolean
                                                else -> eventMap[key] = prim.asString
                                            }
                                        }
                                    }
                                }
                            }
                            inputService.processInputEvent(eventMap)
                        } else {
                            Log.w(TAG, "INPUT_EVENT received but RemoteInputService is not enabled")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "INPUT_EVENT handling error: ${e.message}", e)
                    }
                }
                "STREAM_CONTROL" -> {
                    // Route stream control to ScreenStreamService
                    try {
                        val streamService = com.devicemanager.services.ScreenStreamService.instance
                        if (streamService != null) {
                            val action = jsonObject.get("action")?.asString
                            val targetFps = jsonObject.get("target_fps")?.asInt
                            val targetQuality = jsonObject.get("target_quality")?.asInt
                            val lowLatency = jsonObject.get("low_latency")?.asBoolean
                            streamService.updateStreamTargets(targetFps, targetQuality, lowLatency)
                            Log.d(TAG, "STREAM_CONTROL: action=$action, fps=$targetFps, quality=$targetQuality, lowLatency=$lowLatency")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "STREAM_CONTROL handling error: ${e.message}", e)
                    }
                }
                else -> {
                    Log.d(TAG, "Received unknown message type: $type")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse message: ${e.message}", e)
        }
    }

    /**
     * Schedule automatic reconnection with exponential backoff.
     * Backoff: 1s, 2s, 4s, 8s, 16s, 32s (max 60s)
     */
    private fun scheduleReconnect() {
        if (currentDeviceToken.isBlank()) return

        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            _connectionState.value = ConnectionState.RECONNECTING
            sendConnectionStateChanged("RECONNECTING", "attempt_${reconnectAttempts.get() + 1}")

            var delayMs = RECONNECT_BASE_DELAY_MS
            while (true) {
                val attempt = reconnectAttempts.incrementAndGet()
                delay(delayMs)
                if (_connectionState.value == ConnectionState.CONNECTED) break
                Log.d(TAG, "Reconnect attempt $attempt (delay=${delayMs}ms)...")
                webSocket = null
                connect(currentServerUrl, currentDeviceToken, currentDeviceId)
                // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, cap at 60s
                delayMs = (delayMs * 2).coerceAtMost(MAX_RECONNECT_DELAY_MS)
            }
        }
    }

    /**
     * Trigger immediate reconnect when network becomes available.
     */
    fun triggerImmediateReconnect() {
        if (_connectionState.value == ConnectionState.CONNECTED ||
            _connectionState.value == ConnectionState.CONNECTING
        ) return
        Log.d(TAG, "Network available — triggering immediate reconnect")
        reconnectJob?.cancel()
        reconnectAttempts.set(0)
        scope.launch {
            webSocket = null
            connect(currentServerUrl, currentDeviceToken, currentDeviceId)
        }
    }

    /**
     * Start periodic ping every 15s with pong timeout of 30s.
     */
    private fun startPingLoop() {
        stopPingLoop()
        stopPongTimeout()
        pingJob = scope.launch {
            while (_connectionState.value == ConnectionState.CONNECTED) {
                delay(PING_INTERVAL_MS)
                if (_connectionState.value != ConnectionState.CONNECTED) break
                sendMessage("""{"type":"PING","seq":${System.currentTimeMillis()}}""")
                startPongTimeout()
            }
        }
    }

    private fun stopPingLoop() {
        pingJob?.cancel()
        pingJob = null
    }

    /**
     * Start pong timeout — if no pong within 30s, consider disconnected.
     */
    private fun startPongTimeout() {
        stopPongTimeout()
        pongTimeoutJob = scope.launch {
            delay(PONG_TIMEOUT_MS)
            if (_connectionState.value == ConnectionState.CONNECTED) {
                val timeSincePong = System.currentTimeMillis() - lastPongTime
                if (timeSincePong > PONG_TIMEOUT_MS) {
                    Log.w(TAG, "No pong for ${timeSincePong}ms — forcing reconnect")
                    lastDisconnectReason = "pong_timeout"
                    webSocket?.close(1001, "Pong timeout")
                    webSocket = null
                    _connectionState.value = ConnectionState.DISCONNECTED
                    stopPingLoop()
                    scheduleReconnect()
                }
            }
        }
    }

    private fun stopPongTimeout() {
        pongTimeoutJob?.cancel()
        pongTimeoutJob = null
    }

    /**
     * Register network callback to trigger immediate reconnect on network restore.
     */
    private fun registerNetworkCallback() {
        if (context == null || networkCallback != null) return
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()

            networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.d(TAG, "Network available — triggering reconnect")
                    triggerImmediateReconnect()
                }

                override fun onLost(network: Network) {
                    Log.d(TAG, "Network lost")
                }
            }

            cm.registerNetworkCallback(request, networkCallback!!)
            Log.d(TAG, "Network callback registered")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register network callback: ${e.message}", e)
        }
    }

    /**
     * Send CONNECTION_STATE_CHANGED event to server.
     */
    private fun sendConnectionStateChanged(state: String, reason: String?) {
        try {
            val msg = mapOf(
                "type" to "CONNECTION_STATE_CHANGED",
                "state" to state,
                "reason" to reason,
                "attempt" to reconnectAttempts.get(),
                "timestamp" to System.currentTimeMillis()
            )
            // Only send if connected (for RECONNECTING/DISCONNECTED, server will detect via close)
            if (state == "CONNECTED") {
                sendMessage(gson.toJson(msg))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send connection state: ${e.message}", e)
        }
    }

    /**
     * Get reconnection statistics.
     */
    fun getReconnectionInfo(): ReconnectionInfo {
        return ReconnectionInfo(
            attempts = reconnectAttempts.get(),
            lastDisconnectReason = lastDisconnectReason,
            lastDisconnectTime = lastDisconnectTime,
            currentState = _connectionState.value.name
        )
    }

    data class ReconnectionInfo(
        val attempts: Int,
        val lastDisconnectReason: String,
        val lastDisconnectTime: Long,
        val currentState: String
    )
}
