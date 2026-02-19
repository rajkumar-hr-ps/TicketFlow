@echo off
setlocal EnableDelayedExpansion

if "%~1"=="" goto help
if "%~1"=="help" goto help
if "%~1"=="install" goto install
if "%~1"=="run" goto run
if "%~1"=="dev" goto dev
if "%~1"=="seed" goto seed
if "%~1"=="test" goto test
if "%~1"=="test-all" goto test-all
if "%~1"=="reset-data" goto reset-data
if "%~1"=="check-services" goto check-services
if "%~1"=="clean" goto clean

echo Unknown command: %~1
echo Run "make help" to see available commands.
exit /b 1

:help
echo Available commands:
echo   make install        - Install Node.js dependencies
echo   make run            - Start the Express server (port 3000)
echo   make dev            - Start the Express server in watch/dev mode
echo   make seed           - Seed the database with initial data (users, venues, events)
echo   make test TASK=N    - Run tests for a specific task (1-16)
echo   make test-all       - Run all test suites
echo   make reset-data     - Reset MongoDB database and flush Redis
echo   make check-services - Check if MongoDB and Redis are running
echo   make clean          - Clean up everything (node_modules, reports, logs)
exit /b 0

:install
echo Installing dependencies...
call npm install
echo.
echo Installation complete!
echo.
echo Quick Start:
echo   make run               # Start Express server
echo   make dev               # Start in watch mode
echo   make test TASK=1       # Run task 1 tests
echo.
echo Make sure MongoDB and Redis are running:
echo   make check-services
exit /b 0

:run
echo Checking for processes on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>NUL') do (
    taskkill /PID %%a /F >NUL 2>&1
)
timeout /t 1 /nobreak >NUL
echo Starting Express server on port 3000...
node src/server.js
exit /b %ERRORLEVEL%

:dev
echo Checking for processes on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>NUL') do (
    taskkill /PID %%a /F >NUL 2>&1
)
timeout /t 1 /nobreak >NUL
echo Starting Express server in watch mode on port 3000...
node --watch src/server.js
exit /b %ERRORLEVEL%

:seed
echo Seeding database with initial data...
node src/seed.js
exit /b %ERRORLEVEL%

:test
set "TASK_NUM="
for %%a in (%*) do (
    for /f "tokens=1,2 delims==" %%b in ("%%a") do (
        if /i "%%b"=="TASK" set "TASK_NUM=%%c"
    )
)
if "%TASK_NUM%"=="" (
    echo Error: Please specify a task number. Usage: make test TASK=1
    exit /b 1
)
echo Running tests for task: %TASK_NUM%
if exist output rmdir /s /q output
mkdir output
call npm run test:task%TASK_NUM%
exit /b %ERRORLEVEL%

:test-all
call :install
echo Running all tests...
if exist output rmdir /s /q output
mkdir output
call npm test
exit /b %ERRORLEVEL%

:reset-data
echo Resetting database and cache...
echo   - Dropping MongoDB ticketflow database...
mongosh --quiet --eval "db.getSiblingDB('ticketflow').dropDatabase()" 2>NUL || (
    mongo --quiet --eval "db.getSiblingDB('ticketflow').dropDatabase()" 2>NUL || (
        echo   Warning: Could not connect to MongoDB. Is it running?
    )
)
echo   - Dropping MongoDB ticketflow_test database...
mongosh --quiet --eval "db.getSiblingDB('ticketflow_test').dropDatabase()" 2>NUL || (
    mongo --quiet --eval "db.getSiblingDB('ticketflow_test').dropDatabase()" 2>NUL
)
echo   - Flushing Redis...
redis-cli FLUSHALL 2>NUL || echo   Warning: Could not connect to Redis. Is it running?
echo.
echo Reset complete! Run "make run" to start fresh.
exit /b 0

:check-services
echo Checking services...
echo.
set "MONGO_OK=0"
mongosh --quiet --eval "db.runCommand({ ping: 1 }).ok" 2>NUL && set "MONGO_OK=1"
if "!MONGO_OK!"=="0" (
    mongo --quiet --eval "db.runCommand({ ping: 1 }).ok" 2>NUL && set "MONGO_OK=1"
)
if "!MONGO_OK!"=="1" (
    echo   MongoDB: running
) else (
    echo   MongoDB: NOT running
)
redis-cli ping >NUL 2>&1
if %ERRORLEVEL%==0 (
    echo   Redis:   running
) else (
    echo   Redis:   NOT running
)
echo.
exit /b 0

:clean
echo Cleaning up everything...
echo   - Removing node_modules...
if exist node_modules rmdir /s /q node_modules
echo   - Removing test artifacts...
if exist output rmdir /s /q output
if exist reports rmdir /s /q reports
if exist .nyc_output rmdir /s /q .nyc_output
if exist coverage rmdir /s /q coverage
for /d %%d in (.mocha*) do rmdir /s /q "%%d" 2>NUL
for %%f in (.mocha*) do del /q "%%f" 2>NUL
echo   - Removing log files...
del /q *.log 2>NUL
if exist logs rmdir /s /q logs
echo.
echo Cleanup complete! Project is now pristine.
echo   Run "make install" to set up again.
exit /b 0
