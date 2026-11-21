# CamLens (Native Android App & Fullscreen Laptop Software)

Fullscreen, zero-distraction camera streaming from your Android phone to your laptop at full camera sensor resolution, with a 1-click **TRIGGER** button that sends photos directly to **Google Lens**.

---

## 1. How to Install and Open the App on Your Phone

You have two easy ways:

### Option A: Via USB Cable (Recommended - 1 Click)
1. Plug your Android phone into your laptop using your charging cable (ensure USB Debugging is ON).
2. Double-click **`install_app.bat`**.
   - Automatically installs `CamLens.apk` onto your phone.
   - Sets up zero-latency USB forwarding (`adb forward tcp:8080 tcp:8080`).
   - Automatically launches the app on your phone.

### Option B: Via QR Code
1. Double-click **`start.bat`** on your laptop.
2. In the top-right toolbar, click the **QR Code** icon.
3. The QR code has 3 modes:
   - **Open App**: Automatically triggers Android to launch the installed CamLens app.
   - **Download APK**: Downloads `CamLens.apk` directly to your phone.
   - **Web Stream**: Runs live camera stream right in the mobile browser with zero install.

---

## 2. Using the Fullscreen Laptop Software

1. Double-click **`start.bat`** (or open `http://localhost:3000`).
2. **Distraction-Free UI**:
   - **No Header / Navbar & No Footer**: The camera view takes up 100% of your screen.
   - **Full Sensor Resolution**: Streams directly from your Android phone's hardware camera in native HD without stretching or distortion.
   - **Only Important Floating Controls**:
     - **TRIGGER [SPACE]**: Snaps the high-res photo and automatically opens **Google Lens** in a new tab!
     - **Rotate 90 Degrees**: Rotates the camera feed to match your phone's physical orientation.
     - **Flip Camera**: Toggles between back and front camera.
     - **Torch**: Turns phone flashlight on/off.
     - **QR Code**: Switch between Auto-Open, APK Download, and Web Stream modes.
