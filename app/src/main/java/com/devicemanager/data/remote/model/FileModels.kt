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
    @SerializedName("synced") val synced: Int
)

/**
 * File upload response (multipart POST /api/upload).
 */
data class FileUploadResponse(
    @SerializedName("id") val id: String,
    @SerializedName("filename") val filename: String,
    @SerializedName("file_type") val fileType: String,
    @SerializedName("size_bytes") val sizeBytes: Long,
    @SerializedName("url") val url: String?
)
