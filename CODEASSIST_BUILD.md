# Building Monitory in CodeAssist

This project uses the Gradle wrapper and Kotlin DSL. Keep the existing project structure; open the repository root (the folder containing `settings.gradle.kts` and `gradlew`), not the `app/` folder by itself.

## Build in CodeAssist

1. Download or clone the repository branch containing your changes.
2. Extract it, then open the **project root** in CodeAssist.
3. Allow Gradle sync and dependency downloads to finish. Use JDK 17 if the IDE asks for a Java version.
4. Run the Gradle task **`:app:assembleDebug`** or use the terminal:

   ```sh
   chmod +x gradlew
   ./gradlew --no-daemon assembleDebug
   ```

5. The debug APK should be at:

   ```
   app/build/outputs/apk/debug/app-debug.apk
   ```

## Build without CodeAssist

A GitHub Actions workflow builds the debug APK on pushes, pull requests, or manual dispatch. Open the repository's **Actions** tab, select **Android debug APK**, open a successful run, and download the **Monitory-debug-apk** artifact.

## Notes

- This is a debug APK for testing, not a Play Store release.
- Build success is not guaranteed until the workflow actually completes; inspect the Actions log for any Gradle, SDK, or source errors.
- Android's Storage Access Framework only lets the app browse folders the device owner selects in the system picker. Android restricts some protected directories (including parts of `Android/data` and `Android/obb`); the app cannot bypass those platform restrictions.
- The storage browser displays local capacity and selected-folder file metadata on the device. It does not upload or remotely stream private files to a server.
