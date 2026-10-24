@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 18 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing project dependencies for local testing...
  call npm install
  if errorlevel 1 (
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
  )
)
set HOST=127.0.0.1
set PORT=3000
set PANEL_USERNAME=admin
set PANEL_PASSWORD=local-admin-change-me
set SESSION_SECRET=local-development-only-secret-change-before-deploy
start "Pickle Point Match Local Browser" http://127.0.0.1:3000
 echo.
echo Pickle Point Match local test server
 echo URL: http://127.0.0.1:3000
 echo Panel login username: admin
 echo Panel login password: local-admin-change-me
 echo Data is saved locally in the data folder.
 echo Press Ctrl+C to stop the server.
 echo.
node server.js
pause
