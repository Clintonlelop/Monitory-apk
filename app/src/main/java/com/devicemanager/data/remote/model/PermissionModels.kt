package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Single permission status entry.
 */
data class PermissionEntry(
    @SerializedName("permission_name") val permissionName: String,
    @SerializedName("status") val status: String
)

/**
 * Permissions update request.
 * PUT /api/devices/{id}/permissions
 */
data class PermissionsRequest(
    @SerializedName("permissions") val permissions: List<PermissionEntry>
)

/**
 * Permissions response.
 */
data class PermissionsResponse(
    @SerializedName("updated") val updated: Int
)

/**
 * Permission status constants.
 */
object PermissionStatus {
    const val GRANTED = "GRANTED"
    const val DENIED = "DENIED"
    const val REQUIRES_USER_ACTION = "REQUIRES_USER_ACTION"
    const val NOT_AVAILABLE = "NOT_AVAILABLE"
}
