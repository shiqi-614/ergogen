# 使用 Node.js 官方镜像
FROM node:14

# 设置工作目录
WORKDIR /usr/src/app

# 从 GitHub 克隆项目
RUN git clone https://github.com/shiqi-614/ergogen .

# 安装依赖
RUN npm install

# 暴露服务端口

# 暴露服务端口
EXPOSE 3001

# 启动应用
CMD ["node", "src/server.js"]

# docker build -t ergogen .
# docker run -p 3001:3001 ergogen
