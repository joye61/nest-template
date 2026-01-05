import { Table } from './Table';
import { MySQLDriver } from './drivers/MySQLDriver';
import { MySQLDialect } from './dialect/MySQLDialect';
import {
  IDatabaseDriver,
  DatabaseConfig,
  DatabaseType,
} from './drivers/IDatabaseDriver';
import { BaseDialect } from './dialect/BaseDialect';
import { Log } from 'src/common/Log';

export type TransactionResult<T> = T | Promise<T>;

/**
 * 数据库管理类
 *
 * 职责：
 * - 管理数据库连接池（单例模式）
 * - 提供表实例的创建和缓存
 * - 提供原始 SQL 查询接口
 * - 管理数据库事务
 *
 * 特性：
 * - 单例模式：相同配置只创建一个实例
 * - 表实例缓存：避免重复创建
 * - 自动日志：开启 SHOW_SQL_LOG 时打印 SQL
 * - 优雅关闭：支持释放所有资源
 */
export class Database {
  /**
   * 数据库实例缓存池
   * Key: 配置的 JSON 字符串（确保配置一致性）
   * Value: Database 实例
   *
   * 作用：确保相同连接字符串只创建一个实例，节省连接资源
   */
  private static readonly instances = new Map<string, Database>();

  /**
   * 表实例缓存池
   * Key: 表名
   * Value: Table 实例
   *
   * 作用：避免重复创建 Table 实例，提高性能
   */
  private readonly tables = new Map<string, Table>();

  /**
   * 构造函数（私有）
   *
   * 使用私有构造函数实现单例模式，外部必须通过 Database.create() 创建实例。
   *
   * @param driver - 数据库驱动实例（负责实际的数据库操作）
   * @param dialect - SQL 方言实例（负责生成特定数据库的 SQL 语法）
   */
  private constructor(
    private readonly driver: IDatabaseDriver,
    private readonly dialect: BaseDialect,
  ) {}

  /**
   * 创建或获取数据库实例（单例模式）
   *
   * 根据连接字符串或配置对象创建数据库实例。相同的配置只会创建一次，
   * 后续调用会返回缓存的实例。
   *
   * @param config - 数据库连接字符串或配置对象
   * @param type - 数据库类型（仅在使用字符串时需要，默认 mysql）
   * @returns Database 实例
   *
   * @example
   * ```typescript
   * // ========== 方式 1：使用连接字符串 ==========
   *
   * // MySQL 连接字符串格式
   * const db = Database.create(
   *   'mysql://username:password@hostname:port/database'
   * );
   *
   * // 完整示例
   * const db = Database.create(
   *   'mysql://root:123456@localhost:3306/myapp'
   * );
   *
   * // 带选项的连接字符串
   * const db = Database.create(
   *   'mysql://root:password@localhost:3306/myapp?charset=utf8mb4&timezone=+08:00'
   * );
   *
   *
   * // ========== 方式 2：使用配置对象（推荐）==========
   *
   * // 基础配置（type 默认为 mysql，可省略）
   * const db = Database.create({
   *   host: 'localhost',
   *   port: 3306,
   *   user: 'root',
   *   password: 'password',
   *   database: 'myapp',
   * });
   *
   * // 生产环境配置（推荐）
   * const db = Database.create({
   *   host: process.env.DB_HOST || 'localhost',
   *   port: parseInt(process.env.DB_PORT || '3306'),
   *   user: process.env.DB_USER,
   *   password: process.env.DB_PASSWORD,
   *   database: process.env.DB_NAME,
   *
   *   connectionLimit: 20,        // 连接池大小
   *   queueLimit: 50,             // 等待队列限制
   *   connectTimeout: 10000,
   *   acquireTimeout: 10000,
   *   timeout: 30000,
   * });
   *
   * ```
   *
   * @throws {Error} 如果数据库类型不支持
   */
  public static create(
    config: string | DatabaseConfig,
    type: DatabaseType = 'mysql',
  ): Database {
    const cacheKey = this.generateCacheKey(config, type);

    // 检查缓存，如果已存在则直接返回
    const cached = Database.instances.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 根据类型创建驱动和方言
    const dbType = typeof config === 'string' ? type : (config.type || type);
    const { driver, dialect } = this.createDriverAndDialect(config, dbType);

    // 创建实例并缓存
    const instance = new Database(driver, dialect);
    Database.instances.set(cacheKey, instance);
    
    return instance;
  }

  /**
   * 生成缓存键
   * @param config - 配置
   * @param type - 数据库类型
   * @returns 缓存键
   */
  private static generateCacheKey(
    config: string | DatabaseConfig,
    type: DatabaseType,
  ): string {
    if (typeof config === 'string') {
      return `${type}:${config}`;
    }

    // 提取影响连接池的关键配置（按固定顺序）
    const keyConfig = {
      type: config.type || type,
      host: config.host,
      port: config.port,
      user: config.user,
      database: config.database,
      connectionString: config.connectionString,
      // 连接池配置
      connectionLimit: config.connectionLimit,
      queueLimit: config.queueLimit,
      // 自动重连配置
      enableKeepAlive: config.enableKeepAlive,
      connectTimeout: config.connectTimeout,
      acquireTimeout: config.acquireTimeout,
      timeout: config.timeout,
    };

    // 使用排序后的 JSON 字符串作为缓存键（确保顺序一致）
    return JSON.stringify(keyConfig, Object.keys(keyConfig).sort());
  }

  /**
   * 创建驱动和方言实例
   * @param config - 配置
   * @param type - 数据库类型
   * @returns 驱动和方言实例
   */
  private static createDriverAndDialect(
    config: string | DatabaseConfig,
    type: DatabaseType,
  ): { driver: IDatabaseDriver; dialect: BaseDialect } {
    switch (type) {
      case 'mysql':
        return {
          driver: new MySQLDriver(config as string | DatabaseConfig),
          dialect: new MySQLDialect(),
        };
      // 未来可以添加其他数据库支持
      // case 'postgresql':
      //   return {
      //     driver: new PostgreSQLDriver(config),
      //     dialect: new PostgreSQLDialect(),
      //   };
      default:
        throw new Error(`不支持的数据库类型: ${type}`);
    }
  }

  /**
   * 获取数据库驱动实例（高级用法）
   *
   * 返回底层数据库驱动，用于特殊操作或访问驱动特有功能。
   *
   * @returns IDatabaseDriver 接口实例
   *
   * @example
   * ```typescript
   * const db = Database.create('mysql://...');
   * const driver = db.getDriver();
   *
   * // 访问驱动特有方法
   * await driver.ping(); // 测试连接
   * const formatted = driver.format('SELECT * FROM users WHERE id = ?', [1]);
   * ```
   */
  public getDriver(): IDatabaseDriver {
    return this.driver;
  }

  /**
   * 获取 SQL 方言实例（高级用法）
   *
   * 返回 SQL 方言对象，用于构建特定数据库的 SQL 语句。
   *
   * @returns BaseDialect 接口实例
   *
   * @example
   * ```typescript
   * const db = Database.create('mysql://...');
   * const dialect = db.getDialect();
   *
   * // 手动构建 SQL
   * const { prepare, holders } = dialect.buildSelect({
   *   table: 'users',
   *   where: { age: { gt: 18 } },
   *   limit: 10
   * });
   * ```
   */
  public getDialect(): BaseDialect {
    return this.dialect;
  }

  /**
   * 创建或获取表实例
   *
   * 表实例会被缓存，相同表名多次调用会返回同一个实例。
   *
   * @param name - 表名（不需要转义，会自动处理）
   * @returns Table 实例
   *
   * @example
   * ```typescript
   * const db = Database.create('mysql://...');
   *
   * // 获取表实例（自动缓存）
   * const users = db.table('users');
   * const sameUsers = db.table('users'); // 返回同一个实例
   *
   * // 使用表实例进行操作
   * await users.add({ name: 'John', age: 25 });
   * const list = await users.gets({ where: { age: { gte: 18 } } });
   * ```
   */
  public table(name: string): Table {
    const cached = this.tables.get(name);
    if (cached) {
      return cached;
    }

    const instance = new Table(name, this.driver, this.dialect);
    this.tables.set(name, instance);
    return instance;
  }

  /**
   * 执行查询操作（SELECT）
   *
   * 执行原始 SQL 查询语句，返回查询结果数组。
   * 适用于复杂的自定义查询，或 Table API 无法满足的场景。
   *
   * @param sql - SQL 查询语句（支持 ? 占位符）
   * @param params - 占位符参数数组
   * @returns 查询结果数组
   *
   * @example
   * ```typescript
   * // 基础查询
   * const users = await db.query<User[]>(
   *   'SELECT * FROM users WHERE age > ?',
   *   [18]
   * );
   *
   * // 复杂 JOIN 查询
   * const orders = await db.query<OrderWithUser[]>(`
   *   SELECT o.*, u.name as user_name
   *   FROM orders o
   *   JOIN users u ON o.user_id = u.id
   *   WHERE o.status = ? AND o.created_at > ?
   * `, ['paid', new Date('2024-01-01')]);
   *
   * // 聚合查询
   * const stats = await db.query<{total: number, avg: number}[]>(`
   *   SELECT COUNT(*) as total, AVG(price) as avg
   *   FROM products
   *   WHERE category_id = ?
   * `, [10]);
   * ```
   */
  public async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (process.env.SHOW_SQL_LOG === 'on') {
      Log.v('[SQL]:', this.driver.format(sql, params));
    }
    return this.driver.query<T>(sql, params);
  }

  /**
   * 执行命令操作（INSERT, UPDATE, DELETE）
   *
   * 执行数据修改类 SQL 语句，返回执行结果信息。
   * 适用于需要获取 insertId 或 affectedRows 的场景。
   *
   * @param sql - SQL 命令语句（支持 ? 占位符）
   * @param params - 占位符参数数组
   * @returns 执行结果 { affectedRows, insertId? }
   *
   * 返回值说明：
   * - affectedRows: 受影响的行数
   * - insertId: 最后插入记录的自增 ID（仅 INSERT 操作）
   *
   * @example
   * ```typescript
   * // INSERT
   * const result = await db.execute(
   *   'INSERT INTO users (name, age) VALUES (?, ?)',
   *   ['John', 25]
   * );
   * console.log('新用户 ID:', result.insertId);
   *
   * // UPDATE
   * const result = await db.execute(
   *   'UPDATE users SET age = ? WHERE id = ?',
   *   [26, 123]
   * );
   * console.log('影响行数:', result.affectedRows);
   *
   * // DELETE
   * const result = await db.execute(
   *   'DELETE FROM users WHERE age < ?',
   *   [18]
   * );
   * console.log('删除行数:', result.affectedRows);
   * ```
   */
  public async execute(sql: string, params?: any[]) {
    if (process.env.SHOW_SQL_LOG === 'on') {
      Log.v('[SQL]:', this.driver.format(sql, params));
    }
    return this.driver.execute(sql, params);
  }

  /**
   * 执行数据库事务
   *
   * @param callback - 事务回调函数，包含所有需要在事务中执行的操作
   * @returns 回调函数的返回值
   *
   * 重要说明：
   * - 回调函数中的任何抛出的错误都会导致事务回滚
   * - 回调函数可以是同步或异步的（返回 Promise）
   * - 事务内的所有操作必须使用同一个数据库实例
   * - 避免在事务中执行耗时操作（如网络请求），会占用数据库连接
   * - MySQL 不支持跨数据库事务，所有表必须在同一数据库中
   *
   * @throws {Error} 回调函数中的任何错误都会导致事务回滚并重新抛出
   */
  public async transaction<T = any>(
    callback: () => TransactionResult<T>,
  ): Promise<T> {
    await this.driver.begin();
    try {
      const result = await callback();
      await this.driver.commit();
      return result;
    } catch (error) {
      await this.driver.rollback();
      throw error;
    }
  }

  /**
   * 测试数据库连接
   *
   * @returns 连接是否正常
   *
   */
  public async ping(): Promise<boolean> {
    return await this.driver.ping();
  }

  /**
   * 关闭所有数据库连接
   *
   * 关闭所有缓存的数据库实例，释放所有资源。
   * 通常在应用关闭时调用。
   *
   * @example
   * ```typescript
   * // NestJS 应用关闭时清理所有数据库连接
   * @Injectable()
   * export class MySQLService implements OnModuleDestroy {
   *   async onModuleDestroy() {
   *     await Database.closeAll();
   *   }
   * }
   * ```
   */
  public static async closeAll(): Promise<void> {
    const instances = Array.from(Database.instances.values());
    
    if (instances.length === 0) {
      return;
    }

    // 并行关闭所有实例
    await Promise.allSettled(
      instances.map(async (instance) => {
        // 关闭数据库连接池
        await instance.driver.close();
        // 清理 Table 缓存
        instance.tables.clear();
      })
    );

    // 清空实例缓存
    Database.instances.clear();
    
    Log.v(`[Database] Closed ${instances.length} database connection(s)`);
  }
}
