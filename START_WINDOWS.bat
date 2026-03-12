@echo off
echo ================================
echo  Alpha AI Desk - Local Setup
echo ================================

:: Check if Node.js is installed
node --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo ERROR: Node.js is not installed.
    echo Please download and install it from: https://nodejs.org
    echo Then re-run this file.
    pause
    exit /b 1
)

echo Node.js found. Installing dependencies...
cd web
npm install

echo.
echo Starting Alpha AI Desk...
echo Open your browser to: http://localhost:3000
echo Press Ctrl+C to stop.
echo.
npm run dev
pause
