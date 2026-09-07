package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Single SMS message entry.
 *
 * NOTE: On Android 10+ (API 29), READ_SMS permission is restricted.
 * Only the default SMS app can read the full SMS content via Telephony.Sms.CONTENT_URI.
 * Non-default apps receive an empty cursor. This limitation is documented and
 * the app reports it gracefully rather than attempting to bypass Android security.
 */
data class SmsEntry(
    @SerializedName("address") val address: String,
    @SerializedName("body") val body: String?,
    @SerializedName("message_type") val messageType: String,
    @SerializedName("date") val date: Long,
    @SerializedName("thread_id") val threadId: Long
)

/**
 * SMS sync request.
 * POST /api/sms/sync
 */
data class SmsSyncRequest(
    @SerializedName("messages") val messages: List<SmsEntry>
)

/**
 * SMS sync response.
 */
data class SmsSyncResponse(
    @SerializedName("success") val success: Boolean = true,
    @SerializedName("synced") val synced: Int? = null
)
