@echo off
title CamLens - Phone Webcam & Google Lens Trigger
color 0b

echo ========================================================
echo   🎥 CamLens - Phone Webcam & Google Lens Trigger
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js from https://nodejs.org/ to run CamLens.
    pause
    exit /b
)

echo [*] Ensuring port 3000 is free...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>nul
)

echo [*] Launching CamLens in Standalone Window Mode...
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist %EDGE% set EDGE="C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if exist %CHROME% (
    start "" %CHROME% --app=http://localhost:3000 --window-size=1280,820
) else if exist %EDGE% (
    start "" %EDGE% --app=http://localhost:3000 --window-size=1280,820
) else (
    start "" http://localhost:3000
)

echo [*] Starting CamLens server...
node server.js

pause
