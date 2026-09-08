package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Request body for device registration.
 * POST /api/devices/register
 */
data class RegisterRequest(
    @SerializedName("device_token") val deviceToken: String,
    @SerializedName("name") val name: String,
    @SerializedName("model") val model: String,
    @SerializedName("manufacturer") val manufacturer: String,
    @SerializedName("android_version") val androidVersion: String,
    @SerializedName("app_version") val appVersion: String
)

/**
 * Response from device registration.
 */
data class RegisterResponse(
    @SerializedName("id") val id: String,
    @SerializedName("device_token") val deviceToken: String,
    @SerializedName("name") val name: String,
    @SerializedName("status") val status: String,
    @SerializedName("paired") val paired: Boolean
)

/**
 * Generic API response wrapper.
 */
data class ApiResponse<T>(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String?,
    @SerializedName("data") val data: T?
)
