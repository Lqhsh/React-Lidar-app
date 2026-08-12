# 后端 Dockerfile - FastAPI + Python 点云处理服务
# 纯 Python 环境，无需 Node.js
FROM python:3.10-slim

# 安装系统依赖
# - libgl1, libglib2.0-0: open3d 运行所需的图形库
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖（利用 Docker 缓存层，单独复制 requirements.txt）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制项目源码
COPY . .

# 创建输出目录（处理后的点云文件存放处）
RUN mkdir -p output

# 暴露端口（Zeabur 默认期望 8080）
ENV PORT=8080
EXPOSE 8080

# 健康检查：每 30 秒检查一次后端是否存活
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health')" || exit 1

# 启动 FastAPI 服务（uvicorn）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
