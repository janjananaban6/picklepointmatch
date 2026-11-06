@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 (
  echo ERROR: Could not open the project folder.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 18 or newer, then run this file again.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo ERROR: Could not determine the Node.js version.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 18 (
  echo ERROR: Node.js 18 or newer is required. Current major version: %NODE_MAJOR%
  pause
  exit /b 1
)

rem Force an isolated local configuration. In particular, never inherit a
rem cloud DATABASE_URL or an alternate data directory from Windows.
set "NODE_ENV=development"
set "HOST=127.0.0.1"
set "PORT=3000"
set "DATABASE_URL="
set "PICKLE_DATA_DIR="
set "ORGANIZER_USERNAME="
set "ORGANIZER_PASSWORD="
set "PANEL_USERNAME=admin"
set "PANEL_PASSWORD=local-admin-change-me"
set "SESSION_SECRET=local-development-only-secret-change-before-deploy"

if not exist "node_modules\pg\package.json" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo ERROR: npm is not available. Reinstall Node.js with npm included.
    pause
    exit /b 1
  )
  echo Installing project dependencies for local testing...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
  )
)

 echo.
echo Pickle Point Match - LOCAL TEST SERVER
echo URL: http://127.0.0.1:3000
echo Panel login username: admin
echo Panel login password: local-admin-change-me
echo Storage: this project's data folder only
echo Cloud database: DISABLED for this run
echo Host: 127.0.0.1 (this computer only)
echo.
echo Opening the local site. If it does not load immediately, refresh after the server starts.
start "Pickle Point Match Local Browser" http://127.0.0.1:3000
echo Press Ctrl+C in this window to stop the server.
echo.
node server.js
if errorlevel 1 (
  echo.
  echo The local server stopped with an error. Review the message above.
)
pause
