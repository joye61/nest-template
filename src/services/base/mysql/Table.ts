import { AsyncLocalStorage } from 'node:async_hooks';
import { JoinDefinition, Where, GroupBy, Having } from './type';
import { SQLBuilder } from './SQLBuilder';
import { MySQLDriver } from './MySQLDriver';

/**
 * 数据库操作结果
 *
 * 包含操作类型、影响行数、插入 ID 等信息，用于追踪数据库操作结果。
 */
export interface OperationResult {
  /** 操作类型 */
  type: 'insert' | 'update' | 'delete' | 'upsert';
  /** 影响的行数 */
  affectedRows: number;
  /** 首条插入记录的自增 ID（仅 INSERT） */
  insertId?: number;
  /** 实际执行的动作（仅 UPSERT）：insert 表示插入，update 表示更新 */
  action?: 'insert' | 'update';
}

/**
 * Table 类 - 数据表操作类（Repository 模式）
 *
 * 使用场景：
 * - 简单 CRUD 操作（推荐）
 * - 带条件的复杂查询
 * - 关联查询（JOIN）
 * - 分组统计（GROUP BY + HAVING）
 * - 数据更新和删除
 * - 批量插入
 * - 插入或更新（UPSERT）
 *
 * 不适用场景（请使用 Database.query）：
 * - 多表复杂 JOIN
 * - 子查询、UNION
 * - 存储过程调用
 */
export class Table {
  private static readonly resultContext = new AsyncLocalStorage<{
    results?: WeakMap<Table, OperationResult>;
  }>();

  /**
   * 在独立结果上下文中运行任务，结束或抛错后释放结果引用。
   * 嵌套调用创建子上下文；并行分支需要各自调用以隔离最后结果。
   * @param callback 当前请求或任务的完整异步流程
   * @returns 任务返回值
   */
  public static async withResultContext<T>(
    callback: () => T | Promise<T>,
  ): Promise<T> {
    const context: { results?: WeakMap<Table, OperationResult> } = {
      results: new WeakMap(),
    };
    return Table.resultContext.run(context, async () => {
      try {
        return await callback();
      } finally {
        context.results = undefined;
      }
    });
  }

  /**
   * 构造函数
   *
   * 通常不直接调用，而是通过 Database.table() 方法创建实例
   *
   * @param tableName - 表名
   * @param driver - 数据库驱动（负责执行 SQL）
   * @param builder - MySQL SQL 构建器
   */
  constructor(
    public readonly tableName: string,
    private readonly driver: MySQLDriver,
    private readonly builder: SQLBuilder,
  ) {}

  /**
   * 获取当前上下文中本表最后完成的成功写操作结果。
   * 未建立上下文、没有成功写入或上下文已结束时返回 undefined。
   * @returns 当前上下文的操作结果
   */
  public getLastResult(): OperationResult | undefined {
    return Table.resultContext.getStore()?.results?.get(this);
  }

  /** 仅在活动上下文中保存结果，并始终返回当前操作的独立结果。 */
  private recordResult(result: OperationResult): OperationResult {
    Table.resultContext.getStore()?.results?.set(this, result);
    return result;
  }

  /**
   * 查询单条记录
   *
   * 自动添加 LIMIT 1，只返回第一条匹配的记录。
   * 如果没有找到记录，返回 null。
   *
   * @param params - 查询参数
   * @returns 查询结果对象或 null
   *
   */
  public async get<T = any>(params?: {
    where?: Where;
    order?: Record<string, Uppercase<'ASC' | 'DESC'>>;
    field?: string;
    join?: JoinDefinition;
  }): Promise<T | null> {
    const { where, order, field, join } = params || {};

    const result = await this.gets<T>({
      where,
      order,
      limit: 1,
      offset: 0,
      field,
      join,
    });

    return result.length > 0 ? result[0] : null;
  }

  /**
   * 查询多条记录
   *
   * 支持复杂查询条件、排序、分页、JOIN、GROUP BY、HAVING 等。
   *
   * @param params - 查询参数
   * @returns 查询结果数组（如果没有记录返回空数组）
   *
   */
  public async gets<T = any>(params: {
    where?: Where;
    order?: Record<string, any>;
    offset?: number;
    limit?: number;
    field?: string;
    join?: JoinDefinition;
    groupBy?: GroupBy;
    having?: Having;
  }): Promise<Array<T>> {
    const {
      where,
      order,
      offset = 0,
      limit,
      field = '*',
      join,
      groupBy,
      having,
    } = params;

    const { prepare, holders } = this.builder.buildSelect({
      table: this.tableName,
      fields: field,
      where,
      order,
      limit,
      offset,
      join,
      groupBy,
      having,
    });

    return await this.driver.query<T>(prepare, holders);
  }

  /**
   * 添加单条记录
   *
   * @param data - 要插入的数据对象
   * @returns 操作结果（对象始终为 truthy，可直接用于 if 判断）
   *
   * @example
   * ```typescript
   * // 布尔逻辑不变
   * if (await users.add({ name: 'John' })) { ... }
   *
   * // 并发安全地获取插入 ID
   * const result = await users.add({ name: 'John' });
   * console.log('新用户 ID:', result.insertId);
   * ```
   */
  public async add(data: Record<string, any>): Promise<OperationResult> {
    return this.adds([data]);
  }

  /**
   * 批量添加多条记录
   *
   * 使用单个 INSERT 语句插入多条记录，比多次调用 add() 更高效。
   * 所有记录的字段必须完全一致。
   *
   * @param data - 要插入的数据对象数组
   * @returns 操作结果（对象始终为 truthy，可直接用于 if 判断）
   *
   * @throws {Error} 如果数据为空或记录字段不一致
   */
  public async adds(
    data: Array<Record<string, any>>,
  ): Promise<OperationResult> {
    if (!Array.isArray(data) || !data.length) {
      throw new Error(
        'Parameter error, data must be an array with length >= 1',
      );
    }

    // 验证所有记录字段一致性
    const firstKeys = Object.keys(data[0]).sort();
    for (let i = 1; i < data.length; i++) {
      const keys = Object.keys(data[i]).sort();
      if (
        keys.length !== firstKeys.length ||
        !keys.every((key, index) => key === firstKeys[index])
      ) {
        throw new Error(
          `Record at index ${i} has different fields. ` +
            `Expected: [${firstKeys.join(', ')}], ` +
            `Got: [${keys.join(', ')}]`,
        );
      }
    }

    const { prepare, holders } = this.builder.buildInsert({
      table: this.tableName,
      data,
    });

    const result = await this.driver.execute(prepare, holders);

    if (result.affectedRows !== data.length) {
      throw new Error(
        `Expected to insert ${data.length} rows but only ${result.affectedRows} were affected`,
      );
    }

    return this.recordResult({
      type: 'insert',
      affectedRows: result.affectedRows,
      insertId: result.insertId,
    });
  }

  /**
   * 删除记录
   *
   * @param params - 删除参数
   * @returns 操作结果（对象始终为 truthy，可直接用于 if 判断）
   *
   * 注意事项：
   * - 如果 where 为空，会删除所有记录，请确认是否需要
   * - 删除操作不可逆，建议在生产环境使用软删除（更新 status 字段）
   */
  public async remove(params: {
    where?: Where;
    order?: Record<string, any>;
    limit?: number;
  }): Promise<OperationResult> {
    const { where, order, limit } = params;

    const { prepare, holders } = this.builder.buildDelete({
      table: this.tableName,
      where,
      order,
      limit,
    });

    const result = await this.driver.execute(prepare, holders);

    return this.recordResult({
      type: 'delete',
      affectedRows: result.affectedRows,
    });
  }

  /**
   * 统计符合条件的记录总数
   *
   * 支持 WHERE、JOIN、GROUP BY、HAVING 等条件。
   *
   * @param params - 统计参数
   * @returns 记录总数
   *
   */
  public async count(params?: {
    where?: Where;
    join?: JoinDefinition;
    groupBy?: GroupBy;
    having?: Having;
  }): Promise<number> {
    const { where, join, groupBy, having } = params || {};

    const { prepare, holders } = this.builder.buildCount({
      table: this.tableName,
      where,
      join,
      groupBy,
      having,
    });

    const result = await this.driver.query<{ total_num: number }>(
      prepare,
      holders,
    );

    return result.length === 0 ? 0 : result[0].total_num;
  }

  /**
   * 更新记录
   *
   * @param params - 更新参数
   * @returns 操作结果（对象始终为 truthy，可直接用于 if 判断）
   *
   * 注意事项：
   * - 如果没有字段需要更新（data 为空），返回 affectedRows 为 0
   * - 如果 where 为空，会更新所有记录（请谨慎使用）
   * - 如果没有匹配到记录，affectedRows 为 0（不会报错）
   */
  public async update(params: {
    data: Record<string, any>;
    where?: Where;
    order?: Record<string, any>;
    limit?: number;
  }): Promise<OperationResult> {
    const { data, where, order, limit } = params;

    try {
      const { prepare, holders } = this.builder.buildUpdate({
        table: this.tableName,
        data,
        where,
        order,
        limit,
      });

      const result = await this.driver.execute(prepare, holders);

      return this.recordResult({
        type: 'update',
        affectedRows: result.affectedRows,
      });
    } catch (error) {
      // 如果没有字段可更新，返回 affectedRows 为 0
      if (error instanceof Error && error.message === 'No fields to update') {
        return this.recordResult({
          type: 'update',
          affectedRows: 0,
        });
      }
      throw error;
    }
  }

  /**
   * 原子化的 UPSERT 操作（插入或更新）
   *
   * 如果记录存在（根据唯一键判断）则更新，不存在则插入。
   * 使用 MySQL 的 INSERT ... ON DUPLICATE KEY UPDATE 语法，保证原子性。
   *
   * uniqueKeys 仅用于排除更新字段；任意唯一索引冲突都会触发更新。
   *
   * @param params - UPSERT 参数
   * @returns 操作结果（对象始终为 truthy，可直接用于 if 判断）
   *
   * @example
   * ```typescript
   * const userStats = db.table('user_stats');
   *
   * // === 基础 UPSERT ===
   * const result = await userStats.upsert({
   *   data: {
   *     user_id: 123,
   *     login_count: 1,
   *     last_login: new Date()
   *   },
   *   uniqueKeys: ['user_id']
   * });
   *
   * // 直接从返回值检查操作类型（并发安全）
   * if (result.action === 'insert') {
   *   console.log('新增了记录，ID:', result.insertId);
   * } else {
   *   console.log('更新了记录');
   * }
   *
   * // === 自定义更新数据 ===
   * // 插入时使用 data，更新时使用 updateData
   * await userStats.upsert({
   *   data: {
   *     user_id: 123,
   *     login_count: 1,
   *     last_login: new Date()
   *   },
   *   uniqueKeys: ['user_id'],
   *   updateData: {
   *     login_count: { increment: 1 }, // 更新时递增
   *     last_login: new Date()
   *   }
   * });
   *
   * // === 复合唯一键 ===
   * const likes = db.table('post_likes');
   * await likes.upsert({
   *   data: {
   *     user_id: 123,
   *     post_id: 456,
   *     created_at: new Date()
   *   },
   *   uniqueKeys: ['user_id', 'post_id']
   * });
   * ```
   *
   * MySQL affectedRows 说明：
   * - 1: 插入了新记录
   * - 2: 更新了现有记录
   * - 0: 记录存在但数据无变化（不会报错）
   *
   * @throws {Error} 如果 uniqueKeys 为空或不在 data 中
   */
  public async upsert(params: {
    data: Record<string, any>;
    uniqueKeys: string[];
    updateData?: Record<string, any>;
  }): Promise<OperationResult> {
    const { data, uniqueKeys, updateData } = params;

    if (!uniqueKeys || uniqueKeys.length === 0) {
      throw new Error('uniqueKeys is required for upsert operation');
    }

    // 验证 uniqueKeys 都在 data 中
    for (const key of uniqueKeys) {
      if (!(key in data)) {
        throw new Error(`uniqueKey "${key}" not found in data`);
      }
    }

    const { prepare, holders } = this.builder.buildUpsert({
      table: this.tableName,
      data,
      uniqueKeys,
      updateData,
    });

    const result = await this.driver.execute(prepare, holders);

    const action = result.affectedRows === 1 ? 'insert' : 'update';

    return this.recordResult({
      type: 'upsert',
      action,
      affectedRows: result.affectedRows,
      insertId: result.insertId,
    });
  }

  /**
   * 判断记录是否存在
   *
   * @param where - WHERE 条件
   * @returns 是否存在
   *
   * 性能提示：
   * - exists() 比 count() > 0 更高效（只需查询一条记录）
   * - exists() 比 get() !== null 更高效（不需要返回完整数据）
   */
  public async exists(where?: Where): Promise<boolean> {
    const { prepare, holders } = this.builder.buildExists({
      table: this.tableName,
      where,
    });

    const result = await this.driver.query(prepare, holders);

    return result.length > 0;
  }
}
