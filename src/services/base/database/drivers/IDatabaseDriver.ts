/**
 * 支持的数据库类型
 */
export type DatabaseType = 'mysql' | 'postgresql' | 'sqlite' | 'mssql';

/**
 * 数据库连接配置
 *
 * 支持多种数据库类型的连接配置。
 */
export interface DatabaseConfig {
  /** 数据库类型（默认：mysql） */
  type?: DatabaseType;
  /** 主机地址（MySQL/PostgreSQL/MSSQL） */
  host?: string;
  /** 端口号（MySQL:3306, PostgreSQL:5432, MSSQL:1433） */
  port?: number;
  /** 用户名 */
  user?: string;
  /** 密码 */
  password?: string;
  /** 数据库名 */
  database?: string;
  /** 连接字符串（可选，优先于上述单独配置） */
  connectionString?: string;

  // 自动重连配置
  /** 是否启用自动重连（默认：true） */
  enableKeepAlive?: boolean;
  /** 连接超时时间，毫秒（默认：10000ms） */
  connectTimeout?: number;
  /** 获取连接超时时间，毫秒（默认：10000ms） */
  acquireTimeout?: number;
  /** 查询超时时间，毫秒（默认：60000ms） */
  timeout?: number;
  /** 时区设置（MySQL 专用，默认：+08:00，即 Asia/Shanghai） */
  timezone?: string;

  /** 连接池大小（默认：10） */
  connectionLimit?: number;
  /** 是否等待可用连接（默认：true） */
  waitForConnections?: boolean;
  /** 连接队列限制（默认：0，无限制） */
  queueLimit?: number;
  /** TCP 保活初始延迟，毫秒（默认：0） */
  keepAliveInitialDelay?: number;

  /** 其他数据库特定配置 */
  [key: string]: any;
}

/**
 * 查询结果头信息
 *
 * 用于 INSERT/UPDATE/DELETE 等修改操作的返回值。
 */
export interface ResultHeader {
  /** 受影响的行数 */
  affectedRows: number;
  /** 新插入记录的自增 ID（仅 INSERT 操作） */
  insertId?: number;
  /** 实际改变的行数（MySQL UPDATE 专用） */
  changedRows?: number;
}

/**
 * 数据库驱动抽象接口
 *
 * 定义了所有数据库驱动必须实现的方法。
 * 不同数据库（MySQL、PostgreSQL 等）通过实现此接口来提供统一的操作 API。
 *
 * 实现类：
 * - MySQLDriver - MySQL 数据库驱动
 * - PostgreSQLDriver - PostgreSQL 数据库驱动（计划中）
 * - SQLiteDriver - SQLite 数据库驱动（计划中）
 *
 * @example
 * ```typescript
 * // 实现自定义驱动
 * class CustomDriver implements IDatabaseDriver {
 *   readonly type = 'mysql';
 *
 *   async query<T>(sql: string, params?: any[]): Promise<T[]> {
 *     // 实现查询逻辑
 *   }
 *
 *   async execute(sql: string, params?: any[]): Promise<ResultHeader> {
 *     // 实现执行逻辑
 *   }
 *
 *   // ... 实现其他方法
 * }
 * ```
 */
export interface IDatabaseDriver {
  /**
   * 数据库类型标识
   *
   * 用于区分不同的数据库实现。
   */
  readonly type: DatabaseType;

  /**
   * 执行查询操作（SELECT）
   *
   * @param sql - SQL 查询语句
   * @param params - 占位符参数数组
   * @returns 查询结果数组
   */
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;

  /**
   * 执行命令操作（INSERT, UPDATE, DELETE）
   *
   * @param sql - SQL 命令语句
   * @param params - 占位符参数数组
   * @returns 执行结果头信息（affectedRows, insertId 等）
   */
  execute(sql: string, params?: any[]): Promise<ResultHeader>;

  /**
   * 格式化 SQL 语句（用于日志输出）
   *
   * 将占位符替换为实际参数值，便于调试和日志记录。
   *
   * @param sql - SQL 语句
   * @param params - 参数数组
   * @returns 格式化后的完整 SQL 语句
   */
  format(sql: string, params?: any[]): string;

  /**
   * 开始事务
   *
   * 开启一个新的数据库事务。
   * 后续的 query/execute 操作将在事务中执行，直到调用 commit 或 rollback。
   */
  begin(): Promise<void>;

  /**
   * 提交事务
   *
   * 提交当前事务的所有更改。
   */
  commit(): Promise<void>;

  /**
   * 回滚事务
   *
   * 撤销当前事务的所有更改。
   */
  rollback(): Promise<void>;

  /**
   * 关闭数据库连接
   *
   * 关闭连接池并释放所有资源。调用后驱动实例将失效，需要重新创建。
   */
  close(): Promise<void>;

  /**
   * 测试数据库连接
   *
   * 发送一个简单的查询来测试连接是否正常。
   *
   * @returns 连接是否正常
   */
  ping(): Promise<boolean>;
}

/**
 * 事务回调函数类型
 *
 * 用于 transaction() 方法的回调函数签名。
 * 可以返回任意类型的值或 Promise。
 *
 * @template T - 回调函数的返回值类型
 *
 * @example
 * ```typescript
 * const callback: TransactionCallback<{ success: boolean }> = async () => {
 *   // 执行数据库操作
 *   return { success: true };
 * };
 *
 * const result = await driver.transaction(callback);
 * console.log(result.success); // true
 * ```
 */
export type TransactionCallback<T> = () => Promise<T> | T;
