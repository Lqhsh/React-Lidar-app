@echo off
chcp 65001 >nul 2>nul
title LiDAR 点云滤波系统 - 本地启动脚本
setlocal enabledelayedexpansion

REM ════════════════════════════════════════════════════
REM  LiDAR 点云滤波与可视化系统 - 本地一键启动脚本
REM  适用环境: Windows + Node.js 20+ + Python 3.10+
REM  后端: FastAPI + uvicorn（纯 Python，无需 Node.js 后端）
REM ════════════════════════════════════════════════════

REM 项目根目录（脚本所在目录，%~dp0 自带末尾反斜杠）
set "ROOT=%~dp0"

echo.
echo ════════════════════════════════════════════════════
echo    LiDAR 点云滤波与可视化系统 - 本地启动脚本
echo ════════════════════════════════════════════════════
echo.
echo   项目路径: %ROOT%
echo.

REM ────────────────────────────────────────────────────
REM  环境检查
REM ────────────────────────────────────────────────────
echo [环境检查]
echo.

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo   [X] 未检测到 Node.js
    echo       请安装 Node.js 20.x: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
echo   [OK] Node.js %NODE_VER%

REM 检查 npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo   [X] 未检测到 npm
    echo       npm 随 Node.js 一起安装，请检查 Node.js 安装是否完整
    echo.
    pause
    exit /b 1
)
echo   [OK] npm 已就绪

REM 检查 Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo   [X] 未检测到 Python
    echo       请安装 Python 3.10+: https://www.python.org/downloads/
    echo       安装时请勾选 "Add Python to PATH"
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do set "PY_VER=%%v"
echo   [OK] %PY_VER%
echo.

REM ────────────────────────────────────────────────────
REM  Step 1/4: 创建 Python 虚拟环境并安装依赖
REM ────────────────────────────────────────────────────
set "VENV_PYTHON=%ROOT%backend\venv\Scripts\python.exe"

if not exist "%VENV_PYTHON%" (
    echo [1/4] 创建 Python 虚拟环境...
    pushd "%ROOT%backend"
    python -m venv venv
    if !errorlevel! neq 0 (
        echo   [X] 虚拟环境创建失败
        popd
        pause
        exit /b 1
    )
    echo   [OK] 虚拟环境已创建: backend\venv\

    echo       安装 Python 依赖（首次运行需要几分钟）...
    "%VENV_PYTHON%" -m pip install --upgrade pip >nul 2>nul
    "%VENV_PYTHON%" -m pip install fastapi "uvicorn[standard]" python-multipart numpy laspy open3d scipy cloth-simulation-filter
    if !errorlevel! neq 0 (
        echo   [!] 部分依赖安装失败，CSF 布料滤波功能可能不可用
        echo       可手动执行: backend\venv\Scripts\pip install cloth-simulation-filter
    ) else (
        echo   [OK] Python 依赖安装完成
    )
    popd
) else (
    echo [1/4] Python 虚拟环境已存在，跳过
)
echo.

REM ────────────────────────────────────────────────────
REM  Step 2/4: 安装前端依赖
REM ────────────────────────────────────────────────────
if not exist "%ROOT%node_modules" (
    echo [2/4] 安装前端依赖 (npm install)...
    pushd "%ROOT%"
    call npm install
    if !errorlevel! neq 0 (
        echo   [X] 前端依赖安装失败
        popd
        pause
        exit /b 1
    )
    popd
    echo   [OK] 前端依赖安装完成
) else (
    echo [2/4] 前端依赖已存在，跳过
)
echo.

REM ────────────────────────────────────────────────────
REM  Step 3/4: 启动后端服务 (FastAPI + uvicorn, 端口 3001)
REM ────────────────────────────────────────────────────
echo [3/4] 启动后端服务 (FastAPI + uvicorn, 端口 3001)...
start "LiDAR 后端服务 - FastAPI" /D "%ROOT%backend" cmd /k "%VENV_PYTHON% -m uvicorn main:app --host 0.0.0.0 --port 3001 --reload"
echo   [OK] 后端服务已在新窗口启动
echo.

REM 等待后端初始化
echo       等待后端服务初始化...
timeout /t 3 /nobreak >nul

REM ────────────────────────────────────────────────────
REM  Step 4/4: 启动前端服务 (Vite Dev Server, 端口 5173)
REM ────────────────────────────────────────────────────
echo [4/4] 启动前端服务 (端口 5173)...
start "LiDAR 前端服务 - Vite Dev Server" /D "%ROOT%" cmd /k npm run dev
echo   [OK] 前端服务已在新窗口启动
echo.

REM 等待 Vite 编译完成
echo       等待前端服务编译...
timeout /t 5 /nobreak >nul

REM ────────────────────────────────────────────────────
REM  打开浏览器
REM ────────────────────────────────────────────────────
echo.
echo ════════════════════════════════════════════════════
echo   启动完成! 正在打开浏览器...
echo ════════════════════════════════════════════════════
echo.
echo   前端地址:  http://localhost:5173
echo   后端地址:  http://localhost:3001
echo   健康检查:  http://localhost:3001/api/health
echo   API 文档:  http://localhost:3001/docs
echo.
echo   操作提示:
echo   - 关闭本窗口不会停止服务
echo   - 停止服务请关闭 [后端] 和 [前端] 两个命令行窗口
echo   - 后端窗口显示 FastAPI 请求日志
echo   - 前端窗口显示 Vite 编译日志和热更新信息
echo.
echo   技术栈:
echo   - 后端: Python FastAPI + uvicorn
echo   - 前端: React 18 + Vite + Tailwind CSS
echo   - 3D:   Three.js WebGL
echo.

start http://localhost:5173

pause
