package com.example.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.NavigateNext
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.QueryStats
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.ui.viewmodel.MainViewModel

@Composable
fun ActivationScreen(
    viewModel: MainViewModel,
    onRequestLocationPermissions: () -> Unit,
    onRequestMediaPermissions: () -> Unit,
    onRequestCameraAudioPermissions: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    onOpenUsageAccessSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val permissions by viewModel.permissions.collectAsState()
    val deviceName by viewModel.deviceName.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var stepIndex by remember { mutableIntStateOf(0) }

    val steps = listOf(
        SetupStep(
            title = "Connect your device",
            description = "You're signed in. Complete a quick setup to enable secure remote monitoring.",
            icon = Icons.Default.Shield,
            required = true,
            isComplete = { true },
            actionLabel = null,
            onAction = null
        ),
        SetupStep(
            title = "Choose device name",
            description = "Set a friendly name shown in your dashboard and command center.",
            icon = Icons.Default.Smartphone,
            required = true,
            isComplete = { deviceName.trim().isNotEmpty() },
            actionLabel = null,
            onAction = null
        ),
        SetupStep(
            title = "Location access",
            description = "Needed for current location, history timeline, and map updates.",
            icon = Icons.Default.LocationOn,
            required = true,
            isComplete = { permissions.location },
            actionLabel = "Grant location",
            onAction = onRequestLocationPermissions
        ),
        SetupStep(
            title = "Notification access",
            description = "Needed for real notification stream from apps through Android Notification Access.",
            icon = Icons.Default.Notifications,
            required = true,
            isComplete = { permissions.notificationAccess },
            actionLabel = "Open notification access",
            onAction = onOpenNotificationSettings
        ),
        SetupStep(
            title = "Files & media access",
            description = "Enables browsing and synchronizing permitted media/files from your device.",
            icon = Icons.Default.Folder,
            required = false,
            isComplete = { permissions.filesAccess },
            actionLabel = "Grant files/media",
            onAction = onRequestMediaPermissions
        ),
        SetupStep(
            title = "Usage access",
            description = "Lets you view app usage statistics and top-used apps in dashboard analytics.",
            icon = Icons.Default.QueryStats,
            required = false,
            isComplete = { permissions.usageAccess },
            actionLabel = "Open usage access",
            onAction = onOpenUsageAccessSettings
        ),
        SetupStep(
            title = "Camera & screen-sharing (optional)",
            description = "Camera/microphone are optional and only used with explicit user-approved actions.",
            icon = Icons.Default.CameraAlt,
            required = false,
            isComplete = { permissions.camera && permissions.microphone },
            actionLabel = "Grant camera + microphone",
            onAction = onRequestCameraAudioPermissions
        )
    )

    val currentStep = steps[stepIndex]
    val progress by animateFloatAsState((stepIndex + 1f) / steps.size, label = "setup-progress")
    val isLoading = uiState is MainViewModel.UiState.Loading
    val canMoveNext = currentStep.isComplete() || !currentStep.required

    LaunchedEffect(uiState) {
        when (val state = uiState) {
            is MainViewModel.UiState.Error -> {
                snackbarHostState.showSnackbar(state.message)
                viewModel.clearUiState()
            }

            is MainViewModel.UiState.Success -> {
                snackbarHostState.showSnackbar(state.message)
                viewModel.clearUiState()
            }

            else -> Unit
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
        modifier = modifier.fillMaxSize()
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(62.dp)
                    .background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = currentStep.icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(32.dp)
                )
            }

            Spacer(modifier = Modifier.height(12.dp))
            Text("Setup wizard", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Text(
                "${stepIndex + 1} / ${steps.size}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
            )

            Spacer(modifier = Modifier.height(16.dp))
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    AnimatedContent(targetState = currentStep.title, label = "setup-title") { title ->
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    AnimatedContent(targetState = currentStep.description, label = "setup-desc") { description ->
                        Text(
                            text = description,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    if (stepIndex == 1) {
                        Spacer(modifier = Modifier.height(14.dp))
                        OutlinedTextField(
                            value = deviceName,
                            onValueChange = viewModel::setDeviceName,
                            label = { Text("Device name") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true
                        )
                    }

                    currentStep.actionLabel?.let { label ->
                        Spacer(modifier = Modifier.height(14.dp))
                        Button(
                            onClick = currentStep.onAction ?: {},
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(label)
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = if (currentStep.isComplete()) Icons.Default.CheckCircle else currentStep.icon,
                            contentDescription = null,
                            tint = if (currentStep.isComplete()) Color(0xFF16A34A) else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.size(8.dp))
                        Text(
                            text = if (currentStep.isComplete()) "Completed" else if (currentStep.required) "Required to continue" else "Optional",
                            color = if (currentStep.isComplete()) Color(0xFF16A34A) else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedButton(
                    onClick = { if (stepIndex > 0) stepIndex -= 1 },
                    enabled = stepIndex > 0,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Back")
                }
                if (!currentStep.required && !currentStep.isComplete()) {
                    OutlinedButton(
                        onClick = { if (stepIndex < steps.lastIndex) stepIndex += 1 },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Skip for now")
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            Button(
                onClick = {
                    if (stepIndex < steps.lastIndex) {
                        stepIndex += 1
                    } else {
                        viewModel.activateDevice()
                    }
                },
                enabled = !isLoading && canMoveNext,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
            ) {
                Text(
                    text = if (stepIndex == steps.lastIndex) "Finish setup & activate" else "Next step",
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.size(6.dp))
                Icon(Icons.Default.NavigateNext, contentDescription = null)
            }
        }
    }
}

private data class SetupStep(
    val title: String,
    val description: String,
    val icon: ImageVector,
    val required: Boolean,
    val isComplete: () -> Boolean,
    val actionLabel: String?,
    val onAction: (() -> Unit)?
)

