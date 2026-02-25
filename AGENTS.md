# AGENTS.md — Copilot 指导文件

## 语言约定

- **所有对话、代码注释、commit message、文档均使用中文。**
- 变量名、类名、函数名使用英文，但注释和描述使用中文。

---

## 项目概述

这是一个基于 **NestJS 11** 的后端服务模板项目，使用 TypeScript 编写，采用模块化架构，内置 MySQL、Redis、分布式锁、HTTP 请求等基础服务。

- **运行时**: Node.js (LTS)
- **框架**: NestJS 11 + Express
- **语言**: TypeScript 5.x（目标 ES2016，CommonJS 模块）
- **包管理**: npm
- **部署方式**: Docker / PM2

---

## 项目结构

```
src/
├── main.ts                  # 应用启动入口
├── module.ts                # 根模块 (AppModule)
├── config.ts                # 配置模块 (AppConfig)，支持多环境
├── errors.ts                # 统一错误码定义
├── exception.ts             # 全局异常过滤器 (GlobalExceptionFilter)
├── validation.ts            # 全局验证管道 (ValidationPipe)
├── common/                  # 通用工具和类型
│   ├── types.ts             # 通用类型定义 (ApiResult, PageParams, PageResult 等)
│   ├── Utils.ts             # 工具类（环境判断、响应构建、加密、分页等）
│   └── Log.ts               # 日志工具类
├── configs/                 # 环境配置文件
│   ├── default.ts           # 默认配置（所有环境通用）
│   ├── development.ts       # 开发环境配置
│   └── production.ts        # 生产环境配置
├── controllers/             # 控制器模块（按业务域分组）
│   ├── app/module.ts        # 前台/用户端控制器模块
│   └── admin/module.ts      # 后台/管理端控制器模块
└── services/                # 服务层
    └── base/                # 基础服务模块 (BaseModule)
        ├── module.ts        # 基础服务模块定义
        ├── MySQLService.ts  # MySQL 数据库服务（支持多数据库实例）
        ├── RedisService.ts  # Redis 服务（支持多实例）
        ├── TableService.ts  # 表管理服务（集中管理 Table 实例）
        ├── MutexLock.ts     # 分布式互斥锁（基于 Redis）
        ├── RequestService.ts# HTTP 请求服务（基于 axios）
        ├── database/        # 数据库抽象层
        │   ├── Database.ts  # 数据库连接管理
        │   ├── Table.ts     # 表操作类（链式查询构建器）
        │   ├── type.ts      # 数据库类型定义
        │   ├── dialect/     # SQL 方言
        │   └── drivers/     # 数据库驱动
        └── redis/           # Redis 抽象层
            ├── Redis.ts     # Redis 连接管理
            └── types.ts     # Redis 类型定义
```

---

## 架构规范

### 模块组织

- **根模块** `AppModule` 位于 `src/module.ts`，导入配置模块、定时任务模块和所有控制器业务模块。
- **控制器模块** 按业务域划分，位于 `src/controllers/` 下，每个子目录一个模块（如 `app/`、`admin/`）。
- **基础服务模块** `BaseModule` 位于 `src/services/base/module.ts`，提供 MySQL、Redis、分布式锁、HTTP 请求等通用服务。各控制器模块通过导入 `BaseModule` 获取这些服务。
- 新增业务功能时，应在 `src/controllers/` 下的对应模块中添加控制器和相应的业务服务。
- 若新增通用/共享服务，应放入 `src/services/base/` 并在 `BaseModule` 中注册导出。

### 控制器与服务层命名

- 控制器模块命名：`Ctl{Domain}Module`（如 `CtlAppModule`、`CtlAdminModule`）。
- 控制器类命名：`{Feature}Controller`。
- 服务类命名：`{Feature}Service`。
- 模块文件一律命名为 `module.ts`。

### 配置管理

- 使用 `@nestjs/config` 管理配置，全局可用。
- 配置文件位于 `src/configs/`，支持 `default.ts`（通用）、`development.ts`（开发）、`production.ts`（生产）。
- 环境变量通过 `.env` / `.env.development` / `.env.production` 文件管理。
- 环境特定配置会自动覆盖默认配置。
- 通过 `ConfigService` 注入后使用 `config.get<T>('key')` 读取。

### 数据库（MySQL）

- 使用自封装的 `MySQLService` 管理数据库连接，支持多数据库实例。
- 数据库连接采用**懒加载**模式，首次使用时创建。
- 使用 `"数据库名::表名"` 格式指定库表，默认数据库名为 `default`。
- 表操作通过 `Table` 类完成，支持链式构建查询（find / findAll / add / update / remove 等）。
- 集中在 `TableService` 中注册和管理表实例。
- 配置方式：环境变量 `MYSQL_URL_{NAME}` 或配置对象 `mysql.{name}`。

### Redis

- 使用自封装的 `RedisService`，底层为 node-redis。
- 支持多实例管理，通过 `redis.client(name?)` 获取原生客户端。
- 配置方式：环境变量 `REDIS_URL_{NAME}` 或配置对象 `redis.{name}`。

### 分布式锁

- `MutexLock` 服务提供基于 Redis 的分布式互斥锁。
- 支持自动续租、安全释放（owner 校验）、模块销毁自动清理。

---

## API 响应规范

### 统一响应格式

所有 API 接口统一使用 `ApiResult<T>` 格式返回：

```typescript
interface ApiResult<T = any> {
  data: T;        // 响应数据
  message: string; // 响应消息
  code: number;   // 响应码：0 表示成功，非 0 表示失败
}
```

- 成功响应使用 `Utils.json(data)` 或 `Utils.success(data)` 构建。
- 错误响应使用 `Utils.error(code, message)` 抛出。
- 所有业务异常均以 HTTP 200 状态码返回，通过 `code` 字段区分成功/失败。

### 错误码

- 错误码定义在 `src/errors.ts` 中，格式为 `[number, string]` 元组。
- 新增错误码时请在 `Errors` 对象中添加。

### 分页

- 分页参数使用 `PageParams`（page 从 1 开始，pageSize）。
- 分页结果使用 `PageResult<T>`（含 list、total、page、pageSize、totalPages）。

---

## 异常处理

- 全局异常过滤器 `GlobalExceptionFilter` 已注册，捕获所有异常。
- HTTP 200 状态的 `HttpException`：视为业务异常，返回 JSON 格式的 `ApiResult`。
- 非 200 状态的 `HttpException`：视为 HTTP 错误，返回 text/html 错误页。
- 未捕获异常：返回 500 错误。
- **不要**在控制器中手动 try-catch 后返回错误响应，应使用 `Utils.error()` 抛出。

---

## 验证

- 全局 `ValidationPipe` 已注册，使用 `class-validator` + `class-transformer`。
- DTO 验证自动启用白名单模式（`whitelist: true`），未定义属性会被自动移除。
- 启用隐式类型转换（`enableImplicitConversion: true`）。
- 只返回第一个验证错误（`stopAtFirstError: true`）。
- 新建 DTO 时使用 `class-validator` 装饰器，放在对应控制器目录或共享目录中。

---

## 代码风格

### 通用规则

- 使用 Prettier 格式化代码（`npm run format`）。
- 使用 TypeScript 严格空检查（`strictNullChecks: true`）。
- 类和方法添加 JSDoc 中文注释，描述用途、参数和返回值。
- 优先使用 `class` + 依赖注入模式，符合 NestJS 设计理念。
- 工具方法放在 `Utils` 静态类中，日志使用 `Log` 类。

### 导入规范

- NestJS 相关导入在最前，第三方库次之，项目内部模块最后。
- 项目内部使用路径别名 `src/` 前缀（如 `import { Log } from 'src/common/Log'`）。

### 装饰器使用

- 控制器使用 `@Controller()` 装饰器定义路由前缀。
- 服务使用 `@Injectable()` 装饰器标记。
- 模块使用 `@Module()` 装饰器，明确声明 `imports`、`controllers`、`providers`、`exports`。
- API 文档使用 `@nestjs/swagger` 的装饰器（`@ApiTags`、`@ApiOperation`、`@ApiProperty` 等）。

---

## Swagger 文档

- 仅在非生产环境自动启用 Swagger UI，访问路径为 `/__api__`。
- 新增控制器时，应使用 `@ApiTags()` 标注分类，使用 `@ApiOperation()` 描述接口。
- DTO 的属性使用 `@ApiProperty()` 添加描述、示例值和类型信息。
- 如需将新增模块纳入文档，需在 `main.ts` 的 `SwaggerModule.createDocument` 的 `include` 数组中添加。

---

## 开发流程

### 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 以 watch 模式启动开发服务器 |
| `npm run build` | 构建生产产物到 `dist/` |
| `npm run start` | 以开发环境启动（不带 watch） |
| `npm run prod` | 以生产模式运行（需先 build） |
| `npm run format` | 使用 Prettier 格式化代码 |
| `npm run pm2:dev` | 以 PM2 开发模式启动 |
| `npm run pm2:prod` | 以 PM2 生产模式启动 |

### 环境变量

- `NODE_ENV`：运行环境（`development` / `production`），通过 `cross-env` 设置。
- `PORT`：服务端口号（默认 3001）。
- 数据库、Redis 等连接信息通过 `.env` 文件配置。

### 新增功能指南

1. **新增 API 接口**：
   - 在 `src/controllers/{domain}/` 下创建控制器文件。
   - 在对应的模块 `module.ts` 中注册控制器。
   - 如需业务服务，创建 Service 并在模块中声明 providers。

2. **新增数据表操作**：
   - 在 `TableService` 中添加表实例属性。
   - 使用 `this.db.table('表名')` 或 `this.db.table('库名::表名')` 创建。

3. **新增配置项**：
   - 在 `src/configs/default.ts` 中添加默认值。
   - 在环境特定配置文件中添加覆盖值（如 `development.ts`、`production.ts`）。
   - 也可在 `.env` / `.env.development` / `.env.production` 文件中通过环境变量添加配置。
   - 通过 `ConfigService.get()` 读取。

4. **新增全局错误码**：
   - 在 `src/errors.ts` 的 `Errors` 对象中添加 `[code, message]` 元组。

---

## NestJS 通用最佳实践

### 依赖注入

- 始终通过构造函数注入依赖，避免手动实例化服务。
- 使用 `@Injectable()` 标记所有服务类。
- 需要跨模块使用的服务必须在模块的 `exports` 中导出。

### 模块设计

- 保持模块职责单一，避免"上帝模块"。
- 全局模块（如配置）使用 `isGlobal: true` 或 `forRoot()` 模式。
- 共享服务封装在独立模块中，需要时导入。

### 控制器

- 控制器应保持轻量，只负责接收请求和返回响应。
- 业务逻辑应放在服务层中。
- 使用 DTO（Data Transfer Object）验证和转换请求参数。
- 路由方法使用 `@Get()`、`@Post()`、`@Put()`、`@Delete()` 等装饰器。

### 生命周期

- 实现 `OnModuleDestroy` 接口清理资源（数据库连接、Redis 连接等）。
- 使用 `@nestjs/schedule` 的 `@Cron()`、`@Interval()` 管理定时任务。
