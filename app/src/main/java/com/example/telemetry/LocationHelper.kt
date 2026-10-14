package com.example.telemetry

import android.annotation.SuppressLint
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
import com.example.data.model.LocationData
import com.example.data.prefs.PreferenceManager
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

class LocationHelper(
    private val context: Context,
    private val preferenceManager: PreferenceManager
) {
    private val fusedClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)

    fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    @SuppressLint("MissingPermission")
    suspend fun getCurrentLocation(): LocationData? {
        if (!hasLocationPermission()) return null

        val location: Location? = try {
            val cts = CancellationTokenSource()
            suspendCancellableCoroutine { continuation ->
                fusedClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                    .addOnSuccessListener { loc ->
                        continuation.resume(loc)
                    }
                    .addOnFailureListener {
                        continuation.resume(null)
                    }
                    .addOnCanceledListener {
                        continuation.resume(null)
                    }

                continuation.invokeOnCancellation {
                    cts.cancel()
                }
            }
        } catch (_: Exception) {
            null
        }

        if (location != null) {
            return LocationData(
                deviceId = preferenceManager.getDeviceId(),
                latitude = location.latitude,
                longitude = location.longitude,
                accuracy = location.accuracy,
                altitude = if (location.hasAltitude()) location.altitude else null,
                speed = if (location.hasSpeed()) location.speed else null,
                provider = location.provider,
                timestamp = location.time
            )
        }

        // Fallback to LocationManager last known location
        return try {
            val locManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val providers = locManager.getProviders(true)
            var bestLoc: Location? = null
            for (provider in providers) {
                val loc = locManager.getLastKnownLocation(provider) ?: continue
                if (bestLoc == null || loc.accuracy < bestLoc.accuracy) {
                    bestLoc = loc
                }
            }
            bestLoc?.let {
                LocationData(
                    deviceId = preferenceManager.getDeviceId(),
                    latitude = it.latitude,
                    longitude = it.longitude,
                    accuracy = it.accuracy,
                    altitude = if (it.hasAltitude()) it.altitude else null,
                    speed = if (it.hasSpeed()) it.speed else null,
                    provider = it.provider,
                    timestamp = it.time
                )
            }
        } catch (_: Exception) {
            null
        }
    }
}
