package com.example.data.remote

import com.example.data.model.AppInfoData
import com.example.data.model.AuthRequest
import com.example.data.model.AuthResponse
import com.example.data.model.CommandStatusUpdate
import com.example.data.model.DevicePermissionsStatus
import com.example.data.model.DeviceTelemetry
import com.example.data.model.FileEntryData
import com.example.data.model.LocationData
import com.example.data.model.NotificationData
import com.example.data.model.PairingRequest
import com.example.data.model.PairingResponse
import com.example.data.model.RegisterDeviceRequest
import com.example.data.model.RemoteCommand
import com.example.data.model.UsageData
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {

    @POST("/api/auth/register")
    suspend fun registerUser(
        @Body request: AuthRequest
    ): Response<AuthResponse>

    @POST("/api/auth/login")
    suspend fun loginUser(
        @Body request: AuthRequest
    ): Response<AuthResponse>

    @POST("/api/devices/register-device")
    suspend fun registerDevice(
        @Header("Authorization") userToken: String,
        @Body request: RegisterDeviceRequest
    ): Response<PairingResponse>

    @POST("/api/devices/pair")
    suspend fun pairDevice(
        @Body request: PairingRequest
    ): Response<PairingResponse>

    @POST("/api/devices/{id}/telemetry")
    suspend fun syncTelemetry(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Body telemetry: DeviceTelemetry
    ): Response<Unit>

    @POST("/api/devices/{id}/location")
    suspend fun syncLocation(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Body location: LocationData
    ): Response<Unit>

    @POST("/api/devices/{id}/notifications")
    suspend fun syncNotification(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Body notification: NotificationData
    ): Response<Unit>

    @POST("/api/devices/{id}/apps")
    suspend fun syncApps(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Body apps: List<AppInfoData>
    ): Response<Unit>

    @POST("/api/devices/{id}/usage")
    suspend fun syncUsage(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Body usage: List<UsageData>
    ): Response<Unit>

    @POST("/api/devices/{id}/files/sync")
    suspend fun syncFiles(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Body files: List<FileEntryData>
    ): Response<Unit>

    @PUT("/api/devices/{id}/permissions")
    suspend fun updatePermissions(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Body permissions: DevicePermissionsStatus
    ): Response<Unit>

    @GET("/api/devices/{id}/commands/pending")
    suspend fun getPendingCommands(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String
    ): Response<List<RemoteCommand>>

    @POST("/api/devices/{id}/commands/{commandId}/status")
    suspend fun updateCommandStatus(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Path("commandId") commandId: String,
        @Body update: CommandStatusUpdate
    ): Response<Unit>

    @Multipart
    @POST("/api/devices/{id}/camera")
    suspend fun uploadCameraCapture(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Part file: MultipartBody.Part,
        @Part("timestamp") timestamp: RequestBody
    ): Response<Unit>

    @Multipart
    @POST("/api/devices/{id}/recordings")
    suspend fun uploadAudioRecording(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String,
        @Part file: MultipartBody.Part,
        @Part("durationMs") durationMs: RequestBody
    ): Response<Unit>

    @DELETE("/api/devices/{id}/disconnect")
    suspend fun disconnectDevice(
        @Header("Authorization") token: String,
        @Path("id") deviceId: String
    ): Response<Unit>
}
