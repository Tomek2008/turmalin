@echo off
cd /d "%~dp0"

echo ===================================
echo   TURMALIN
echo ===================================

echo [1/3] Migracje Django...
python manage.py migrate --noinput
if errorlevel 1 (
  echo Blad migracji. Sprawdz Python i zaleznosci Django.
  pause
  exit /b 1
)

echo [2/3] Backend Django — http://127.0.0.1:8000/api/
start cmd /k "cd /d %~dp0 && python manage.py runserver"

echo [3/3] Frontend — http://localhost:5173
start cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Django API + frontend startuja w osobnych oknach.
pause
