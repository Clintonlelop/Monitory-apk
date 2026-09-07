package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Single contact entry.
 */
data class ContactEntry(
    @SerializedName("name") val name: String,
    @SerializedName("phone") val phone: String?,
    @SerializedName("email") val email: String?
)

/**
 * Contacts sync request.
 * POST /api/contacts/sync
 */
data class ContactsSyncRequest(
    @SerializedName("contacts") val contacts: List<ContactEntry>
)

/**
 * Contacts sync response.
 */
data class ContactsSyncResponse(
    @SerializedName("success") val success: Boolean = true,
    @SerializedName("synced") val synced: Int? = null
)
