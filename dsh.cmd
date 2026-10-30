@echo off
rem Whale Life dedicated dsh entry (Windows).
rem Own program copy (runtime\) + own data home (dsh-home\). Fully isolated from any other dsh env.
rem NOTE: keep this file ASCII-only - cmd.exe on CJK Windows reads .cmd in GBK codepage.
setlocal
cd /d "%~dp0"
set "DSH_HOME=%~dp0dsh-home"
set "TEMP=%DSH_HOME%\tmp"
set "TMP=%TEMP%"
if not exist "%TEMP%" mkdir "%TEMP%"
node "%~dp0runtime\node_modules\@deepseek-ai\dsh\lib\bin.js" %*
exit /b %errorlevel%
