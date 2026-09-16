# 模块约定

- 约定每个模块的配置文件位于根目录的 `module.ts` 中

## 开发与验证

- 运行环境：Node.js >= 22.13.0，建议使用 Node.js 24 LTS。
- 安装依赖：`npm ci`。
- 生产构建：`npm run build`，输出入口为 `dist/main.js`。
- 回归测试：`npm test`，覆盖 Nest HTTP/Swagger/参数验证、内存 SQLite 和验证码生成；无需外部 MySQL 或 Redis。
- 安全审计：`npm audit --registry=https://registry.npmjs.org`，npm 镜像可能不支持审计接口。

## 依赖兼容性

- 依赖升级至 2026-09-05 的最新稳定版，主要包括 NestJS 12、Redis 6 和 class-validator 0.15。
- TypeScript 使用最新兼容版本 6.0.3：7.0.2 不提供 Nest CLI 和 ts-node 所需的编译器 API，因此暂不升级到 7；待上游支持后再升级。
- TypeScript 配置显式声明 Node 类型、`src/*` 路径映射和生产构建的 `rootDir`，不再使用已弃用的 `baseUrl`。
