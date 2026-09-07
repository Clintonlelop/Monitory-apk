package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Device info model used across the app.
 */
data class DeviceInfo(
    @SerializedName("id") val id: String,
    @SerializedName("device_token") val deviceToken: String,
    @SerializedName("name") val name: String,
    @SerializedName("model") val model: String,
    @SerializedName("manufacturer") val manufacturer: String,
    @SerializedName("android_version") val androidVersion: String,
    @SerializedName("app_version") val appVersion: String,
    @SerializedName("online") val online: Boolean,
    @SerializedName("last_seen") val lastSeen: String?
)

/**
 * Device status update request.
 */
data class DeviceStatusRequest(
    @SerializedName("online") val online: Boolean,
    @SerializedName("last_seen") val lastSeen: Long
)
