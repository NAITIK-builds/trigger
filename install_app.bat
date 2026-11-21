@echo off
title Install CamLens on Android
color 0a

echo ========================================================
echo   📱 CamLens - 1-Click Android App Installer
echo ========================================================
echo.

set ADB="C:\Users\naiti\AppData\Local\Android\Sdk\platform-tools\adb.exe"
if not exist %ADB% (
    set ADB=adb
)

echo [*] Checking connected Android devices...
%ADB% devices
echo.

echo [*] Installing CamLens.apk on your phone...
%ADB% install -r CamLens.apk
if %errorlevel% neq 0 (
    echo.
    echo [!] Install failed. Please ensure:
    echo     1. Phone is plugged into laptop via USB.
    echo     2. USB Debugging is ENABLED on your phone.
    echo     3. You accepted the "Allow USB Debugging" prompt on your phone screen.
    echo.
    pause
    exit /b
)

echo.
echo [*] Setting up USB port forwarding (zero lag)...
%ADB% forward tcp:8080 tcp:8080

echo [*] Launching CamLens on your phone...
%ADB% shell am start -n com.camlens.app/.MainActivity

echo.
echo ========================================================
echo   ✅ CamLens installed and running on your Android!
echo ========================================================
echo.
pause
