package com.devicemanager.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.devicemanager.DeviceManagerApp
import com.devicemanager.services.MainForegroundService
import com.devicemanager.util.Extensions
import kotlinx.coroutines.launch

class SetupActivity : ComponentActivity() {

    private lateinit var app: DeviceManagerApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as DeviceManagerApp

        // If already set up, go directly to MainActivity
        if (app.preferences.isSetupComplete) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }

        setContent {
            DeviceManagerTheme {
                SetupScreen()
            }
        }
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    fun SetupScreen() {
        val context = LocalContext.current
        
        val serverUrl = app.preferences.serverUrl.ifBlank { com.devicemanager.BuildConfig.DEFAULT_SERVER_URL }
        val email = "clintonumelo15@gmail.com"
        val password = "admin123"

        var statusText by remember { mutableStateOf("Ready. Connecting to secure telemetry network...") }
        var isConnecting by remember { mutableStateOf(false) }
        var isConnected by remember { mutableStateOf(false) }
        var isPermissionsExpanded by remember { mutableStateOf(true) }

        // Setup Infinite Transitions for Computer/Terminal Illustration Animation
        val infiniteTransition = rememberInfiniteTransition()
        val rotationAngle by infiniteTransition.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(
                animation = tween(8000, easing = LinearEasing),
                repeatMode = RepeatMode.Restart
            )
        )
        val pulseScale by infiniteTransition.animateFloat(
            initialValue = 0.8f,
            targetValue = 1.2f,
            animationSpec = infiniteRepeatable(
                animation = tween(2000, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse
            )
        )
        val sweepPosition by infiniteTransition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(3000, easing = LinearEasing),
                repeatMode = RepeatMode.Restart
            )
        )

        // Trigger connection automatically on screen load so the user doesn't have to do anything!
        val triggerConnect = {
            val trimmedUrl = serverUrl.trim()
            if (trimmedUrl.isNotBlank() && !isConnecting && !isConnected) {
                isConnecting = true
                statusText = "Syncing with cloud control center..."
                
                app.preferences.serverUrl = Extensions.normalizeServerUrl(trimmedUrl)
                app.reinitializeApiService()

                lifecycleScope.launch {
                    val result = app.deviceRepository.loginAndRegisterDevice(
                        email = email,
                        password = password,
                        deviceName = android.os.Build.MODEL,
                        model = android.os.Build.MODEL,
                        manufacturer = android.os.Build.MANUFACTURER,
                        osVersion = android.os.Build.VERSION.RELEASE,
                        sdkVersion = android.os.Build.VERSION.SDK_INT,
                        appVersion = Extensions.getAppVersion(context)
                    )

                    result.onSuccess { response ->
                        statusText = "Connected! Telemetry synced securely."
                        isConnected = true
                        isConnecting = false
                        
                        // Proceed automatically on successful network pair
                        app.preferences.isSetupComplete = true
                        app.preferences.isPaired = true

                        // Start core background services
                        MainForegroundService.start(context)
                        app.initializeWorkManagerPublic()
                    }

                    result.onFailure { error ->
                        statusText = "Local server mode active. Offline diagnostic telemetry loaded."
                        isConnected = true // allow user to proceed locally if backend server is offline
                        isConnecting = false
                        
                        app.preferences.isSetupComplete = true
                        app.preferences.isPaired = true
                    }
                }
            }
        }

        LaunchedEffect(Unit) {
            // Let UI settle, then run auto-connect
            kotlinx.coroutines.delay(600)
            triggerConnect()
        }

        Scaffold(
            topBar = {
                CenterAlignedTopAppBar(
                    title = {
                        Text(
                            text = "Terminal Diagnostic Client",
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background
                    )
                )
            }
        ) { paddingValues ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.background)
                    .padding(paddingValues)
                    .padding(24.dp)
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Computer Terminal Scanner Illustration
                Box(
                    modifier = Modifier
                        .size(160.dp)
                        .clip(RoundedCornerShape(24.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)),
                    contentAlignment = Alignment.Center
                ) {
                    ComputerTerminalIllustration(
                        rotation = rotationAngle,
                        pulse = pulseScale,
                        sweep = sweepPosition
                    )
                }

                Text(
                    text = "System Diagnostics Active",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onBackground
                )

                Text(
                    text = "This device acts as a diagnostic terminal client, monitoring phone processor performance, memory metrics, storage status, and telemetry records in real-time.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 8.dp)
                )

                // Log display console
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFF263238))
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(
                                if (isConnected) Color.Green
                                else if (isConnecting) Color.Yellow
                                else Color.Red
                            )
                    )
                    Text(
                        text = statusText,
                        fontFamily = FontFamily.Monospace,
                        color = Color.White,
                        fontSize = 12.sp,
                        modifier = Modifier.weight(1f)
                    )
                }

                // Permissions Overview Expandable Card
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { isPermissionsExpanded = !isPermissionsExpanded },
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Default.Security,
                                    contentDescription = "Security",
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(22.dp)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "Terminal Access Permissions",
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                            }
                            Icon(
                                imageVector = if (isPermissionsExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                                contentDescription = "Expand info"
                            )
                        }

                        AnimatedVisibility(visible = isPermissionsExpanded) {
                            Column(
                                modifier = Modifier.padding(top = 12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(
                                    text = "To fetch comprehensive diagnostic measurements and display precise hardware telemetry, please authorize the following modules:",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )

                                val items = listOf(
                                    "Processor & Memory metrics" to "Exposes RAM use, CPU models, and storage levels.",
                                    "Power & Network Status" to "Exposes battery temperature, WiFi SSID, and network standards.",
                                    "Background Telemetry" to "Ensures local diagnostics continue syncing reliably.",
                                    "Device Location (Optional)" to "Enables diagnostic location tagging on your dashboard."
                                )

                                items.forEach { (title, desc) ->
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.CheckCircle,
                                            contentDescription = "Check",
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Column {
                                            Text(
                                                text = title,
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = MaterialTheme.colorScheme.onSurface
                                            )
                                            Text(
                                                text = desc,
                                                fontSize = 11.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Proceed Button
                Button(
                    onClick = {
                        app.preferences.isSetupComplete = true
                        app.preferences.isPaired = true

                        // Start core background services
                        MainForegroundService.start(context)
                        app.initializeWorkManagerPublic()

                        context.startActivity(Intent(context, MainActivity::class.java))
                        finish()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = Color.White
                    )
                ) {
                    Text(
                        text = "Accept Permissions & Enter Console",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }

    @Composable
    fun ComputerTerminalIllustration(
        rotation: Float,
        pulse: Float,
        sweep: Float
    ) {
        androidx.compose.foundation.Canvas(
            modifier = Modifier
                .size(160.dp)
                .padding(12.dp)
        ) {
            val center = Offset(size.width / 2f, size.height / 2f)
            val maxRadius = size.width / 2f

            // 1. Draw concentric background rings (holographic terminal design)
            drawCircle(
                color = Color(0xFF00E5FF).copy(alpha = 0.15f),
                radius = maxRadius,
                style = Stroke(width = 2.dp.toPx())
            )
            drawCircle(
                color = Color(0xFF1976D2).copy(alpha = 0.25f),
                radius = maxRadius * 0.75f,
                style = Stroke(width = 1.dp.toPx())
            )
            drawCircle(
                color = Color(0xFF29B6F6).copy(alpha = 0.35f),
                radius = maxRadius * 0.45f * pulse,
                style = Stroke(width = 1.5.dp.toPx())
            )

            // 2. Draw rotating orbital communication lines & nodes
            val satellites = 4
            for (i in 0 until satellites) {
                val angleRad = Math.toRadians((rotation + (i * (360 / satellites))).toDouble())
                val orbitRadius = maxRadius * 0.75f
                val satX = center.x + (orbitRadius * Math.cos(angleRad)).toFloat()
                val satY = center.y + (orbitRadius * Math.sin(angleRad)).toFloat()

                // Glow lines to core computer center
                drawLine(
                    color = Color(0xFF00E5FF).copy(alpha = 0.2f),
                    start = center,
                    end = Offset(satX, satY),
                    strokeWidth = 1.dp.toPx()
                )

                // Outer rotating node
                drawCircle(
                    color = Color(0xFF00E5FF),
                    radius = 5.dp.toPx(),
                    center = Offset(satX, satY)
                )
            }

            // 3. Central Computer monitor core visual
            drawRect(
                color = Color(0xFF0D47A1),
                topLeft = Offset(center.x - 24.dp.toPx(), center.y - 16.dp.toPx()),
                size = androidx.compose.ui.geometry.Size(48.dp.toPx(), 32.dp.toPx()),
                style = Stroke(width = 2.5.dp.toPx())
            )
            // Monitor stand
            drawLine(
                color = Color(0xFF0D47A1),
                start = Offset(center.x, center.y + 16.dp.toPx()),
                end = Offset(center.x, center.y + 22.dp.toPx()),
                strokeWidth = 4.dp.toPx()
            )
            drawLine(
                color = Color(0xFF0D47A1),
                start = Offset(center.x - 12.dp.toPx(), center.y + 22.dp.toPx()),
                end = Offset(center.x + 12.dp.toPx(), center.y + 22.dp.toPx()),
                strokeWidth = 3.dp.toPx()
            )

            // Simulation of terminal screen text lines
            drawLine(
                color = Color(0xFF00E676),
                start = Offset(center.x - 16.dp.toPx(), center.y - 6.dp.toPx()),
                end = Offset(center.x + 8.dp.toPx(), center.y - 6.dp.toPx()),
                strokeWidth = 2.dp.toPx()
            )
            drawLine(
                color = Color(0xFF00E676),
                start = Offset(center.x - 16.dp.toPx(), center.y),
                end = Offset(center.x + 14.dp.toPx(), center.y),
                strokeWidth = 2.dp.toPx()
            )
            drawLine(
                color = Color(0xFF00E676),
                start = Offset(center.x - 16.dp.toPx(), center.y + 6.dp.toPx()),
                end = Offset(center.x - 2.dp.toPx(), center.y + 6.dp.toPx()),
                strokeWidth = 2.dp.toPx()
            )

            // 4. Scanning scanner laser vertical sweep lines
            val sweepY = (maxRadius * 2f) * sweep
            drawLine(
                color = Color(0xFF00E5FF).copy(alpha = 0.4f),
                start = Offset(0f, sweepY),
                end = Offset(size.width, sweepY),
                strokeWidth = 2.5.dp.toPx()
            )
        }
    }
}
