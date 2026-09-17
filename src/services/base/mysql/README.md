# MySQL

仅支持 MySQL，不提供多数据库驱动接口或方言继承。

## 结构

- `Database.ts`：缓存数据库与表实例，提供查询、写入和事务入口。
- `MySQLDriver.ts`：统一执行 SQL、记录日志、选择事务连接，管理 mysql2 连接池和健康检查。
- `SQLBuilder.ts`：构建 MySQL SQL 和占位参数。
- `Table.ts`：提供 `get`、`gets`、`add`、`adds`、`update`、`remove`、`count`、`exists`、`upsert`。
- `type.ts`：连接配置、查询条件和结果数据类型，不包含驱动接口。
- `index.ts`：统一导出。

职责边界：`MySQLService` 负责 Nest 配置与具名库路由，`Database` 负责实例和表缓存，
`Table` 负责表级操作与结果上下文，`SQLBuilder` 只生成 SQL，`MySQLDriver` 统一负责执行。
HTTP 请求的结果上下文由 `BaseModule` 注册，根模块不需要了解 MySQL 内部实现。
不增加驱动接口、工厂或继承层次；`Database` 与 `Table` 都直接使用具体驱动。

## 使用

```typescript
import { Database } from 'src/services/base/mysql';

const db = Database.create({
  host: '127.0.0.1',
  user: 'app',
  password: process.env.MYSQL_PASSWORD,
  database: 'app',
  timezone: '+08:00',
});
const users = db.table('users');
const user = await users.get({ where: { id: 1 } });

await db.transaction(async () => {
  await users.update({ data: { score: { increment: 1 } }, where: { id: 1 } });
});
```

NestJS 中注入 `MySQLService`，配置来自 `MYSQL_URL_{NAME}` 或 `mysql.{name}`。
表标识支持 `库名::表名`，省略库名时使用 `default`。`TableService` 直接注入此服务。
创建实例只创建懒连接池，首次查询才连接 MySQL；相同配置复用实例，不同的时区或连接池配置不会共用实例。
`MySQLService.query()` 用于查询行集，`execute()` 用于写入并返回 `affectedRows`、`insertId`；
两者均支持“库名::SQL”格式并自动加入当前实例的事务。
`SHOW_SQL_LOG=on` 时由驱动统一记录业务 SQL，上层无需重复记录。

## 行为约定

- `DatabaseConfig` 复用 mysql2 的已支持选项类型，不接受数据库类型或其他数据库的专用配置。
- 默认时区为 `+08:00`，`Date` 直接交给 mysql2 按连接时区处理。
- 连接串必须使用 `mysql:` 协议。URI 参数和配置对象中的显式值均优先于默认配置，包括 `false` 和 `0`；对象中的 `undefined` 视为未设置。URI 示例：`mysql://user:password@localhost/app?timezone=Z&connectionLimit=3&waitForConnections=false`。时区中的加号需编码，例如 `timezone=%2B08%3A00`。
- `adds()` 的 `insertId` 是首条记录的自增 ID，不是末条。
- 固定禁用 `FOUND_ROWS`，这是结果语义约束而非可覆盖的默认值：`update()` 的 `affectedRows` 表示实际变化行数，匹配但未变化时为 `0`。
- `upsert()` 使用 `ON DUPLICATE KEY UPDATE`，任何主键或唯一索引冲突都可能触发更新；`uniqueKeys` 仅排除不应更新的字段，不限定冲突目标。存在多个唯一索引时应确认业务语义。
- UPSERT 的 `affectedRows` 为 `1` 时表示插入，为 `2` 时表示更新，为 `0` 时表示无变化；后两种返回 `action: 'update'`。
- 支持 `INNER`、`LEFT`、`RIGHT`、`CROSS JOIN`，不支持 `FULL JOIN`。
- `transaction()` 使用独立连接和异步上下文隔离，嵌套调用加入外层事务，不创建保存点。优先使用回调事务，手动 `begin/commit/rollback` 仅保留兼容用途，不适合并发请求。
- 事务回调结束时立即清除上下文中的连接引用，随后提交或回滚并释放连接。回调中创建的延迟任务不能继续使用已结束事务，查询、写入或嵌套事务会明确报错，不会静默回退到连接池。
- 事务中的数据库 Promise 必须在回调返回前全部等待完成；上下文清理不会取消已经发给服务器的 SQL。事务内 `ping()` 使用当前事务连接，结束后的上下文调用返回 `false`。
- 不同 `Database` 实例不共享事务；同一 MySQL 连接可以操作同一服务器上的多个 InnoDB 库，不能将“多个连接实例”误认为“同连接跨库”。
- 业务 SQL 失败不会自动重放，避免响应丢失时重复写入；仅健康检查支持重试。

## 最后操作结果与并发

`getLastResult()` 保留，但只读取当前异步上下文中当前表最后完成的成功写操作结果。
HTTP 请求由 `BaseModule` 自动建立独立上下文，可在该请求调用链中的任意服务读取。
查询和失败写入不会清除已有结果；空数据更新会记录 `affectedRows: 0`。
这不是事务提交状态，回滚不会撤销已记录的语句结果。

脚本、定时任务、队列消费者等非 HTTP 入口需包裹完整流程：

```typescript
import { Table } from 'src/services/base/mysql';

await Table.withResultContext(async () => {
  await users.add({ name: '张三' });
  const result = users.getLastResult();
  console.log(result?.insertId);
});
```

同一上下文里的并行操作共享“最后完成”的语义；若每个并行分支需要自己的最后结果，应分别建立子上下文：

```typescript
await Promise.all(names.map(name => Table.withResultContext(async () => {
  await users.add({ name });
  return users.getLastResult();
})));
```

- 子上下文初始为空，不继承或覆盖父上下文的结果。
- 未建立上下文、尚未成功写入或上下文已结束时，`getLastResult()` 返回 `undefined`；写操作本身仍正常返回结果。
- 上下文只用 `WeakMap` 保存每个表的一份最新结果，不保存操作历史，也不强引用表实例。
- 任务完成或抛错后主动释放结果容器；HTTP 在响应完成或连接关闭时释放并移除生命周期监听器。
- 即使遗留定时器或回调仍持有已结束上下文，也不能读取旧结果或重新写入结果容器。它们自身的资源仍需业务代码清理。
- 脱离请求生命周期的后台工作应建立自己的上下文，不依赖已结束请求的结果。

## 迁移与验证

旧导入路径改为 `src/services/base/mysql`；`Database.create()` 不再接受第二个数据库类型参数。
`getDialect()` 改为 `getBuilder()`，需要构建 SQL 时直接使用 `SQLBuilder`。
旧的数据库服务令牌、驱动接口及多数据库实现已删除，业务服务直接注入 `MySQLService`。

```bash
npm run test:mysql
npm run test:compatibility
npm run test:command-safety
npm run build
```

测试使用连接池替身验证 SQL、配置缓存、结果映射和并发事务路由，无需外部数据库；不替代真实 MySQL 服务的集成测试。