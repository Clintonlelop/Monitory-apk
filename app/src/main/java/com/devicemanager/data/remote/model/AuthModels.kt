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

/**
 * Request body for account login.
 */
data class LoginRequest(
    @SerializedName("email") val email: String,
    @SerializedName("password") val password: String
)

/**
 * Response from account login.
 */
data class LoginResponse(
    @SerializedName("token") val token: String,
    @SerializedName("user") val user: UserInfo
)

data class UserInfo(
    @SerializedName("id") val id: Int,
    @SerializedName("username") val username: String,
    @SerializedName("email") val email: String,
    @SerializedName("role") val role: String
)

/**
 * Request body for account-based device registration.
 */
data class RegisterDeviceRequest(
    @SerializedName("deviceName") val deviceName: String,
    @SerializedName("manufacturer") val manufacturer: String,
    @SerializedName("model") val model: String,
    @SerializedName("osVersion") val osVersion: String,
    @SerializedName("sdkVersion") val sdkVersion: Int,
    @SerializedName("appVersion") val appVersion: String
)

/**
 * Response from account-based device registration.
 */
data class RegisterDeviceResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("token") val token: String,
    @SerializedName("message") val message: String
)

