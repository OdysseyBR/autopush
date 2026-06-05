@echo off
title git autopush
cd /d "%~dp0"
node server.js
if %errorlevel% neq 0 (
    echo.
    echo  Erro ao iniciar. Verifique se o Node.js esta instalado.
    pause
)
