package com.devicemanager.manager

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.devicemanager.data.remote.model.LocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Wrapper around FusedLocationProviderClient for location collection.
 *
 * Uses PRIORITY_HIGH_ACCURACY for on-demand commands and periodic updates.
 * Checks permission before accessing and reports denied state.
 *
 * NOTE: Geofencing is evaluated server-side. This client only sends raw
 * location data; no Google Play Services Geofencing API dependency is needed.
 */
class LocationManager(private val context: Context) {
    companion object {
        private const val TAG = "LocationManager"
    }

    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)

    /**
     * Check if location permission is granted.
     */
    fun hasPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    /**
     * Get the current location as a LocationRequest.
     * Returns null if permission is not granted or location is unavailable.
     */
    @SuppressLint("MissingPermission")
    suspend fun getCurrentLocation(): LocationRequest? {
        if (!hasPermission()) {
            Log.w(TAG, "Location permission not granted")
            return null
        }

        return try {
            val location = getCurrentLocationSingle()
            if (location != null) {
                LocationRequest(
                    lat = location.latitude,
                    lng = location.longitude,
                    accuracy = location.accuracy,
                    altitude = location.altitude,
                    speed = location.speed,
                    provider = location.provider ?: "fused",
                    timestamp = location.time
                )
            } else {
                Log.w(TAG, "Location is null")
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Get current location error: ${e.message}", e)
            null
        }
    }

    /**
     * Get a single location update using requestLocationUpdates.
     */
    @SuppressLint("MissingPermission")
    private suspend fun getCurrentLocationSingle(): Location? =
        suspendCancellableCoroutine { cont ->
            val locationRequest = LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                10000L
            ).apply {
                setMaxUpdates(1)
                setWaitForAccurateLocation(false)
            }.build()

            val callback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    val location = result.lastLocation
                    fusedLocationClient.removeLocationUpdates(this)
                    if (cont.isActive) {
                        cont.resume(location)
                    }
                }
            }

            try {
                fusedLocationClient.requestLocationUpdates(
                    locationRequest,
                    callback,
                    Looper.getMainLooper()
                )

                // Also try last known location as a faster fallback
                fusedLocationClient.lastLocation.addOnSuccessListener { location ->
                    if (location != null && cont.isActive) {
                        fusedLocationClient.removeLocationUpdates(callback)
                        cont.resume(location)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Location request error: ${e.message}", e)
                if (cont.isActive) {
                    cont.resume(null)
                }
            }
        }
}
