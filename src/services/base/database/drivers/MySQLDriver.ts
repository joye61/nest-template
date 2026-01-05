import {
  Pool,
  PoolConnection,
  ResultSetHeader,
  createPool,
} from 'mysql2/promise';
import {
  IDatabaseDriver,
  ResultHeader,
  DatabaseConfig,
  TransactionCallback,
} from './IDatabaseDriver';
import { Log } from 'src/common/Log';

/**
 * MySQL 驱动实现
 *
 * 功能：
 * - 管理 MySQL 连接池
 * - 支持自动重连机制（3 次重试 + 指数退避）
 * - 事务管理（begin/commit/rollback）
 * - SQL 查询和执行
 * - 连接池状态监控
 *
 * 重连策略：
 * 1. 第一次失败：直接重试（可能是临时网络抖动）
 * 2. 第二次失败：重建连接池后重试（数据库可能已恢复）
 * 3. 第三次失败：彻底放弃，抛出错误
 *
 * @example
 * ```typescript
 * // 通常不直接使用，而是通过 Database 类
 * const driver = new MySQLDriver('mysql://root:password@localhost:3306/myapp');
 *
 * // 查询
 * const rows = await driver.query('SELECT * FROM users WHERE id = ?', [1]);
 *
 * // 执行命令
 * const result = await driver.execute('INSERT INTO users (name) VALUES (?)', ['John']);
 *
 * // 事务
 * await driver.begin();
 * try {
 *   await driver.execute('UPDATE ...');
 *   await driver.commit();
 * } catch (error) {
 *   await driver.rollback();
 * }
 * ```
 */
export class MySQLDriver implements IDatabaseDriver {
  readonly type = 'mysql' as const;

  private pool: Pool;
  private connection?: PoolConnection; // 事务连接
  private readonly config: DatabaseConfig | string; // 保存配置用于重连
  private isPoolDead = false; // 连接池失效标记
  private rebuildLock: Promise<void> | null = null; // 重建锁（防止并发重建）

  /**
   * 创建 MySQL 连接池，支持连接字符串或配置对象。
   *
   * @param config - 连接字符串或配置对象
   *
   * @example
   * ```typescript
   * // 使用连接字符串
   * const driver = new MySQLDriver('mysql://root:password@localhost:3306/myapp');
   *
   * // 使用配置对象（推荐）
   * const driver = new MySQLDriver({
   *   host: 'localhost',
   *   port: 3306,
   *   user: 'root',
   *   password: 'password',
   *   database: 'myapp',
   *   connectionLimit: 10,      // 连接池大小（默认：10）
   *   enableKeepAlive: true,    // 启用保活（默认：true）
   *   connectTimeout: 10000,    // 连接超时（默认：10秒）
   *   waitForConnections: true, // 等待可用连接（默认：true）
   *   queueLimit: 0             // 队列限制（默认：0，无限制）
   * });
   * ```
   */
  constructor(config: DatabaseConfig | string) {
    this.config = config;
    this.pool = this.createPool(config);
  }

  /**
   * 创建连接池（内部方法）
   *
   * 配置自动重连和保活机制。
   *
   * 默认配置说明：
   * - enableKeepAlive: 启用 TCP 保活，自动检测死连接
   * - keepAliveInitialDelay: 0 表示立即开始保活检测
   * - connectTimeout: 连接超时 10 秒
   * - waitForConnections: true 表示队列等待而不是立即失败
   * - connectionLimit: 默认连接池大小 10
   * - timezone: 设置时区为 +08:00（Asia/Shanghai），避免时间偏差
   */
  private createPool(config: DatabaseConfig | string): Pool {
    const poolConfig = {
      // TCP 保活配置（检测连接是否存活）
      enableKeepAlive: true, // 启用 TCP keepalive
      keepAliveInitialDelay: 0, // 立即开始保活检测

      // 连接超时配置
      connectTimeout: 10000, // 连接超时：10秒

      // 连接池行为
      waitForConnections: true, // 等待可用连接
      queueLimit: 0, // 无限队列
      connectionLimit: 10, // 默认连接池大小

      // 时区配置（重要！避免 Date 类型数据时差问题）
      timezone: '+08:00', // 使用上海时区（UTC+8）
    };

    if (typeof config === 'string') {
      // 使用连接字符串
      return createPool({
        uri: config,
        ...poolConfig,
      });
    }

    // 使用配置对象，支持用户覆盖默认值
    return createPool({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,

      // 应用默认配置，但允许用户覆盖
      ...poolConfig,
      enableKeepAlive: config.enableKeepAlive !== false,
      connectTimeout: config.connectTimeout || poolConfig.connectTimeout,
      connectionLimit: config.connectionLimit || poolConfig.connectionLimit,
      timezone: config.timezone || poolConfig.timezone, // 允许用户覆盖时区

      // 其他用户自定义配置（排除不兼容的选项）
      ...(config.waitForConnections !== undefined && {
        waitForConnections: config.waitForConnections,
      }),
      ...(config.queueLimit !== undefined && { queueLimit: config.queueLimit }),
      ...(config.keepAliveInitialDelay !== undefined && {
        keepAliveInitialDelay: config.keepAliveInitialDelay,
      }),
    });
  }

  /**
   * 获取原始连接池（高级用法）
   *
   * 返回 mysql2 的原始连接池对象，用于特殊操作。
   *
   * @example
   * ```typescript
   * const pool = driver.getPool();
   *
   * // 执行特殊查询
   * const [rows] = await pool.query('SHOW TABLES');
   *
   * // 获取连接池状态
   * console.log('总连接数:', pool.pool._allConnections.length);
   * console.log('空闲连接数:', pool.pool._freeConnections.length);
   * ```
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * 检查错误是否为连接错误
   *
   * 识别可重试的连接相关错误，用于决定是否触发重连机制。
   *
   * @param error - 错误对象
   * @returns 是否为可重试的连接错误
   */
  private isConnectionError(error: any): boolean {
    if (!error) return false;

    // MySQL 连接错误代码列表
    const connectionErrorCodes = [
      'PROTOCOL_CONNECTION_LOST', // 连接丢失
      'ECONNREFUSED', // 连接被拒绝
      'ECONNRESET', // 连接重置
      'ETIMEDOUT', // 连接超时
      'EHOSTUNREACH', // 主机不可达
      'ENETUNREACH', // 网络不可达
      'EPIPE', // 管道断开
    ];

    // 检查错误代码或错误消息
    return (
      connectionErrorCodes.includes(error.code) ||
      error.message?.includes('Connection lost') ||
      error.message?.includes('Connection closed')
    );
  }

  /**
   * 重建连接池
   *
   * 当检测到连接池完全失效时，销毁旧连接池并创建新的。
   * 使用互斥锁确保多个并发请求只触发一次重建。
   *
   * 注意：使用 async/await 时，如果没有锁机制，多个请求可能同时触发重建，
   * 导致创建多个连接池，浪费资源并可能引发问题。
   */
  private async recreatePool(): Promise<void> {
    // 如果已经有重建任务在进行，等待它完成
    if (this.rebuildLock) {
      return this.rebuildLock;
    }

    // 创建重建任务
    this.rebuildLock = (async () => {
      try {
        // 关闭旧连接池（不等待，避免卡住）
        this.pool.end().catch(() => {
          // 忽略关闭错误
        });

        // 创建新连接池
        this.pool = this.createPool(this.config);
        this.isPoolDead = false;

        Log.v('[MySQLDriver] 连接池重建成功');
      } catch (error) {
        Log.e('[MySQLDriver] 连接池重建失败:', error);
        throw error;
      }
    })();

    try {
      await this.rebuildLock;
    } finally {
      // 重建完成后释放锁
      this.rebuildLock = null;
    }
  }

  /**
   * 自动重试执行函数（支持连接池重建）
   *
   * 策略：
   * 1. 第一次失败：直接重试（可能是临时网络抖动）
   * 2. 第二次失败：重建连接池后重试（数据库可能已恢复）
   * 3. 第三次失败：彻底放弃，抛出错误
   *
   * @param operation - 要执行的操作
   * @returns 操作结果
   *
   * @throws {Error} 如果 3 次尝试都失败，抛出最后一次的错误
   */
  private async retryOnConnectionError<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    // 如果在事务中，不能重试（事务必须使用固定连接）
    if (this.connection) {
      return operation();
    }

    let lastError: any;
    let consecutiveErrors = 0;

    // 最多重试 2 次（共执行 3 次）
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // 如果连接池已标记为失效，先重建
        if (this.isPoolDead && attempt > 1) {
          await this.recreatePool();
        }

        const result = await operation();

        // 成功后重置错误计数
        consecutiveErrors = 0;
        this.isPoolDead = false;

        return result;
      } catch (error) {
        lastError = error;

        // 检查是否为连接错误
        if (!this.isConnectionError(error)) {
          throw error; // 非连接错误，直接抛出
        }

        consecutiveErrors++;

        // 只有连续多次失败才标记连接池失效
        // 单次连接错误可能只是个别连接的问题,不应影响整个池
        if (consecutiveErrors >= 2) {
          this.isPoolDead = true;
        }

        // 最后一次尝试失败，抛出错误
        if (attempt === 3) {
          Log.e('[MySQLDriver] 重试 3 次后仍然失败，放弃操作');
          throw error;
        }

        // 等待一小段时间再重试（指数退避）
        const delay = attempt === 1 ? 100 : 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * 执行查询操作（SELECT）
   *
   * 支持自动重连：当检测到连接错误时，会自动重试一次。
   *
   * @param sql - SQL 查询语句
   * @param params - 占位符参数
   * @returns 查询结果数组
   */
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.retryOnConnectionError(async () => {
      const executor = this.connection || this.pool;
      const result = await executor.query(sql, params);
      return result[0] as T[];
    });
  }

  /**
   * 执行命令操作（INSERT, UPDATE, DELETE）
   *
   * 支持自动重连：当检测到连接错误时，会自动重试一次。
   *
   * @param sql - SQL 命令语句
   * @param params - 占位符参数
   * @returns 执行结果 { affectedRows, insertId? }
   */
  async execute(sql: string, params?: any[]): Promise<ResultHeader> {
    return this.retryOnConnectionError(async () => {
      const executor = this.connection || this.pool;
      const result = await executor.execute(sql, params);
      const header = result[0] as ResultSetHeader;

      return {
        affectedRows: header.affectedRows,
        insertId: header.insertId > 0 ? header.insertId : undefined,
      };
    });
  }

  /**
   * 格式化 SQL 语句（用于日志输出）
   *
   * 将占位符替换为实际参数值，便于查看完整的 SQL。
   *
   * @param sql - SQL 语句
   * @param params - 参数
   * @returns 格式化后的 SQL
   *
   * @example
   * ```typescript
   * const formatted = driver.format(
   *   'SELECT * FROM users WHERE id = ? AND age > ?',
   *   [123, 18]
   * );
   * // 结果: "SELECT * FROM users WHERE id = 123 AND age > 18"
   * ```
   */
  format(sql: string, params?: any[]): string {
    return this.pool.format(sql, params);
  }

  /**
   * 开始事务
   *
   * 获取一个数据库连接并开启事务。
   * 后续的 query/execute 操作会使用这个连接。
   *
   * @throws {Error} 如果事务已经开始
   */
  async begin(): Promise<void> {
    if (this.connection) {
      throw new Error('事务已经开始，不能重复开启');
    }
    this.connection = await this.pool.getConnection();
    await this.connection.beginTransaction();
  }

  /**
   * 提交事务
   *
   * 提交所有更改并释放数据库连接。
   *
   * @throws {Error} 如果没有活动的事务
   */
  async commit(): Promise<void> {
    if (!this.connection) {
      throw new Error('没有活动的事务可以提交');
    }
    await this.connection.commit();
    this.connection.release();
    this.connection = undefined;
  }

  /**
   * 回滚事务
   *
   * 撤销所有更改并释放数据库连接。
   *
   * @throws {Error} 如果没有活动的事务
   */
  async rollback(): Promise<void> {
    if (!this.connection) {
      throw new Error('没有活动的事务可以回滚');
    }
    await this.connection.rollback();
    this.connection.release();
    this.connection = undefined;
  }

  /**
   * 关闭连接池
   *
   * 关闭所有连接并释放资源。调用后该 Driver 实例将失效。
   *
   * @example
   * ```typescript
   * const driver = new MySQLDriver('mysql://...');
   * // 使用驱动...
   * await driver.close(); // 应用关闭时清理
   * ```
   */
  async close(): Promise<void> {
    // 如果有活动的事务连接，先释放
    if (this.connection) {
      this.connection.release();
      this.connection = undefined;
    }

    // 关闭连接池
    await this.pool.end();
  }

  /**
   * 测试数据库连接
   *
   * 发送简单的查询测试连接是否正常。
   * 如果连接失败，会尝试重建连接池。
   *
   * @returns 连接是否正常
   *
   * @example
   * ```typescript
   * const driver = new MySQLDriver('mysql://...');
   *
   * if (await driver.ping()) {
   *   console.log('数据库连接正常');
   * } else {
   *   console.error('数据库连接失败');
   * }
   * ```
   */
  async ping(): Promise<boolean> {
    try {
      await this.retryOnConnectionError(async () => {
        await this.pool.query('SELECT 1');
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 执行事务（便捷方法）
   *
   * 自动管理事务的开始、提交和回滚。
   *
   * @param callback - 事务回调函数
   * @returns 回调函数的返回值
   *
   * @example
   * ```typescript
   * const result = await driver.transaction(async () => {
   *   await driver.execute('UPDATE users SET balance = balance - 100 WHERE id = ?', [1]);
   *   await driver.execute('UPDATE users SET balance = balance + 100 WHERE id = ?', [2]);
   *   return { success: true };
   * });
   * ```
   */
  async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    await this.begin();
    try {
      const result = await callback();
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }
}
