@echo off
setlocal
for /f "tokens=2 delims=:" %%C in ('chcp') do set "ORIGINAL_CODEPAGE=%%C"
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONUTF8=1
set "STARTUP_MESSAGES=%~dp0startup-messages.json"
set "LOW_PY="
set "LOW_PYTHON="

py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 2)" >nul 2>&1
set "PY_CHECK=%errorlevel%"
if "%PY_CHECK%"=="0" goto :run_py
if "%PY_CHECK%"=="2" set "LOW_PY=1"

python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 2)" >nul 2>&1
set "PYTHON_CHECK=%errorlevel%"
if "%PYTHON_CHECK%"=="0" goto :run_python
if "%PYTHON_CHECK%"=="2" set "LOW_PYTHON=1"

if defined LOW_PY goto :too_old
if defined LOW_PYTHON goto :too_old
echo.
call :message missing
goto :wait_failure

:too_old
echo.
call :message old
if defined LOW_PY py -3 --version
if defined LOW_PYTHON python --version
call :message upgrade
goto :wait_failure

:run_py
py -3 "%~dp0app.py"
goto :finished

:run_python
python "%~dp0app.py"
goto :finished

:finished
set "APP_EXIT=%errorlevel%"
if "%APP_EXIT%"=="0" goto :success
echo.
call :message failed

:wait_failure
echo.
call :message wait
pause >nul
if defined ORIGINAL_CODEPAGE chcp %ORIGINAL_CODEPAGE% >nul
endlocal
exit /b 1

:success
if defined ORIGINAL_CODEPAGE chcp %ORIGINAL_CODEPAGE% >nul
endlocal
exit /b 0

:message
set "STARTUP_MESSAGE=%~1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$OutputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding; $m = [IO.File]::ReadAllText($env:STARTUP_MESSAGES, [Text.Encoding]::UTF8) | ConvertFrom-Json; $key = $env:STARTUP_MESSAGE; $m.$key | ForEach-Object { $_ -f $env:APP_EXIT }"
exit /b
