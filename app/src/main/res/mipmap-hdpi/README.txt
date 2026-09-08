# Mipmap-hdpi Placeholder

This directory is a placeholder for launcher icon resources.

To generate proper launcher icons:
1. Use Android Studio's Image Asset Studio (Right-click res → New → Image Asset)
2. Or generate icons at: https://developer.android.com/studio/write/image-asset-studio
3. Place ic_launcher.png and ic_launcher_round.png in each density bucket:
   - mipmap-mdpi (48x48)
   - mipmap-hdpi (72x72)
   - mipmap-xhdpi (96x96)
   - mipmap-xxhdpi (144x144)
   - mipmap-xxxhdpi (192x192)

The adaptive icon foreground is defined in drawable/ic_launcher_foreground.xml.
A background color should be defined in values/colors.xml (e.g., ic_launcher_background).
