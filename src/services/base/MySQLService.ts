import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Table } from './database/Table';
import { Database } from './database/Database';
import type { TransactionResult } from './database/Database';
import type { ResultSetHeader } from 'mysql2';
import { DatabaseConfig } from './database';

/**
 * MySQL 服务入口类
 */
@Injectable()
export class MySQLService implements OnModuleDestroy {
  constructor(private readonly config: ConfigService) {
    // 注意：数据库连接采用懒加载模式
    // 只有在实际使用时才会创建连接，且会自动缓存
    // 无需在构造函数中预初始化
  }

  /**
   * 模块销毁时的清理逻辑
   *
   * 关闭所有数据库连接，释放资源
   */
  async onModuleDestroy() {
    await Database.closeAll();
  }

  /**
   * 解析数据库标识字符串
   *
   * 格式: "数据库名::表名"
   * - 如果没有 ::，默认使用 "default"
   * - 如果有 ::，提取数据库名和内容
   *
   * @param statement - 待解析的字符串，如 "db1::users" 或 "users"
   * @param separator - 分隔符，默认 "::"
   * @returns [数据库名, 内容] 元组
   *
   * @example
   * ```typescript
   * stateParse('users') // ['default', 'users']
   * stateParse('db1::users') // ['db1', 'users']
   * stateParse('db1::SELECT * FROM users') // ['db1', 'SELECT * FROM users']
   * stateParse('db1::col::value', '::') // ['db1', 'col::value'] 保留后续的分隔符
   * ```
   *
   * @throws {Error} 如果解析失败
   */
  private stateParse(statement: string, separator = '::'): [string, string] {
    const parts = statement.split(separator);

    // 没有分隔符，使用默认数据库
    if (parts.length === 1) {
      return ['default', parts[0]];
    }

    // 有分隔符，第一部分是数据库名，其余部分是表名
    if (parts.length > 1) {
      const dbName = parts[0];
      parts.shift();
      const tbName = parts.join(separator); // 保留内容中的分隔符

      if (!dbName || !tbName) {
        throw new Error(
          `无法解析语句: "${statement}"，格式应为 "数据库名${separator}表名"`,
        );
      }

      return [dbName, tbName];
    }

    throw new Error(`解析失败: "${statement}"`);
  }

  /**
   * 获取数据库实例
   *
   * 根据数据库名从环境变量或配置文件读取连接信息，创建或获取缓存的数据库实例。
   *
   * 配置优先级：
   * 1. 环境变量 URL 格式：MYSQL_URL_{NAME}
   * 2. 配置对象格式：mysql.{name}
   *
   * @param name - 数据库名称（不区分大小写）
   * @returns Database 实例
   *
   * @example
   * ```typescript
   * // 获取默认数据库（读取 MYSQL_URL_DEFAULT 或 mysql.default）
   * const defaultDb = this.database('default');
   *
   * // 获取 DB1 数据库（读取 MYSQL_URL_DB1 或 mysql.db1）
   * const db1 = this.database('db1'); // 不区分大小写
   * const same = this.database('DB1'); // 相同结果
   *
   * // 使用数据库实例
   * const users = defaultDb.table('users');
   * await defaultDb.query('SELECT * FROM users');
   * ```
   *
   * 环境变量配置示例：
   * ```env
   * MYSQL_URL_DEFAULT=mysql://root:password@localhost:3306/myapp
   * MYSQL_URL_DB1=mysql://user:pass@db-server:3306/orders
   * ```
   *
   * 配置文件配置示例：
   * ```typescript
   * export default {
   *   mysql: {
   *     default: {
   *       host: 'localhost',
   *       port: 3306,
   *       user: 'root',
   *       password: 'password',
   *       database: 'myapp',
   *     },
   *     db1: {
   *       host: 'db-server',
   *       port: 3306,
   *       user: 'user',
   *       password: 'pass',
   *       database: 'orders',
   *     },
   *   },
   * };
   * ```
   *
   * @throws {Error} 如果配置未找到
   */
  public database(name: string): Database {
    const normalizedName = name.toLowerCase();

    // 方式 1：尝试从环境变量读取 URL
    const envKey = `MYSQL_URL_${normalizedName.toUpperCase()}`;
    const url = this.config.get<string>(envKey);

    if (url) {
      return Database.create(url);
    }

    // 方式 2：尝试从配置对象读取
    const configKey = `mysql.${normalizedName}`;
    const config = this.config.get<DatabaseConfig>(configKey);

    if (config) {
      return Database.create(config);
    }

    // 配置未找到
    throw new Error(
      `数据库配置未找到: ${envKey} 或 ${configKey}\n` +
        `请在 .env 文件或配置文件中设置:\n` +
        `  方式 1: ${envKey}=mysql://user:password@host:port/database\n` +
        `  方式 2: 在配置文件中设置 mysql.${normalizedName} 对象`,
    );
  }

  /**
   * 快捷方法：获取表实例
   *
   * 支持多种格式访问表，自动处理数据库连接和表实例缓存。
   *
   * @param id - 表标识，格式: "数据库名::表名" 或 "表名"
   * @param separator - 分隔符，默认 "::"
   * @returns Table 实例
   *
   * @example
   * ```typescript
   * // 访问默认数据库的表
   * const users = this.db.table('users');
   * const sameUsers = this.db.table('default::users'); // 等价
   *
   * // 访问其他数据库的表
   * const orders = this.db.table('db1::orders');
   * const logs = this.db.table('analytics::logs');
   *
   * // 数据库名不区分大小写
   * const orders2 = this.db.table('DB1::orders'); // 相同
   * ```
   *
   * 配置要求：
   * - 使用 'users' 或 'default::users' 需要配置 MYSQL_URL_DEFAULT 或 mysql.default
   * - 使用 'db1::orders' 需要配置 MYSQL_URL_DB1 或 mysql.db1
   */
  public table(id: string, separator = '::'): Table {
    const [dbName, tableName] = this.stateParse(id, separator);
    const db = this.database(dbName);
    return db.table(tableName);
  }

  /**
   * 执行原始 SQL 查询
   *
   * 支持任意 SQL 语句，包括 SELECT、INSERT、UPDATE、DELETE 等。
   * 使用占位符可以防止 SQL 注入攻击。
   *
   * @param statement - SQL 语句，支持 "数据库名::SQL" 格式
   * @param holders - 占位符参数数组
   * @param separator - 分隔符，默认 "::"
   * @returns
   *   - SELECT 返回查询结果数组
   *   - INSERT/UPDATE/DELETE 返回 ResultSetHeader（包含 affectedRows, insertId 等）
   *
   * 注意事项：
   * - 始终使用占位符 `?` 代替直接拼接变量，避免 SQL 注入
   * - SELECT 查询返回数组，INSERT/UPDATE/DELETE 返回 ResultSetHeader
   * - SQL 语句会自动 trim 去除首尾空格
   * - 如果开启了 MYSQL_LOG=on，会自动打印格式化的 SQL 日志
   */
  public async query<T = any>(
    statement: string,
    holders?: any[],
    separator = '::',
  ): Promise<T[] | ResultSetHeader> {
    const [dbName, sql] = this.stateParse(statement, separator);
    const db = this.database(dbName);
    return db.query<T>(sql.trim(), holders);
  }

  /**
   * 执行数据库事务
   *
   * 事务保证一组数据库操作的原子性：
   * - 所有操作成功则提交（commit）
   * - 任一操作失败则回滚（rollback）
   *
   * @param callback - 事务回调函数，包含事务内的所有操作
   * @param dbname - 数据库名称，默认 "default"
   * @returns 回调函数的返回值
   *
   * @example
   * ```typescript
   * try {
   *   await this.db.transaction(async () => {
   *     const users = this.db.table('users');
   *
   *     await users.update({
   *       data: { balance: { decrement: 100 } },
   *       where: { id: userId }
   *     });
   *
   *     // 如果余额不足，抛出错误
   *     const user = await users.get({ where: { id: userId } });
   *     if (user.balance < 0) {
   *       throw new Error('余额不足');
   *     }
   *
   *     // ... 其他操作
   *   });
   * } catch (error) {
   *   // 事务已自动回滚，所有操作都被撤销
   *   console.error('事务失败:', error.message);
   * }
   *
   * ```
   *
   * 重要说明：
   * - 事务内的所有数据库操作必须使用同一个数据库
   * - 事务内抛出的任何错误都会导致自动回滚
   * - 回调函数可以是同步或异步的
   * - 事务会在回调函数完成后自动提交
   * - 跨数据库事务需要分别执行（MySQL 不支持跨库事务）
   */
  public async transaction<T = any>(
    callback: () => TransactionResult<T>,
    dbname: string = 'default',
  ): Promise<T> {
    return this.database(dbname).transaction(callback);
  }
}
