@echo off
title Glimpse Launcher
echo Starting glimpse development environment...
echo.

echo Starting API Server on port 5000...
start "glimpse API Server" cmd /c "pnpm --filter @workspace/api-server run dev"

echo Waiting for API Server to initialize...
timeout /t 3 /nobreak >nul

echo Starting Wedding Web App...
start "glimpse Wedding App" cmd /c "pnpm --filter @workspace/wedding-app run dev"

echo.
echo Both servers have been launched in separate windows:
echo - API Server: http://localhost:5000
echo - Wedding App: http://localhost:8081
echo.
pause
