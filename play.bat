@echo off
rem play.bat - run Fortissimo from a downloaded copy (Windows). Double-click it.
rem   first run: installs what the game needs (a few minutes), builds it, opens it in your browser
rem   after that: starts in seconds. Close this window to stop the game.
cd /d "%~dp0"
if "%PORT%"=="" set PORT=5180
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Fortissimo needs Node.js ^(free^) to run from source.
  echo Install it from https://nodejs.org ^(the LTS version^), then run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo.
  echo First run: installing what the game needs ^(one time, a few minutes^)...
  set ELECTRON_SKIP_BINARY_DOWNLOAD=1
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo Install failed - see above. & pause & exit /b 1 )
)
if not exist dist\index.html (
  echo.
  echo Building the game...
  call npm run build --silent
  if errorlevel 1 ( echo Build failed - see above. & pause & exit /b 1 )
)
echo.
echo Fortissimo is running at http://localhost:%PORT%  - close this window to stop it.
call npx vite preview --port %PORT% --strictPort --open
