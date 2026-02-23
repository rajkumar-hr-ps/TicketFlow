@echo off
setlocal EnableDelayedExpansion

if "%~1"=="" goto help
if "%~1"=="help" goto help
if "%~1"=="install" goto install
if "%~1"=="run" goto run
if "%~1"=="seed" goto seed
if "%~1"=="test" goto test
if "%~1"=="reset-data" goto reset-data

echo Unknown command: %~1
echo Run "make help" to see available commands.
exit /b 1

:help
echo Available commands:
echo   make install           - Install Node.js dependencies
echo   make run               - Seed database and start the Express server (port 3000)
echo   make seed              - Seed the database with initial data (users, venues, events)
echo   make test              - Install deps and run all test suites
echo   make test FEATURE=1    - Install deps and run tests for a specific task (1-16)
echo   make reset-data        - Reset MongoDB database and flush Redis
exit /b 0

:install
echo Installing dependencies...
call npm install
echo.
echo Installation complete!
echo.
echo Quick Start:
echo   make run                  # Seed + start Express server
echo   make test FEATURE=1       # Run task 1 tests
exit /b 0

:run
call :seed
echo Checking for processes on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>NUL') do (
    taskkill /PID %%a /F >NUL 2>&1
)
timeout /t 1 /nobreak >NUL
echo Starting Express server on port 3000...
node src/server.js
exit /b %ERRORLEVEL%

:seed
echo Seeding database with initial data...
node src/seed.js
exit /b %ERRORLEVEL%

:test
call :install
set "FEATURE_NUM="
for %%a in (%*) do (
    for /f "tokens=1,2 delims==" %%b in ("%%a") do (
        if /i "%%b"=="FEATURE" set "FEATURE_NUM=%%c"
    )
)
if "%FEATURE_NUM%"=="" (
    echo Running all tests...
    if exist output rmdir /s /q output
    mkdir output
    call npm test
    exit /b %ERRORLEVEL%
)
echo Running tests for feature: %FEATURE_NUM%
if exist output rmdir /s /q output
mkdir output
call npm run test:task%FEATURE_NUM%
exit /b %ERRORLEVEL%

:reset-data
node src/reset.js
exit /b %ERRORLEVEL%
