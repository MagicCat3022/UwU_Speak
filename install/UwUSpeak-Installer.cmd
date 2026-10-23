@echo off
rem Double-click to install or update UwUSpeak. Runs the latest install.ps1 from GitHub.
title UwUSpeak installer
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; iex (irm 'https://github.com/MagicCat3022/UwU_Speak/releases/latest/download/install.ps1')"
echo.
pause
