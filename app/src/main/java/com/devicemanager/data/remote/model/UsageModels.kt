package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Single app usage entry.
 */
data class UsageEntry(
    @SerializedName("package_name") val packageName: String,
    @SerializedName("app_name") val appName: String,
    @SerializedName("usage_seconds") val usageSeconds: Long,
    @SerializedName("last_used") val lastUsed: Long,
    @SerializedName("date") val date: String
)

/**
 * Usage stats request.
 * POST /api/usage
 */
data class UsageRequest(
    @SerializedName("usage") val usage: List<UsageEntry>
)

/**
 * Usage stats response.
 */
data class UsageResponse(
    @SerializedName("success") val success: Boolean = true,
    @SerializedName("synced") val synced: Int? = null
)
