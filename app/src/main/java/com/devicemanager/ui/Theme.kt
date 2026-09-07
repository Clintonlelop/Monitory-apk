package com.devicemanager.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val LightPrimary = Color(0xFF1565C0)
val LightSecondary = Color(0xFFFF6F00)
val LightBackground = Color(0xFFFAFAFA)
val LightSurface = Color(0xFFFFFFFF)

val DarkPrimary = Color(0xFF42A5F5)
val DarkSecondary = Color(0xFFFFA000)
val DarkBackground = Color(0xFF121212)
val DarkSurface = Color(0xFF1E1E1E)

@Composable
fun DeviceManagerTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) {
        darkColorScheme(
            primary = DarkPrimary,
            secondary = DarkSecondary,
            background = DarkBackground,
            surface = DarkSurface,
            onPrimary = Color.Black,
            onBackground = Color.White,
            onSurface = Color.White,
            surfaceVariant = Color(0xFF2D2D2D),
            onSurfaceVariant = Color(0xFFCCCCCC)
        )
    } else {
        lightColorScheme(
            primary = LightPrimary,
            secondary = LightSecondary,
            background = LightBackground,
            surface = LightSurface,
            onPrimary = Color.White,
            onBackground = Color(0xFF212121),
            onSurface = Color(0xFF212121),
            surfaceVariant = Color(0xFFECEFF1),
            onSurfaceVariant = Color(0xFF455A64)
        )
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
