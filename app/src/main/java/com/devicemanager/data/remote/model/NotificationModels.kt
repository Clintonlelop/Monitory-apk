package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Notification event request.
 * POST /api/notifications
 */
data class NotificationRequest(
    @SerializedName("package_name") val packageName: String,
    @SerializedName("title") val title: String?,
    @SerializedName("text") val text: String?,
    @SerializedName("category") val category: String?,
    @SerializedName("posted_time") val postedTime: Long
)

/**
 * Notification response.
 */
data class NotificationResponse(
    @SerializedName("success") val success: Boolean = true,
    @SerializedName("id") val id: String? = null
)
