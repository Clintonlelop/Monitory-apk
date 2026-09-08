package com.devicemanager.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import com.devicemanager.DeviceManagerApp
import com.devicemanager.R
import com.devicemanager.databinding.ActivityPermissionsBinding
import com.devicemanager.manager.PermissionManager
import com.devicemanager.ui.adapter.PermissionAdapter
import com.devicemanager.util.Constants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Permissions activity showing all permission statuses.
 *
 * - RecyclerView of all permissions with status icons
 * - Each item: permission name, status (colored), description, "Grant" button
 * - Special handling for usage access, notification access, screen capture
 * - Opens appropriate settings for special permissions
 */
class PermissionsActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPermissionsBinding
    private lateinit var app: DeviceManagerApp
    private lateinit var permissionManager: PermissionManager
    private lateinit var adapter: PermissionAdapter

    private val permissionRequestCode = 1001

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPermissionsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        app = application as DeviceManagerApp
        permissionManager = app.permissionManager

        setupRecyclerView()
        loadPermissions()
    }

    private fun setupRecyclerView() {
        adapter = PermissionAdapter { permission ->
            handleGrantClick(permission)
        }
        binding.permissionsRecycler.layoutManager = LinearLayoutManager(this)
        binding.permissionsRecycler.adapter = adapter
    }

    private fun loadPermissions() {
        val permissions = permissionManager.getAllPermissions()
        adapter.submitList(permissions)
    }

    /**
     * Handle "Grant" button click for a permission.
     */
    private fun handleGrantClick(permission: PermissionManager.PermissionInfo) {
        when (permission.key) {
            Constants.PERM_USAGE_ACCESS -> {
                startActivity(permissionManager.getUsageAccessIntent())
            }
            Constants.PERM_NOTIFICATION_ACCESS -> {
                startActivity(permissionManager.getNotificationAccessIntent())
            }
            Constants.PERM_SCREEN_CAPTURE -> {
                Toast.makeText(
                    this,
                    "Screen capture requires user approval via MediaProjection consent dialog. It will be requested when a screen recording command is received.",
                    Toast.LENGTH_LONG
                ).show()
            }
            else -> {
                requestDangerousPermission(permission.key)
            }
        }
    }

    /**
     * Request a dangerous runtime permission.
     */
    private fun requestDangerousPermission(permissionKey: String) {
        val manifestPermission = when (permissionKey) {
            Constants.PERM_LOCATION -> Manifest.permission.ACCESS_FINE_LOCATION
            Constants.PERM_CAMERA -> Manifest.permission.CAMERA
            Constants.PERM_MICROPHONE -> Manifest.permission.RECORD_AUDIO
            Constants.PERM_NOTIFICATIONS -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    Manifest.permission.POST_NOTIFICATIONS
                } else {
                    null
                }
            }
            Constants.PERM_CONTACTS -> Manifest.permission.READ_CONTACTS
            Constants.PERM_CALL_LOG -> Manifest.permission.READ_CALL_LOG
            Constants.PERM_SMS -> Manifest.permission.READ_SMS
            Constants.PERM_STORAGE -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                    Manifest.permission.READ_EXTERNAL_STORAGE
                } else {
                    null
                }
            }
            else -> null
        }

        if (manifestPermission == null) {
            Toast.makeText(this, "This permission is managed automatically on this Android version.", Toast.LENGTH_SHORT).show()
            return
        }

        if (ContextCompat.checkSelfPermission(this, manifestPermission)
            == PackageManager.PERMISSION_GRANTED
        ) {
            Toast.makeText(this, "Permission already granted", Toast.LENGTH_SHORT).show()
            loadPermissions()
            return
        }

        ActivityCompat.requestPermissions(
            this,
            arrayOf(manifestPermission),
            permissionRequestCode
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == permissionRequestCode) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Permission granted", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "Permission denied. You can grant it later in Settings.", Toast.LENGTH_SHORT).show()
            }
            loadPermissions()
            syncPermissionStatus()
        }
    }

    /**
     * Sync permission status to server after changes.
     */
    private fun syncPermissionStatus() {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val deviceId = app.preferences.deviceId
                if (deviceId.isNotBlank()) {
                    val entries = permissionManager.getPermissionEntries()
                    app.deviceRepository.updatePermissions(deviceId, entries)
                }
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    override fun onResume() {
        super.onResume()
        loadPermissions()
    }
}
