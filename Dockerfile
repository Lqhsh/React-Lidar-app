# ================================================================
# 前后端一体 Dockerfile（Zeabur 单服务部署）
# 阶段 1: Node 编译 React 前端
# 阶段 2: Python + Nginx 同时运行后端 API 和前端静态文件
# ================================================================

# ---- 阶段 1: 构建前端 ----
FROM node:20-alpine AS frontend-build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# ---- 阶段 2: 运行前后端 ----
FROM python:3.10-slim

# 安装 nginx 和系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装后端 Python 依赖
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# 复制后端源码
COPY backend/ /app/

# 复制前端构建产物到 nginx 静态目录
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# 复制 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 创建数据目录
RUN mkdir -p /app/本地数据 /app/output

# 环境变量
ENV PORT=8080
ENV LOCAL_DATA_DIR=/app/本地数据
ENV OUTPUT_DIR=/app/output
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health')" || exit 1

# 启动命令：后台运行 bootstrap + uvicorn，前台运行 nginx
# - bootstrap 下载内置 LAS 数据到 /app/本地数据
# - uvicorn 监听 8000 端口提供 API
# - nginx 监听 8080 端口提供静态文件 + 反向代理 /api/ 到 8000
CMD ["sh", "-c", "python builtin_data_bootstrap.py & uvicorn main:app --host 0.0.0.0 --port 8000 & nginx -g 'daemon off;'"]
