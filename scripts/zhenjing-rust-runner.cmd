@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-rust-executable.ps1" %*
exit /b %errorlevel%
