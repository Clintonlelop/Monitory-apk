package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Location data request.
 * POST /api/locations
 */
data class LocationRequest(
    @SerializedName("lat") val lat: Double,
    @SerializedName("lng") val lng: Double,
    @SerializedName("accuracy") val accuracy: Float,
    @SerializedName("altitude") val altitude: Double,
    @SerializedName("speed") val speed: Float,
    @SerializedName("provider") val provider: String,
    @SerializedName("timestamp") val timestamp: Long
)

/**
 * Location data response.
 */
data class LocationResponse(
    @SerializedName("success") val success: Boolean = true,
    @SerializedName("id") val id: String? = null,
    @SerializedName("timestamp") val timestamp: String? = null
)
