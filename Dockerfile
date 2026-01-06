# 使用 Node.js LTS Slim 作为基础镜像
FROM node:lts-slim

# 设置维护者信息
LABEL maintainer="Joye" 

# 设置工作目录
WORKDIR /app

# 设置 Debian 镜像源（配置多个备选镜像源，使用 HTTP 避免证书问题）
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      echo "Types: deb" > /etc/apt/sources.list.d/debian.sources && \
      echo "URIs: http://mirrors.cloud.tencent.com/debian http://mirrors.aliyun.com/debian" >> /etc/apt/sources.list.d/debian.sources && \
      echo "Suites: bookworm bookworm-updates" >> /etc/apt/sources.list.d/debian.sources && \
      echo "Components: main contrib non-free non-free-firmware" >> /etc/apt/sources.list.d/debian.sources && \
      echo "Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg" >> /etc/apt/sources.list.d/debian.sources && \
      echo "" >> /etc/apt/sources.list.d/debian.sources && \
      echo "Types: deb" >> /etc/apt/sources.list.d/debian.sources && \
      echo "URIs: http://mirrors.cloud.tencent.com/debian-security http://mirrors.aliyun.com/debian-security" >> /etc/apt/sources.list.d/debian.sources && \
      echo "Suites: bookworm-security" >> /etc/apt/sources.list.d/debian.sources && \
      echo "Components: main contrib non-free non-free-firmware" >> /etc/apt/sources.list.d/debian.sources && \
      echo "Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg" >> /etc/apt/sources.list.d/debian.sources; \
    else \
      echo "deb http://mirrors.cloud.tencent.com/debian/ bullseye main contrib non-free" > /etc/apt/sources.list && \
      echo "deb http://mirrors.cloud.tencent.com/debian/ bullseye-updates main contrib non-free" >> /etc/apt/sources.list && \
      echo "deb http://mirrors.cloud.tencent.com/debian-security bullseye-security main contrib non-free" >> /etc/apt/sources.list && \
      echo "" >> /etc/apt/sources.list && \
      echo "deb http://mirrors.aliyun.com/debian/ bullseye main contrib non-free" >> /etc/apt/sources.list && \
      echo "deb http://mirrors.aliyun.com/debian/ bullseye-updates main contrib non-free" >> /etc/apt/sources.list && \
      echo "deb http://mirrors.aliyun.com/debian-security bullseye-security main contrib non-free" >> /etc/apt/sources.list; \
    fi

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 复制 package.json、package-lock.json
COPY package*.json ./

# 设置 npm 配置以优化安装过程
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set fund false \
    && npm config set audit-level moderate

# 全局安装 PM2 和 pm2-logrotate
RUN npm install -g pm2 && pm2 install pm2-logrotate

# 配置 pm2-logrotate
# rotateInterval: '0 0 * * *' 表示每天 0 点执行日志轮转
RUN pm2 set pm2-logrotate:rotateInterval '0 0 * * *' && \
    pm2 set pm2-logrotate:max_size 10G && \
    pm2 set pm2-logrotate:retain 1000 && \
    pm2 set pm2-logrotate:compress false && \
    pm2 set pm2-logrotate:dateFormat YYYY-MM-DD && \
    pm2 set pm2-logrotate:rotateModule true && \
    pm2 set pm2-logrotate:workerInterval 30

# 安装依赖
# 先安装所有依赖（包括开发依赖用于构建）
RUN npm ci --no-audit

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 启动命令 - 根据 NODE_ENV 选择对应的 PM2 配置文件
CMD ["sh", "-c", "if [ \"$NODE_ENV\" = \"production\" ]; then pm2-runtime start pm2.prod.config.js; else pm2-runtime start pm2.dev.config.js; fi"]