package com.example

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.example.ui.screens.AuthScreen
import com.example.ui.screens.DashboardScreen
import com.example.ui.screens.OnboardingScreen
import com.example.ui.screens.PrivacyPermissionsScreen
import com.example.ui.screens.SetupWizardScreen
import com.example.ui.screens.StorageBrowserScreen
import com.example.ui.theme.MyApplicationTheme
import com.example.ui.viewmodel.MainViewModel
import com.example.ui.viewmodel.Screen

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        handleIntent(intent)

        setContent {
            MyApplicationTheme {
                val snackbarHostState = remember { SnackbarHostState() }
                val currentScreen by viewModel.currentScreen.collectAsState()
                val uiState by viewModel.uiState.collectAsState()

                // Permission launcher for standard runtime permissions
                val permissionLauncher = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.RequestMultiplePermissions()
                ) {
                    viewModel.refreshPermissions()
                }

                fun launchPermissionsRequest() {
                    val requested = mutableListOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                        Manifest.permission.RECORD_AUDIO,
                        Manifest.permission.CAMERA,
                        Manifest.permission.READ_CONTACTS
                    )
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        requested.add(Manifest.permission.POST_NOTIFICATIONS)
                        requested.add(Manifest.permission.READ_MEDIA_IMAGES)
                        requested.add(Manifest.permission.READ_MEDIA_VIDEO)
                        requested.add(Manifest.permission.READ_MEDIA_AUDIO)
                    } else {
                        requested.add(Manifest.permission.READ_EXTERNAL_STORAGE)
                    }
                    permissionLauncher.launch(requested.toTypedArray())
                }

                fun openStorageBrowser() {
                    viewModel.navigateTo(Screen.StorageBrowser)
                }

                LaunchedEffect(uiState) {
                    when (uiState) {
                        is MainViewModel.UiState.Error -> {
                            snackbarHostState.showSnackbar((uiState as MainViewModel.UiState.Error).message)
                            viewModel.clearUiState()
                        }
                        is MainViewModel.UiState.Success -> {
                            snackbarHostState.showSnackbar((uiState as MainViewModel.UiState.Success).message)
                            viewModel.clearUiState()
                        }
                        else -> {}
                    }
                }

                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    snackbarHost = { SnackbarHost(snackbarHostState) }
                ) { innerPadding ->
                    Crossfade(
                        targetState = currentScreen,
                        modifier = Modifier.padding(innerPadding),
                        label = "ScreenTransition"
                    ) { screen ->
                        when (screen) {
                            is Screen.Onboarding -> OnboardingScreen(viewModel = viewModel)
                            is Screen.Auth -> AuthScreen(viewModel = viewModel)
                            is Screen.SetupWizard -> SetupWizardScreen(
                                viewModel = viewModel,
                                onRequestPermissions = { launchPermissionsRequest() },
                                onRequestStorageAccess = { openStorageBrowser() }
                            )
                            is Screen.Dashboard -> DashboardScreen(viewModel = viewModel)
                            is Screen.Privacy -> PrivacyPermissionsScreen(viewModel = viewModel)
                            is Screen.StorageBrowser -> StorageBrowserScreen(viewModel = viewModel)
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Settings-based grants (notification, usage, accessibility, storage) can change
        // while this Activity is paused. Refresh when the user returns from Settings.
        viewModel.refreshPermissions()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val navigateTo = intent?.getStringExtra("navigate_to")
        if (navigateTo == "permissions") {
            viewModel.navigateTo(Screen.Privacy)
        }
    }
}
