# 前端 Dockerfile - React + Vite 多阶段构建 + Nginx 反向代理
# 构建阶段：编译 React 静态文件
FROM node:20-alpine AS build

WORKDIR /app

# 安装依赖（利用 Docker 缓存层）
COPY package.json package-lock.json* ./
RUN npm ci

# 构建生产版本
COPY . .
RUN npm run build

# 生产阶段：Nginx 提供静态文件 + 反向代理后端 API
FROM nginx:alpine

# 复制构建产物
COPY --from=build /app/dist /usr/share/nginx/html

# 使用 nginx 官方模板机制：放在 templates/ 目录下的 *.template 文件
# 启动时会被 envsubst 处理，将 ${BACKEND_URL} 替换为环境变量值
# 输出到 /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/templates/default.conf.template

# 默认后端地址（本地构建时使用，Render 部署会覆盖为后端公网 URL）
ENV BACKEND_URL=http://localhost:3001

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
