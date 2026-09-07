package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Single file metadata entry.
 * Only metadata is synced — actual file uploads use /api/upload (multipart).
 */
data class FileEntry(
    @SerializedName("filename") val filename: String,
    @SerializedName("file_type") val fileType: String,
    @SerializedName("size_bytes") val sizeBytes: Long,
    @SerializedName("file_path") val filePath: String?,
    @SerializedName("mime_type") val mimeType: String?,
    @SerializedName("date_modified") val dateModified: Long
)

/**
 * Files sync request.
 * POST /api/files/sync
 */
data class FilesSyncRequest(
    @SerializedName("files") val files: List<FileEntry>
)

/**
 * Files sync response.
 */
data class FilesSyncResponse(
    @SerializedName("success") val success: Boolean = true,
    @SerializedName("synced") val synced: Int? = null
)

/**
 * File upload response (multipart POST /api/upload).
 */
data class FileUploadResponse(
    @SerializedName("success") val success: Boolean = true,
    @SerializedName("webPath") val webPath: String? = null,
    @SerializedName("id") val id: String? = null,
    @SerializedName("filename") val filename: String? = null,
    @SerializedName("file_type") val fileType: String? = null,
    @SerializedName("size_bytes") val sizeBytes: Long? = null,
    @SerializedName("url") val url: String? = null
)
