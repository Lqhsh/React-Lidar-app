@echo off
chcp 65001 >nul
REM ============================================================
REM  LiDAR 点云滤波系统 - 后端一键启动脚本（Windows 双击版）
REM  自动使用 backend/.venv 里的 Python + 已装好的依赖
REM ============================================================

cd /d "%~dp0"

set "VENV_PY=%~dp0.venv\Scripts\python.exe"
set "MAIN_PY=%~dp0main.py"

if not exist "%VENV_PY%" (
    echo [ERROR] 找不到虚拟环境 Python: %VENV_PY%
    echo 请先在 backend 目录下运行: python -m venv .venv
    echo 然后: .venv\Scripts\pip.exe install -r requirements.txt
    pause
    exit /b 1
)

echo.
echo ================================================
echo   LiDAR 后端启动中...
echo   Python   : %VENV_PY%
echo   入口     : %MAIN_PY%
echo   默认端口 : 3001
echo ================================================
echo.

set "PORT=3001"
set "HOST=127.0.0.1"

"%VENV_PY%" "%MAIN_PY%"

echo.
echo 后端已退出，按任意键关闭窗口...
pause >nul
