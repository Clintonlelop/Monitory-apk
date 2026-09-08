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
    @SerializedName("id") val id: String,
    @SerializedName("timestamp") val timestamp: String
)
