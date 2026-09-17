import { MySQLDriver } from './MySQLDriver';
import { SQLBuilder } from './SQLBuilder';
import { Table } from './Table';
import type { DatabaseConfig, TransactionCallback } from './type';

export type TransactionResult<T> = T | Promise<T>;

/** MySQL 数据库入口，缓存连接池和表实例。 */
export class Database {
  private static readonly instances = new Map<string, Database>();
  private readonly tables = new Map<string, Table>();
  private readonly builder = new SQLBuilder();

  private constructor(private readonly driver: MySQLDriver) {}

  /** 根据连接串或配置创建懒连接实例，相同配置复用连接池。 */
  public static create(config: string | DatabaseConfig): Database {
    const key = JSON.stringify(
      typeof config === 'string'
        ? config
        : Object.fromEntries(
            Object.entries(config)
              .filter(([, value]) => value !== undefined)
              .sort(([left], [right]) => left.localeCompare(right)),
          ),
    );
    let instance = this.instances.get(key);
    if (!instance) {
      instance = new Database(new MySQLDriver(config));
      this.instances.set(key, instance);
    }
    return instance;
  }

  /** 获取具体 MySQL 驱动，可通过 getPool() 使用原生连接池。 */
  public getDriver(): MySQLDriver {
    return this.driver;
  }

  /** 获取 MySQL SQL 构建器。 */
  public getBuilder(): SQLBuilder {
    return this.builder;
  }

  /** 获取或创建表实例。 */
  public table(name: string): Table {
    let table = this.tables.get(name);
    if (!table) {
      table = new Table(name, this.driver, this.builder);
      this.tables.set(name, table);
    }
    return table;
  }

  /** 执行原始查询，参数使用问号占位符。 */
  public async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.driver.query<T>(sql, params);
  }

  /** 执行写入命令，返回影响行数和首条记录的自增 ID。 */
  public async execute(sql: string, params?: any[]) {
    return this.driver.execute(sql, params);
  }

  /** 在独立连接中执行事务；嵌套调用加入外层事务。 */
  public async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    return this.driver.transaction(callback);
  }

  /** 检查 MySQL 连接是否可用。 */
  public async ping(): Promise<boolean> {
    return this.driver.ping();
  }

  /** 关闭所有连接池并清理缓存。 */
  public static async closeAll(): Promise<void> {
    const instances = [...this.instances.values()];
    await Promise.allSettled(
      instances.map(async (instance) => {
        await instance.driver.close();
        instance.tables.clear();
      }),
    );
    this.instances.clear();
  }
}
