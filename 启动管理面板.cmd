@echo off
chcp 65001 >nul
title 栀海博客 · 管理后台
cd /d "%~dp0"

echo.
echo   正在启动本地管理后台，请稍候…
echo   （这个黑窗口要一直开着，关闭它就等于关闭后台）
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没有找到 node。请先安装 Node.js：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node "admin\server.mjs"

echo.
echo   后台已停止。
pause
