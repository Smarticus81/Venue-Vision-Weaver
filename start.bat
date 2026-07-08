@echo off
setlocal

cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [start.bat] pnpm is not installed or not on PATH.
  echo Install pnpm first: npm i -g pnpm
  exit /b 1
)

set "MODE=%~1"
if "%MODE%"=="" set "MODE=all"

if /I "%MODE%"=="all" goto :devall
if /I "%MODE%"=="prod" goto :prod
if /I "%MODE%"=="dev" goto :dev
if /I "%MODE%"=="api" goto :api
if /I "%MODE%"=="web" goto :web
if /I "%MODE%"=="dev:all" goto :devall
if /I "%MODE%"=="help" goto :help
if /I "%MODE%"=="/?" goto :help

echo [start.bat] Unknown mode: %MODE%
goto :help

:prod
echo [start.bat] Production flow: build workspace, then start API server...
call pnpm run build || goto :error
call pnpm run start
goto :eof

:dev
echo [start.bat] API development flow...
call pnpm --filter @workspace/api-server run dev
goto :eof

:api
echo [start.bat] API development flow...
call pnpm --filter @workspace/api-server run dev
goto :eof

:web
echo [start.bat] Wedding app Vite dev server...
call pnpm --filter @workspace/wedding-app run dev
goto :eof

:devall
echo [start.bat] Launching API and web dev servers in separate terminals...
start "api-server" cmd /k "cd /d ""%~dp0"" && pnpm --filter @workspace/api-server run dev"
start "wedding-app" cmd /k "cd /d ""%~dp0"" && pnpm --filter @workspace/wedding-app run dev"
goto :eof

:help
echo Usage: start.bat [mode]
echo.
echo   all      Open two terminals for API + web dev servers (default)
echo   prod     Build all packages, then run API server
echo   dev      Run API server in dev mode
echo   api      Alias for dev
echo   web      Run wedding-app Vite dev server
echo   dev:all  Alias for all
echo   help     Show this message
exit /b 0

:error
echo [start.bat] Command failed with exit code %errorlevel%.
exit /b %errorlevel%
