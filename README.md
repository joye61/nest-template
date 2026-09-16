# 模块约定

- 约定每个模块的配置文件位于根目录的 `module.ts` 中

## 开发与验证

- 运行环境：Node.js `^22.22.3 || ^24.15.0 || >=26.0.0`（与 Nest schematics 要求一致），建议使用 Node.js 24 LTS。
- 安装依赖：`npm ci`。
- 生产构建：`npm run build`，输出入口为 `dist/main.js`。
- 回归测试：`npm test`，覆盖 Nest HTTP/Swagger/参数验证、客户端 IP 信任边界、内存 SQLite、分布式锁、命令响应丢失和验证码生成；无需外部 MySQL 或 Redis。锁与响应丢失测试使用内存替身，不替代真实服务集成测试。
- 安全审计：`npm audit --registry=https://registry.npmjs.org`，npm 镜像可能不支持审计接口。

## 依赖兼容性

- 依赖按 2026-09-16 npm 官方 registry 的 `latest` 标签更新（TypeScript 除外），包括 NestJS 核心 12.0.3、CLI 12.0.1、schematics 12.0.2、schedule 12.0.2 和 mysql2 3.24.4；其他依赖已是最新版。
- TypeScript 使用最新兼容版本 6.0.3：实测 7.0.2 构建失败，Nest CLI 12.0.1 明确提示其不提供所需的编译器 API；ts-node 同样依赖此 API，待上游支持后再升级。
- `@types/node` 对齐当前 `latest` 标签 22.20.3，避免使用高于最低受支持运行时的 Node.js 26 类型。
- TypeScript 配置显式声明 Node 类型、`src/*` 路径映射和生产构建的 `rootDir`，不再使用已弃用的 `baseUrl`。

## 安全与可靠性

- `Utils.ip()` 使用 Express 的 `req.ip`，默认不信任客户端提交的代理头。反向代理部署时，在 `src/main.ts` 中通过 `app.set('trust proxy', 可信代理地址或网段)` 配置实际代理，由代理正确设置 `X-Forwarded-For`；不要无条件设置为 `true`。不再直接读取 `X-Real-IP`、`CF-Connecting-IP` 等可伪造请求头。
- MySQL 的 `query()` / `execute()` 和 Redis 命令不再自动重放失败请求。连接断开或超时可能意味着服务端已执行但响应丢失，调用方应按幂等键、唯一约束或业务状态核对结果后再决定重试。连接恢复、健康检查和 Redis 命令超时保护仍保留。
- 分布式锁续租记录按 Redis 实例名和锁名隔离，支持不同实例上的同名锁。续租失败不会自动终止已运行的任务，关闭自动续租的锁也不在批量释放记录中；资金或库存等强一致性场景还需数据库约束、事务或 fencing token（隔离令牌），不能仅依赖锁 TTL。
- 并发请求优先使用数据库 `transaction(callback)`，避免共享实例上的手动 `begin()` / `commit()` / `rollback()` 串入其他请求。
