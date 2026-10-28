@echo off
rem Build firefly-admin.exe from FireflyAdminLauncher.cs
rem Uses the .NET Framework compiler already installed on Windows (no SDK needed).
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [ERROR] csc.exe not found. Install .NET Framework 4.x.
  exit /b 1
)
"%CSC%" /nologo /target:winexe /platform:anycpu /optimize+ /win32icon:"%~dp0app.ico" /win32manifest:"%~dp0app.manifest" /out:"%~dp0..\firefly-admin.exe" /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0FireflyAdminLauncher.cs"
if errorlevel 1 (
  echo Build FAILED.
  exit /b 1
) else (
  echo Build OK: %~dp0..\firefly-admin.exe
)
endlocal
