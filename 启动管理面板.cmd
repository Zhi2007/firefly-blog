@echo off
chcp 936 >nul
title 栀海博客 · 管理后台
cd /d "%~dp0"

echo.
echo   正在启动本地管理后台，请稍候…
echo   （这个窗口要一直开着，关掉它就等于关闭后台）
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没有找到 Node.js，请先安装：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "admin\server.mjs" (
  echo   [错误] 找不到 admin\server.mjs，请把本文件放在项目根目录再运行。
  echo.
  pause
  exit /b 1
)

node "admin\server.mjs" %*

echo.
echo   后台已停止。
pause
