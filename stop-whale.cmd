@echo off
rem One-click stop for whale-life: stops DSH (--profile whale) and NapCat/QQ.
rem NOTE: keep this file ASCII-only - cmd.exe on CJK Windows reads .cmd in GBK codepage.
setlocal
cd /d "%~dp0"
node "%~dp0scripts\stop-whale.mjs" %*
endlocal
