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

# 本地数据目录（内置示例数据）不通过 COPY 固化到镜像中。
# 原因一：构建上下文受限（Zeabur/docker-compose 默认上下文是 backend/，根目录的「本地数据」不可见）
# 原因二：数据应作为运行时资产通过 volume 挂载或运行时上传，便于更新且镜像更小
# 此处仅创建空目录占位，实际数据来源优先级：
#   1) 运行时环境变量 LOCAL_DATA_DIR 指定
#   2) 挂载卷 /app/本地数据
#   3) 与源码同仓库部署时通过修改构建上下文注入
RUN mkdir -p /app/本地数据

# 创建输出目录（处理后的点云文件存放处，默认通过 OUTPUT_DIR env 指定为 /app/output）
RUN mkdir -p output

# 暴露端口（Zeabur 默认期望 8080）
ENV PORT=8080
EXPOSE 8080

# 健康检查：每 30 秒检查一次后端是否存活
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health')" || exit 1

# 启动 FastAPI 服务（uvicorn）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
