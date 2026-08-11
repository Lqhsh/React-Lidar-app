# 后端 Dockerfile - Node.js (Express) + Python (laspy/open3d) 混合服务
FROM python:3.10-slim

# 安装系统依赖
# - curl: 用于下载 NodeSource 安装脚本
# - libgl1, libglib2.0-0: open3d 运行所需的图形库
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node.js 20.x（Debian 仓库自带版本过旧，使用 NodeSource 官方源）
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖（利用 Docker 缓存层，单独复制 requirements.txt）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 安装 Node.js 依赖（包含 devDependencies 中的 tsx，用于运行 TypeScript）
COPY package.json package-lock.json* ./
RUN npm ci

# 复制项目源码
COPY . .

# 创建输出目录（处理后的点云文件存放处）
RUN mkdir -p output

EXPOSE 3001

# 健康检查：每 30 秒检查一次后端是否存活
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))" || true

# 启动服务（tsx 直接运行 TypeScript，无需预编译）
CMD ["npm", "start"]
