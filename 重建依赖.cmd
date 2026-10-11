@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 重建博客依赖（修复本地构建）

rem ══════════════════════════════════════════════════════════════
rem  重建博客依赖：修复本地 node_modules 与 pnpm-lock.yaml 不一致
rem  路径自动探测；全过程同时输出到窗口并写入 logs\ 目录
rem  （logs\ 已在 .gitignore 里，不会被提交或发布）
rem ══════════════════════════════════════════════════════════════

rem ── 1. 自动探测仓库（判定：package.json + wrangler.jsonc + src\config） ──
set "REPO="
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

call :try "%HERE%"
for %%D in ("%HERE%\..") do call :try "%%~fD"
for %%D in ("%HERE%\..\..") do call :try "%%~fD"
for %%D in ("%HERE%\..\..\..") do call :try "%%~fD"
call :try "%CD%"
if not "%~1"=="" call :try "%~1"

echo.
if not defined REPO (
	echo   [错误] 没能自动找到博客仓库。
	echo.
	echo   判定标准：该目录里要同时存在 package.json、wrangler.jsonc、src\config
	echo   三种做法任选其一：
	echo     1^) 把本脚本放到仓库根目录（有 package.json 的那层）再双击
	echo     2^) 把仓库文件夹直接拖到本脚本上
	echo     3^) 在仓库根目录打开命令行，运行 重建依赖.cmd
	echo.
	pause
	exit /b 1
)

rem ── 2. 准备日志（文件名用 ASCII，避免编码问题；内容为 GBK） ──
set "LOGDIR=%REPO%\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>nul
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%t"
if "%STAMP%"=="" set "STAMP=unknown"
set "LOG=%LOGDIR%\rebuild-deps-%STAMP%.log"
for /f "skip=10 delims=" %%f in ('dir /b /o-d "%LOGDIR%\*.log" 2^>nul') do del "%LOGDIR%\%%f" >nul 2>nul

call :say "=========== 重建博客依赖 ==========="
call :say "开始时间：%DATE% %TIME:~0,8%"
call :say "脚本位置：%~f0"
call :say "识别到仓库：%REPO%"
call :say "日志文件：%LOG%"
call :say "===================================="
echo   识别到仓库：%REPO%
echo.
echo   （路径不对请按 Ctrl+C 取消，然后把脚本放到仓库根目录再试）
echo   日志：%LOG%
echo.
pause
call :say "作者已确认路径，开始执行。"

cd /d "%REPO%" || (
	call :say "[错误] 无法进入 %REPO%"
	echo   [错误] 无法进入 %REPO%
	pause
	exit /b 1
)

rem ── 3. 检查 Node.js ──
echo   [1/4] 检查 Node.js ...
where node >nul 2>nul
if errorlevel 1 (
	call :say "[错误] 没有找到 node 命令，请先安装 Node.js 22 或更高版本。"
	echo   [错误] 没有找到 node 命令，请先安装 Node.js 22 或更高版本。
	pause
	exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
call :say "Node 版本：%NODEVER%"
echo         Node %NODEVER%

rem ── 4. 检查 pnpm ──
echo   [2/4] 检查 pnpm ...
where pnpm >nul 2>nul
if errorlevel 1 (
	echo         没找到 pnpm，尝试用 npm 全局安装（需要联网）...
	call :say "未找到 pnpm，执行 npm i -g pnpm"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "cmd /c 'npm i -g pnpm' 2>&1 | ForEach-Object { Write-Host $_; Add-Content -LiteralPath '%LOG%' -Value $_ -Encoding Default }; exit $LASTEXITCODE"
	if errorlevel 1 (
		call :say "[错误] npm i -g pnpm 失败。"
		echo   [错误] pnpm 安装失败。可以手动执行：npm i -g pnpm
		call :openlog
		pause
		exit /b 1
	)
	where pnpm >nul 2>nul
	if errorlevel 1 (
		call :say "[错误] 仍然找不到 pnpm。"
		echo   [错误] 仍然找不到 pnpm，请手动执行 npm i -g pnpm 后重试。
		call :openlog
		pause
		exit /b 1
	)
)
for /f "delims=" %%v in ('pnpm -v') do set "PNPMVER=%%v"
call :say "pnpm 版本：%PNPMVER%"
echo         pnpm %PNPMVER%

rem ── 5. 删除旧依赖 ──
echo   [3/4] 删除旧的 node_modules（可能要几分钟）...
call :say "删除 node_modules ..."
if exist node_modules rmdir /s /q node_modules
call :say "node_modules 已删除。"

rem ── 6. 重新安装（实时输出 + 完整写日志） ──
echo   [4/4] 重新安装依赖（首次约几百 MB，请耐心等待）...
call :say "执行 pnpm install --frozen-lockfile ..."
powershell -NoProfile -ExecutionPolicy Bypass -Command "cmd /c 'pnpm install --frozen-lockfile' 2>&1 | ForEach-Object { Write-Host $_; Add-Content -LiteralPath '%LOG%' -Value $_ -Encoding Default }; exit $LASTEXITCODE"
if errorlevel 1 (
	call :say "[失败] pnpm install 返回非零退出码。"
	echo.
	echo   [失败] 安装没有成功。日志已保存并会自动打开：
	echo          %LOG%
	call :openlog
	pause
	exit /b 1
)

call :say "安装成功。收尾。"
echo.
echo   == 完成 ==
echo   仓库：%REPO%
echo   日志：%LOG%
echo   现在可以双击「启动管理面板.cmd」；本地构建与预览应该正常了。
echo   说明：这一步只影响你电脑上的本地构建，线上站点和 GitHub Actions 不受影响。
echo.
pause
exit /b 0

rem ══════════════════════════════════════════════════════════════
rem  子过程
rem ══════════════════════════════════════════════════════════════

rem 写一行到窗口 + 日志（带时间戳）
:say
set "LINE=%TIME:~0,8%  %~1"
echo %LINE%>>"%LOG%"
echo %LINE%
goto :eof

rem 失败时把日志用记事本打开
:openlog
if exist "%LOG%" start "" notepad "%LOG%"
goto :eof

rem 如果 %1 是仓库根目录，就记下它
:try
if defined REPO goto :eof
if "%~1"=="" goto :eof
if not exist "%~f1\package.json" goto :eof
if not exist "%~f1\wrangler.jsonc" goto :eof
if not exist "%~f1\src\config" goto :eof
set "REPO=%~f1"
goto :eof