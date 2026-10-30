@echo off
rem One-click start for whale-life: runs scripts\start-whale.mjs (NapCat + DSH).
rem NOTE: keep this file ASCII-only - cmd.exe on CJK Windows reads .cmd in GBK codepage.
setlocal
cd /d "%~dp0"
node "%~dp0scripts\start-whale.mjs" %*
endlocal
