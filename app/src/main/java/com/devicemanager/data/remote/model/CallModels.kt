package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Single call log entry.
 */
data class CallEntry(
    @SerializedName("number") val number: String,
    @SerializedName("contact_name") val contactName: String?,
    @SerializedName("call_type") val callType: String,
    @SerializedName("duration_seconds") val durationSeconds: Long,
    @SerializedName("call_date") val callDate: Long
)

/**
 * Calls sync request.
 * POST /api/calls/sync
 */
data class CallsSyncRequest(
    @SerializedName("calls") val calls: List<CallEntry>
)

/**
 * Calls sync response.
 */
data class CallsSyncResponse(
    @SerializedName("synced") val synced: Int
)
