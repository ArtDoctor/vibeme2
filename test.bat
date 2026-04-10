@echo off
setlocal
cd /d "%~dp0"
call npm run test
exit /b %ERRORLEVEL%
