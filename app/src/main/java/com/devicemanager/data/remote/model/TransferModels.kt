package com.devicemanager.data.remote.model

import com.google.gson.annotations.SerializedName

/**
 * Request to initialize a chunked file transfer.
 * POST /api/transfers/init
 */
data class TransferInitRequest(
    @SerializedName("device_id") val deviceId: String,
    @SerializedName("filename") val filename: String,
    @SerializedName("size") val size: Long,
    @SerializedName("checksum") val checksum: String,
    @SerializedName("mime_type") val mimeType: String
)

/**
 * Response from transfer initialization.
 */
data class TransferInitResponse(
    @SerializedName("transfer_id") val transferId: String,
    @SerializedName("chunk_size") val chunkSize: Int,
    @SerializedName("total_chunks") val totalChunks: Int
)

/**
 * Request to upload a single chunk.
 * POST /api/transfers/:id/chunk
 */
data class ChunkUploadRequest(
    @SerializedName("chunk_index") val chunkIndex: Int,
    @SerializedName("total_chunks") val totalChunks: Int,
    @SerializedName("checksum") val checksum: String,
    @SerializedName("data") val data: String
)

/**
 * Response from chunk upload.
 */
data class ChunkUploadResponse(
    @SerializedName("received") val received: Boolean,
    @SerializedName("verified") val verified: Boolean,
    @SerializedName("chunk_index") val chunkIndex: Int,
    @SerializedName("uploaded_chunks") val uploadedChunks: Int,
    @SerializedName("total_chunks") val totalChunks: Int
)

/**
 * Response from transfer completion.
 * POST /api/transfers/:id/complete
 */
data class TransferCompleteResponse(
    @SerializedName("verified") val verified: Boolean,
    @SerializedName("file_id") val fileId: Int?,
    @SerializedName("transfer_id") val transferId: String?,
    @SerializedName("checksum") val checksum: String?
)

/**
 * Transfer status response.
 * GET /api/transfers/:id/status
 */
data class TransferStatusResponse(
    @SerializedName("transfer_id") val transferId: String,
    @SerializedName("filename") val filename: String,
    @SerializedName("size_bytes") val sizeBytes: Long,
    @SerializedName("uploaded_chunks") val uploadedChunks: List<Int>,
    @SerializedName("uploaded_count") val uploadedCount: Int,
    @SerializedName("total_chunks") val totalChunks: Int,
    @SerializedName("status") val status: String,
    @SerializedName("error_message") val errorMessage: String?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String
)

/**
 * Request to verify full file checksum.
 */
data class FileChecksumRequest(
    @SerializedName("transfer_id") val transferId: String,
    @SerializedName("checksum") val checksum: String
)

/**
 * Transfer status constants.
 */
object TransferStatus {
    const val PENDING = "PENDING"
    const val UPLOADING = "UPLOADING"
    const val COMPLETING = "COMPLETING"
    const val COMPLETED = "COMPLETED"
    const val FAILED = "FAILED"
    const val PAUSED = "PAUSED"
    const val CANCELLED = "CANCELLED"
}

/**
 * Transfer priority levels.
 */
object TransferPriority {
    const val LOW = 0
    const val NORMAL = 1
    const val HIGH = 2
    const val URGENT = 3
}
