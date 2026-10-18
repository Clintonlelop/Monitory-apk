package com.example.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Accessibility
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.PermMedia
import androidx.compose.material.icons.filled.QueryStats
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.example.DeviceManagerApp
import com.example.ui.viewmodel.MainViewModel
import com.example.ui.viewmodel.Screen

@Composable
fun PrivacyPermissionsScreen(
    viewModel: MainViewModel,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val permissions by viewModel.permissions.collectAsState()
    val scrollState = rememberScrollState()
    var showDisconnectDialog by remember { mutableStateOf(false) }
    var showDeviceOwnerDialog by remember { mutableStateOf(false) }

    fun permissionsHelper() = (context.applicationContext as DeviceManagerApp).repository.permissionsHelper

    // Single launcher used by every runtime-permission row (1..n permissions at once).
    val runtimePermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) {
        // Grant results (or denials) are reflected on the next status check.
        viewModel.refreshPermissions()
    }

    // Device-admin activation dialog (system UI) — refresh when the user returns.
    val deviceAdminLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) {
        viewModel.refreshPermissions()
    }

    LaunchedEffect(Unit) {
        viewModel.refreshPermissions()
    }

    // Returning from Settings should re-evaluate every row without any startup prompt.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                viewModel.refreshPermissions()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(20.dp)
    ) {
        // Back Header
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            IconButton(
                onClick = { viewModel.navigateTo(Screen.Dashboard) },
                modifier = Modifier.testTag("back_button")
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back to Dashboard"
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "DEVICE MANAGEMENT STATUS",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Transparency Banner Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f)
            )
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Security,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(22.dp)
                    )
                }
                Spacer(modifier = Modifier.width(14.dp))
                Column {
                    Text(
                        text = "Transparent Device Control",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = "This device is actively monitored by its authorized owner. Every item below can be tapped to grant or fix it in Android Settings. All actions require explicit Android system permission grants and remain fully visible.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        SectionHeader("Platform Permissions")

        PermissionCard {
            PermissionItem(
                icon = Icons.Default.MyLocation,
                name = "Location",
                isGranted = permissions.location,
                onClick = {
                    runtimePermissionLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )
                    )
                }
            )
            PermissionItem(
                icon = Icons.Default.Contacts,
                name = "Contacts",
                isGranted = permissions.contacts,
                onClick = {
                    runtimePermissionLauncher.launch(arrayOf(Manifest.permission.READ_CONTACTS))
                }
            )
            PermissionItem(
                icon = Icons.Default.Call,
                name = "Call log",
                isGranted = permissions.calls,
                onClick = {
                    runtimePermissionLauncher.launch(arrayOf(Manifest.permission.READ_CALL_LOG))
                }
            )
            PermissionItem(
                icon = Icons.Default.Sms,
                name = "SMS",
                isGranted = permissions.sms,
                onClick = {
                    runtimePermissionLauncher.launch(arrayOf(Manifest.permission.READ_SMS))
                }
            )
            PermissionItem(
                icon = Icons.Default.PermMedia,
                name = "Media read",
                isGranted = permissions.mediaRead,
                onClick = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        runtimePermissionLauncher.launch(
                            arrayOf(
                                Manifest.permission.READ_MEDIA_IMAGES,
                                Manifest.permission.READ_MEDIA_VIDEO,
                                Manifest.permission.READ_MEDIA_AUDIO
                            )
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        runtimePermissionLauncher.launch(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE))
                    }
                }
            )
            PermissionItem(
                icon = Icons.Default.CameraAlt,
                name = "Camera",
                isGranted = permissions.camera,
                onClick = {
                    runtimePermissionLauncher.launch(arrayOf(Manifest.permission.CAMERA))
                }
            )
            PermissionItem(
                icon = Icons.Default.Mic,
                name = "Microphone",
                isGranted = permissions.microphone,
                onClick = {
                    runtimePermissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
                }
            )
            PermissionItem(
                icon = Icons.Default.Notifications,
                name = "Notifications",
                isGranted = permissions.notificationAccess || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU,
                onClick = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        runtimePermissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                    } else {
                        permissionsHelper().openAppSettings()
                    }
                }
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        SectionHeader("Special Access (system Settings)")

        PermissionCard {
            PermissionItem(
                icon = Icons.Default.NotificationsActive,
                name = "Notification listener",
                isGranted = permissions.notificationAccess,
                onClick = { permissionsHelper().openNotificationAccessSettings() }
            )
            PermissionItem(
                icon = Icons.Default.QueryStats,
                name = "Usage access",
                isGranted = permissions.usageAccess,
                onClick = { permissionsHelper().openUsageAccessSettings() }
            )
            PermissionItem(
                icon = Icons.Default.FolderOpen,
                name = "All files access",
                isGranted = permissions.allFilesAccess,
                onClick = { permissionsHelper().openAllFilesAccessSettings() }
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        SectionHeader("Accessibility Service")

        PermissionCard {
            PermissionItem(
                icon = Icons.Default.Accessibility,
                name = "Accessibility service",
                isGranted = permissions.accessibility,
                onClick = { permissionsHelper().openAccessibilitySettings() }
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        SectionHeader("Device Policy")

        PermissionCard {
            PermissionItem(
                icon = Icons.Default.Security,
                name = "Device Admin",
                isGranted = permissions.deviceAdmin,
                onClick = {
                    try {
                        deviceAdminLauncher.launch(permissionsHelper().buildDeviceAdminIntent())
                    } catch (e: Exception) {
                        permissionsHelper().openAppSettings()
                    }
                }
            )
            PermissionItem(
                icon = Icons.Default.VerifiedUser,
                name = "Device Owner",
                isGranted = permissions.deviceOwner,
                onClick = { showDeviceOwnerDialog = true }
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Action Buttons
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                onClick = { viewModel.navigateTo(Screen.Storage) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag("storage_browser_button"),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Default.FolderOpen, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Open Storage & Files")
            }

            Button(
                onClick = {
                    val app = context.applicationContext as DeviceManagerApp
                    app.repository.permissionsHelper.openAppSettings()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag("manage_permissions_button"),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Default.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Manage Permissions")
            }

            OutlinedButton(
                onClick = {
                    val app = context.applicationContext as DeviceManagerApp
                    app.repository.permissionsHelper.openNotificationAccessSettings()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag("notification_settings_button"),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Default.NotificationsActive, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Notification Listener Settings")
            }

            OutlinedButton(
                onClick = {
                    val app = context.applicationContext as DeviceManagerApp
                    app.repository.permissionsHelper.openUsageAccessSettings()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag("usage_settings_button"),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Default.QueryStats, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Usage Access Settings")
            }

            Spacer(modifier = Modifier.height(8.dp))

            Button(
                onClick = { showDisconnectDialog = true },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag("disconnect_device_button"),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error
                ),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Default.Warning, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Disconnect Device")
            }
        }
    }

    if (showDeviceOwnerDialog) {
        AlertDialog(
            onDismissRequest = { showDeviceOwnerDialog = false },
            title = { Text("Device Owner") },
            text = {
                Text(
                    "Device Owner is a provisioning mode that can only be set while the device is being set up (via device owner provisioning or ADB by an administrator).\n\n" +
                        "It cannot be granted from a normal settings screen. If this device should be managed as Device Owner, ask its administrator to run the provisioning step; " +
                        "otherwise the regular Device Admin activation above is enough for remote policy features."
                )
            },
            confirmButton = {
                TextButton(onClick = { showDeviceOwnerDialog = false }) { Text("Got it") }
            }
        )
    }

    if (showDisconnectDialog) {
        AlertDialog(
            onDismissRequest = { showDisconnectDialog = false },
            title = { Text("Disconnect Device?") },
            text = {
                Text("This will revoke the pairing token, stop the background management service, and disconnect this device from your Web Admin Dashboard.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showDisconnectDialog = false
                        viewModel.disconnect()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Disconnect")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDisconnectDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onBackground
    )
    Spacer(modifier = Modifier.height(10.dp))
}

@Composable
private fun PermissionCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            content = content
        )
    }
}

/**
 * One tappable permission row. Tapping always triggers the corresponding grant
 * flow (runtime permission dialog or the right system Settings screen), so every
 * item can be fixed manually even if the startup prompts never appeared.
 */
@Composable
fun PermissionItem(
    icon: ImageVector,
    name: String,
    isGranted: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (isGranted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = name,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f)
        )
        // Status badge — single line, intrinsic width (name takes the leftover space)
        Box(
            modifier = Modifier
                .background(
                    if (isGranted) Color(0xFFDCFCE7) else Color(0xFFF1F5F9),
                    RoundedCornerShape(8.dp)
                )
                .padding(horizontal = 10.dp, vertical = 4.dp)
        ) {
            Text(
                text = if (isGranted) "GRANTED" else "NOT GRANTED",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                softWrap = false,
                color = if (isGranted) Color(0xFF166534) else Color(0xFF64748B)
            )
        }
        Spacer(modifier = Modifier.width(6.dp))
        Icon(
            imageVector = Icons.Default.ChevronRight,
            contentDescription = "Tap to grant",
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.size(18.dp)
        )
    }
}
