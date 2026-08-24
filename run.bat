@echo off
echo ===================================
echo   PALANTYR.NET System Bootstrapping
echo ===================================

echo [1/2] Starting Python Backend Service on http://127.0.0.1:8000...
start cmd /k "python manage.py runserver"

echo [2/2] Starting React Frontend on http://localhost:5173...
start cmd /k "cd frontend && npm run dev"

echo Services are initializing...
pause
