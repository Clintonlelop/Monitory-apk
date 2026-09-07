package com.devicemanager.ui

import android.content.Intent
import android.os.Bundle
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
import androidx.lifecycle.LiveData
import androidx.lifecycle.Observer
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelProvider
import com.devicemanager.DeviceManagerApp
import com.devicemanager.data.local.entity.PendingCommand
import com.devicemanager.ui.viewmodel.MainViewModel
import com.devicemanager.util.Extensions

@Composable
fun <T> LiveData<T>.observeAsState(initial: T): State<T> {
    val state = remember { mutableStateOf(initial) }
    DisposableEffect(this) {
        val observer = Observer<T> { value ->
            if (value != null) {
                state.value = value
            }
        }
        observeForever(observer)
        onDispose {
            removeObserver(observer)
        }
    }
    return state
}

class MainActivity : ComponentActivity() {

    private lateinit var viewModel: MainViewModel
    private lateinit var app: DeviceManagerApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as DeviceManagerApp
        viewModel = ViewModelProvider(this)[MainViewModel::class.java]

        // Set highest available refresh rate (e.g. 120Hz / 120 FPS)
        Extensions.setHighestRefreshRate(window)

        setContent {
            DeviceManagerTheme {
                MainDashboardScreen()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.refreshTelemetry()
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    fun MainDashboardScreen() {
        val context = LocalContext.current
        
        // Observe ViewModel states
        val deviceName by viewModel.deviceName.observeAsState("My Terminal")
        val deviceModel by viewModel.deviceModel.observeAsState(android.os.Build.MODEL)
        val androidVersion by viewModel.androidVersion.observeAsState("Android Version")
        val isOnline by viewModel.isOnline.observeAsState(false)
        val lastSyncTime by viewModel.lastSyncTime.observeAsState(0L)
        val batteryLevel by viewModel.batteryLevel.observeAsState(100)
        val isCharging by viewModel.isCharging.observeAsState(false)
        val networkType by viewModel.networkType.observeAsState("Unknown")
        val recentCommands by viewModel.recentCommands.observeAsState(emptyList())
        val isLoading by viewModel.isLoading.observeAsState(false)

        val batteryTemp by viewModel.batteryTemp.observeAsState(0f)
        val wifiSsid by viewModel.wifiSsid.observeAsState(null as String?)
        val storageTotal by viewModel.storageTotal.observeAsState(0L)
        val storageUsed by viewModel.storageUsed.observeAsState(0L)
        val ramTotal by viewModel.ramTotal.observeAsState(0L)
        val ramUsed by viewModel.ramUsed.observeAsState(0L)
        val hardwareCpu by viewModel.hardwareCpu.observeAsState(android.os.Build.HARDWARE)
        val cpuAbis by viewModel.cpuAbis.observeAsState("unknown")
        val manufacturer by viewModel.manufacturer.observeAsState(android.os.Build.MANUFACTURER)
        val brand by viewModel.brand.observeAsState(android.os.Build.BRAND)
        val displayResolution by viewModel.displayResolution.observeAsState("1080x2400")

        Scaffold(
            topBar = {
                LargeTopAppBar(
                    title = {
                        Column {
                            Text(
                                text = "Device Manager Agent",
                                fontWeight = FontWeight.Bold,
                                fontSize = 24.sp
                            )
                            Text(
                                text = "Terminal Monitoring Console",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    },
                    actions = {
                        IconButton(onClick = { viewModel.syncNow() }) {
                            if (isLoading) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.Sync, contentDescription = "Sync records")
                            }
                        }
                    },
                    colors = TopAppBarDefaults.largeTopAppBarColors(
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
                verticalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = PaddingValues(bottom = 24.dp)
            ) {
                // Connection Status Orb Pill
                item {
                    ConnectionStatusPill(isOnline = isOnline)
                }

                // Screen Refresh Rate & Smoothness Pill
                item {
                    val refreshRate = Extensions.getCurrentRefreshRate(context)
                    val fpsText = if (refreshRate > 90f) "120 FPS Flawless Mode Active" else if (refreshRate > 60f) "90 FPS Ultra Smooth Mode Active" else "60 FPS Standard Mode Active"
                    val hzColor = if (refreshRate > 60f) Color(0xFF00E676) else MaterialTheme.colorScheme.primary
                    
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = hzColor.copy(alpha = 0.08f)
                        ),
                        border = BorderStroke(1.dp, hzColor.copy(alpha = 0.2f))
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Bolt,
                                contentDescription = "Refresh Rate",
                                tint = hzColor,
                                modifier = Modifier.size(20.dp)
                            )
                            Column {
                                Text(
                                    text = "Screen Refresh Rate: ${refreshRate.toInt()} Hz (${refreshRate.toInt()} FPS)",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = hzColor
                                )
                                Text(
                                    text = fpsText,
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }

                // Grid stats
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        // Battery Card
                        TelemetryCard(
                            title = "Power Status",
                            value = "$batteryLevel%",
                            subtitle = if (isCharging) "Charging" else "On Battery",
                            icon = if (isCharging) Icons.Default.BatteryChargingFull else Icons.Default.BatteryFull,
                            iconColor = if (isCharging) Color(0xFF2E7D32) else MaterialTheme.colorScheme.primary,
                            modifier = Modifier.weight(1f)
                        )

                        // Network Card
                        TelemetryCard(
                            title = "Network Standard",
                            value = networkType,
                            subtitle = "Active Connection",
                            icon = when {
                                networkType.contains("Wifi", ignoreCase = true) -> Icons.Default.Wifi
                                networkType.contains("Cellular", ignoreCase = true) -> Icons.Default.SignalCellularAlt
                                else -> Icons.Default.SignalCellularConnectedNoInternet0Bar
                            },
                            iconColor = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                // Device Specs & System Specifications Dashboard
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surface
                        ),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            // Identification Section Header
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(
                                        text = deviceName,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 18.sp
                                    )
                                    Text(
                                        text = "$brand $deviceModel",
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                }
                                Box(
                                    modifier = Modifier
                                        .size(40.dp)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.PhoneAndroid,
                                        contentDescription = "Device info",
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                }
                            }

                            Divider(modifier = Modifier.padding(vertical = 12.dp))

                            // Grid specs
                            Column(
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                // OS & Hardware Manufacturer
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("OS Version", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(androidVersion, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("Manufacturer", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(manufacturer, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("Processor (CPU)", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(hardwareCpu, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("Architecture", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(cpuAbis, fontSize = 11.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                                }
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("Screen Resolution", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(displayResolution, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                                if (wifiSsid != null) {
                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("WiFi Network SSID", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Text(wifiSsid!!, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("Battery Temp", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text("${batteryTemp}°C", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                            }

                            Divider(modifier = Modifier.padding(vertical = 12.dp))

                            // Progress bars for RAM and Storage
                            Column(
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                // RAM Indicator
                                val ramFraction = if (ramTotal > 0) ramUsed.toFloat() / ramTotal.toFloat() else 0f
                                Column {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.DeveloperMode,
                                                contentDescription = "RAM",
                                                modifier = Modifier.size(14.dp),
                                                tint = MaterialTheme.colorScheme.primary
                                            )
                                            Text("RAM Memory Usage", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                        }
                                        Text(
                                            text = "${Extensions.formatBytes(ramUsed)} / ${Extensions.formatBytes(ramTotal)}",
                                            fontSize = 11.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(4.dp))
                                    LinearProgressIndicator(
                                        progress = ramFraction,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(6.dp)
                                            .clip(RoundedCornerShape(3.dp)),
                                        color = MaterialTheme.colorScheme.primary,
                                        trackColor = MaterialTheme.colorScheme.surfaceVariant
                                    )
                                }

                                // Storage Indicator
                                val storageFraction = if (storageTotal > 0) storageUsed.toFloat() / storageTotal.toFloat() else 0f
                                Column {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.SdCard,
                                                contentDescription = "Storage",
                                                modifier = Modifier.size(14.dp),
                                                tint = MaterialTheme.colorScheme.secondary
                                            )
                                            Text("Internal Device Storage", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                        }
                                        Text(
                                            text = "${Extensions.formatBytes(storageUsed)} / ${Extensions.formatBytes(storageTotal)}",
                                            fontSize = 11.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(4.dp))
                                    LinearProgressIndicator(
                                        progress = storageFraction,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(6.dp)
                                            .clip(RoundedCornerShape(3.dp)),
                                        color = MaterialTheme.colorScheme.secondary,
                                        trackColor = MaterialTheme.colorScheme.surfaceVariant
                                    )
                                }
                            }

                            Divider(modifier = Modifier.padding(vertical = 12.dp))

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.History,
                                        contentDescription = "Last sync",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Text(
                                        text = "Last synced telemetry:",
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                Text(
                                    text = if (lastSyncTime > 0) Extensions.formatTimestamp(lastSyncTime) else "Never",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                            }
                        }
                    }
                }

                // Quick Navigation Actions
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Button(
                            onClick = {
                                context.startActivity(Intent(context, PermissionsActivity::class.java))
                            },
                            modifier = Modifier
                                .weight(1f)
                                .height(50.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary
                            )
                        ) {
                            Icon(Icons.Default.Security, contentDescription = "Manage Permissions")
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Permissions", fontWeight = FontWeight.Bold)
                        }

                        OutlinedButton(
                            onClick = { viewModel.syncNow() },
                            modifier = Modifier
                                .weight(1f)
                                .height(50.dp),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = "Sync Now")
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Sync Terminal")
                        }
                    }
                }

                // Recent Console Commands
                item {
                    Text(
                        text = "Recent Cloud Commands Logs",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }

                if (recentCommands.isEmpty()) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(120.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .border(1.dp, MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    imageVector = Icons.Default.Inbox,
                                    contentDescription = "Empty log",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                                    modifier = Modifier.size(32.dp)
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "No command history received yet",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                } else {
                    items(recentCommands, key = { it.commandId }) { command ->
                        CommandLogItem(command = command)
                    }
                }
            }
        }
    }

    @Composable
    fun ConnectionStatusPill(isOnline: Boolean) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(
                    if (isOnline) Color(0xFFE8F5E9) else Color(0xFFFFEBEE)
                )
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(if (isOnline) Color(0xFF2E7D32) else Color(0xFFC62828))
                )
                Text(
                    text = if (isOnline) "WebSocket Connected" else "Cloud Offline",
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    color = if (isOnline) Color(0xFF1B5E20) else Color(0xFFB71C1C)
                )
            }
            Text(
                text = if (isOnline) "Active" else "Standby",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = if (isOnline) Color(0xFF2E7D32) else Color(0xFFC62828)
            )
        }
    }

    @Composable
    fun TelemetryCard(
        title: String,
        value: String,
        subtitle: String,
        icon: androidx.compose.ui.graphics.vector.ImageVector,
        iconColor: Color,
        modifier: Modifier = Modifier
    ) {
        Card(
            modifier = modifier,
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface
            ),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = title,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = iconColor,
                        modifier = Modifier.size(18.dp)
                    )
                }

                Text(
                    text = value,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )

                Text(
                    text = subtitle,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }

    @Composable
    fun CommandLogItem(command: PendingCommand) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface
            ),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = command.type,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.primary
                    )

                    // Status badge
                    val badgeColor = when (command.status.uppercase()) {
                        "COMPLETED" -> Color(0xFFE8F5E9)
                        "FAILED" -> Color(0xFFFFEBEE)
                        "EXECUTING" -> Color(0xFFFFF3E0)
                        else -> Color(0xFFECEFF1)
                    }
                    val badgeTextColor = when (command.status.uppercase()) {
                        "COMPLETED" -> Color(0xFF2E7D32)
                        "FAILED" -> Color(0xFFC62828)
                        "EXECUTING" -> Color(0xFFEF6C00)
                        else -> Color(0xFF546E7A)
                    }

                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(badgeColor)
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = command.status,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = badgeTextColor
                        )
                    }
                }

                Text(
                    text = "ID: ${command.commandId.take(8)}...",
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace
                )
            }
        }
    }
}
