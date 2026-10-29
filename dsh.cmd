@echo off
rem 鲸生专属 dsh 入口（Windows）
rem 独立程序副本（runtime\）+ 独立数据家（dsh-home\），不依赖也不污染机器上其他 dsh 环境
setlocal
set "DSH_HOME=%~dp0dsh-home"
set "TEMP=%DSH_HOME%\tmp"
set "TMP=%TEMP%"
if not exist "%TEMP%" mkdir "%TEMP%"
node "%~dp0runtime\node_modules\@deepseek-ai\dsh\lib\bin.js" %*
exit /b %errorlevel%
