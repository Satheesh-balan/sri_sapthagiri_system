@echo off
title Sri Sapthagiri Inventory - Starting...
echo.
echo  ========================================
echo   Sri Sapthagiri Inventory System
echo  ========================================
echo.

:: Check if PM2/server is already running
echo  Checking server status...
pm2 list 2>nul | findstr "sri-sapthagiri" | findstr "online" >nul
if %errorlevel% == 0 (
    echo  [OK] Server is already running!
) else (
    echo  [..] Starting server with PM2...
    cd /d "c:\Users\Lenovo\Documents\Hani pro\pm\backend"
    pm2 start server.js --name "sri-sapthagiri" 2>nul
    pm2 save 2>nul
    echo  [OK] Server started!
    echo  Waiting for server to be ready...
    timeout /t 3 /nobreak >nul
)

echo.
echo  Opening app in browser...
start "" "http://localhost:5001/index.html"
echo.
echo  App is running at: http://localhost:5001
echo  You can close this window.
echo.
timeout /t 3 /nobreak >nul
