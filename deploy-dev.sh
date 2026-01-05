#!/bin/bash

# 开发环境部署脚本
set -e

# 配置变量
HOST_PORT="8708"
PROJECT_NAME="example.com"
HOST_LOG_DIR="/data/logs/service/${PROJECT_NAME}"

# 1. 构建新镜像
echo "📦 构建镜像..."
podman build -t "${PROJECT_NAME}" -f Dockerfile .

# 2. 停止并删除旧容器
echo "🛑 清理旧容器..."
podman stop "${PROJECT_NAME}" 2>/dev/null || true
podman rm "${PROJECT_NAME}" 2>/dev/null || true

# 3. 创建日志目录
echo "📁 创建日志目录..."
mkdir -p "${HOST_LOG_DIR}"

# 4. 启动新容器
echo "🎯 启动新容器..."
podman run -d \
  --name "${PROJECT_NAME}" \
  --restart=unless-stopped \
  -p "${HOST_PORT}:3001" \
  -v "${HOST_LOG_DIR}:/logs" \
  -e NODE_ENV=development \
  -e TZ=Asia/Shanghai \
  "${PROJECT_NAME}"

echo "✅ 开发环境部署完成!"
echo "🌐 访问地址: http://localhost:${HOST_PORT}"
echo "📋 查看日志: podman logs -f ${PROJECT_NAME}"