# 前端 Dockerfile - React + Vite 多阶段构建 + Nginx 反向代理
# 构建阶段：编译 React 静态文件
FROM node:20-alpine AS build

WORKDIR /app

# 安装依赖（利用 Docker 缓存层）
# 必须安装 devDependencies（typescript、vite 等），否则 npm run build 会失败
# Zeabur 可能在构建时注入 NODE_ENV=production，导致 npm ci 跳过 devDependencies
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# 构建生产版本
COPY . .
RUN npm run build

# 生产阶段：Nginx 提供静态文件 + 反向代理后端 API
FROM nginx:alpine

# 复制构建产物
COPY --from=build /app/dist /usr/share/nginx/html

# 复制 Nginx 配置（放在普通路径，不走默认 template 机制）
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 默认后端地址（Zeabur 部署时会被环境变量覆盖）
ENV BACKEND_URL=https://lidar-backend.zeabur.app

EXPOSE 8080

# 关键：启动时用 envsubst 精确替换 BACKEND_URL，保留 Nginx 内置变量
# 如果不用 envsubst '变量名' 限定范围，所有 $xxx 会被清空 → 代理失效 → 502
CMD ["/bin/sh", "-c", "envsubst '${BACKEND_URL}' < /etc/nginx/conf.d/default.conf > /tmp/nginx.conf && mv /tmp/nginx.conf /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
