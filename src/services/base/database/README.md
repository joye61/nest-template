# 数据库封装

该目录通过驱动与 SQL 方言分层，对外提供统一的 `Database` 和 `Table` API。目前支持 MySQL 与 SQLite。

## 分层职责

- `Database`：实例缓存、驱动与方言装配、原始查询及事务入口。
- `Table`：数据库无关的 CRUD、条件查询、聚合和 UPSERT API。
- `drivers/`：连接生命周期、参数绑定、查询执行和事务隔离。
- `dialect/`：标识符、分页、写操作和 UPSERT 等 SQL 语法生成。
- `type.ts`：查询条件、更新操作符、JOIN 和分页等公共类型。

## 创建连接

```typescript
import { Database } from './database';

const mysql = Database.create('mysql://root:password@localhost:3306/app');

const sqliteMemory = Database.create('sqlite::memory:');
const sqliteFile = Database.create({
  type: 'sqlite',
  filename: './data/app.db',
  timeout: 5000,
  enableForeignKeyConstraints: true,
});
```

在 NestJS 服务中可注入 `SQLiteService`，配置方式与 `MySQLService` 一致：

```env
SQLITE_URL_DEFAULT=sqlite:./data/app.db
SQLITE_URL_ANALYTICS=sqlite:./data/analytics.db
DATABASE_TYPE=sqlite
```

也可以使用配置对象 `sqlite.default`、`sqlite.analytics`。`DATABASE_TYPE=sqlite` 会让 `TableService` 使用 `SQLiteService`；未配置类型时，如果只存在 SQLite 默认配置（`SQLITE_URL_DEFAULT` 或 `sqlite.default`）也会自动选择 SQLite。默认仍使用 MySQL。

`SQLiteService` 会校验配置来源，避免把 `mysql:`、`postgresql:` 或 `mssql:` 连接串误当成 SQLite 文件路径。

字符串连接支持 `mysql:` 和 `sqlite:` 协议自动识别。SQLite 也可使用 `connectionString` 或 `database` 指定文件，但推荐使用语义明确的 `filename`。

SQLite 基于 Node.js 内置 `node:sqlite`，要求 Node.js 22.13 或更高版本，不需要额外安装原生依赖。

## SQLite 差异

- 分页生成 `LIMIT count OFFSET offset`，MySQL 使用 `LIMIT offset, count`。
- 正则条件把公共 API 的 `rlike` 和 `notRlike` 转换为 SQLite `REGEXP`，驱动会注册对应函数。
- UPSERT 使用 `ON CONFLICT (...) DO UPDATE`，冲突字段必须由唯一索引或主键约束覆盖。
- SQLite 无法可靠报告 UPSERT 最终是插入还是更新，因此 `OperationResult.action` 和冲突写入的 `insertId` 保持未定义；`affectedRows` 仍可使用。
- 默认 SQLite 构建不支持 `UPDATE/DELETE ORDER BY LIMIT`。方言使用 `rowid` 子查询保持 `Table.update()` 和 `Table.remove()` 的限量语义，因此限量写操作不适用于 `WITHOUT ROWID` 表。
- `Date` 参数在 SQLite 中保存为 ISO 8601 字符串；MySQL 仍由 `mysql2` 按连接时区处理。

## 事务模型

MySQL 驱动从连接池为每个事务分配连接。SQLite 驱动使用单连接队列，事务回调期间独占连接，事务外请求会等待提交或回滚；嵌套 `transaction()` 自动加入外层事务。

推荐始终使用回调式事务：

```typescript
await db.transaction(async () => {
  await db.table('accounts').update({
    data: { balance: { decrement: 100 } },
    where: { id: 1 },
  });
});
```

## 验证

```bash
npm run test:database:sqlite
npm run build
```