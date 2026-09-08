package com.devicemanager.data.repository

import android.util.Log
import com.devicemanager.data.remote.ApiService
import com.devicemanager.data.remote.model.*
import com.devicemanager.util.Preferences
import retrofit2.Response

/**
 * Repository for device registration, pairing, and device-level operations.
 */
class DeviceRepository(
    private val apiService: ApiService,
    private val preferences: Preferences
) {
    companion object {
        private const val TAG = "DeviceRepository"
    }

    /**
     * Register the device with the backend.
     */
    suspend fun registerDevice(
        deviceToken: String,
        name: String,
        model: String,
        manufacturer: String,
        androidVersion: String,
        appVersion: String
    ): Result<RegisterResponse> {
        return try {
            val request = RegisterRequest(
                deviceToken = deviceToken,
                name = name,
                model = model,
                manufacturer = manufacturer,
                androidVersion = androidVersion,
                appVersion = appVersion
            )
            val response = apiService.registerDevice(request)
            if (response.isSuccessful && response.body() != null) {
                val body = response.body()!!
                preferences.deviceId = body.id
                preferences.isPaired = body.paired
                preferences.deviceName = name
                Result.success(body)
            } else {
                val error = "Registration failed: HTTP ${response.code()} ${response.message()}"
                Log.e(TAG, error)
                Result.failure(Exception(error))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Registration error: ${e.message}", e)
            Result.failure(e)
        }
    }

    /**
     * Update permission status on the server.
     */
    suspend fun updatePermissions(
        deviceId: String,
        permissions: List<PermissionEntry>
    ): Result<PermissionsResponse> {
        return try {
            val response = apiService.updatePermissions(deviceId, PermissionsRequest(permissions))
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                Result.failure(Exception("Permission update failed: HTTP ${response.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Permission update error: ${e.message}", e)
            Result.failure(e)
        }
    }

    /**
     * Fetch pending commands from the server (polling fallback).
     */
    suspend fun getPendingCommands(deviceId: String): Result<List<Command>> {
        return try {
            val response = apiService.getPendingCommands(deviceId)
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!.commands)
            } else {
                Result.failure(Exception("Failed to fetch commands: HTTP ${response.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Fetch commands error: ${e.message}", e)
            Result.failure(e)
        }
    }

    /**
     * Update command status on the server.
     */
    suspend fun updateCommandStatus(
        commandId: String,
        status: String,
        result: String? = null,
        error: String? = null
    ): Result<Unit> {
        return try {
            val request = CommandStatusRequest(status = status, result = result, error = error)
            val response = apiService.updateCommandStatus(commandId, request)
            if (response.isSuccessful) {
                Result.success(Unit)
            } else {
                Result.failure(Exception("Command status update failed: HTTP ${response.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Command status update error: ${e.message}", e)
            Result.failure(e)
        }
    }
}
