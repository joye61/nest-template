import { JoinDefinition, Where, GroupBy, Having } from './type';
import { BaseDialect } from './dialect/BaseDialect';
import { IDatabaseDriver } from './drivers/IDatabaseDriver';
import { Log } from 'src/common/Log';

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
  /** 新插入记录的 ID（仅 INSERT） */
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
  /**
   * 最后一次操作的结果详情
   *
   * 用于获取插入 ID、影响行数等信息。
   * 在每次 add/adds/update/remove/upsert 操作后自动更新。
   *
   * @private
   */
  private _lastOperationResult?: OperationResult;

  /**
   * 构造函数
   *
   * 通常不直接调用，而是通过 Database.table() 方法创建实例
   *
   * @param tableName - 表名
   * @param driver - 数据库驱动（负责执行 SQL）
   * @param dialect - SQL 方言（负责构建 SQL）
   */
  constructor(
    public readonly tableName: string,
    private readonly driver: IDatabaseDriver,
    private readonly dialect: BaseDialect,
  ) {}

  /**
   * 获取最后一次操作的详细结果
   *
   * @returns 操作结果对象，包含 type、affectedRows、insertId 等信息
   *
   * @example
   * ```typescript
   * const users = db.table('users');
   * await users.add({ name: 'John' });
   *
   * const result = users.getLastResult();
   * console.log('操作类型:', result.type); // 'insert'
   * console.log('插入 ID:', result.insertId); // 123
   * console.log('影响行数:', result.affectedRows); // 1
   * ```
   */
  public getLastResult(): OperationResult | undefined {
    return this._lastOperationResult;
  }

  /**
   * 获取最后插入记录的 ID（快捷属性）
   *
   * @example
   * ```typescript
   * await users.add({ name: 'John' });
   * console.log('新用户 ID:', users.lastInsertId);
   * ```
   */
  public get lastInsertId(): number | undefined {
    return this._lastOperationResult?.insertId;
  }

  /**
   * 获取最后一次操作影响的行数（快捷属性）
   *
   * @example
   * ```typescript
   * await users.update({ data: { status: 1 }, where: { age: { lt: 18 } } });
   * console.log('更新了', users.lastAffectedRows, '条记录');
   * ```
   */
  public get lastAffectedRows(): number | undefined {
    return this._lastOperationResult?.affectedRows;
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

    const { prepare, holders } = this.dialect.buildSelect({
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

    if (process.env.SHOW_SQL_LOG === 'on') {
      Log.v('[SQL]:', this.driver.format(prepare, holders));
    }
    return await this.driver.query<T>(prepare, holders);
  }

  /**
   * 添加单条记录
   *
   * @param data - 要插入的数据对象
   * @returns 是否成功（成功返回 true，失败抛出异常）
   *
   */
  public async add(data: Record<string, any>): Promise<boolean> {
    return this.adds([data]);
  }

  /**
   * 批量添加多条记录
   *
   * 使用单个 INSERT 语句插入多条记录，比多次调用 add() 更高效。
   * 所有记录的字段必须完全一致。
   *
   * @param data - 要插入的数据对象数组
   * @returns 是否成功（成功返回 true，失败抛出异常）
   *
   *
   * @throws {Error} 如果数据为空或记录字段不一致
   */
  public async adds(data: Array<Record<string, any>>): Promise<boolean> {
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

    const { prepare, holders } = this.dialect.buildInsert({
      table: this.tableName,
      data,
    });

    if (process.env.SHOW_SQL_LOG === 'on') {
      Log.v('[SQL]:', this.driver.format(prepare, holders));
    }
    const result = await this.driver.execute(prepare, holders);

    if (result.affectedRows !== data.length) {
      throw new Error(
        `Expected to insert ${data.length} rows but only ${result.affectedRows} were affected`,
      );
    }

    // 保存操作结果
    this._lastOperationResult = {
      type: 'insert',
      affectedRows: result.affectedRows,
      insertId: result.insertId,
    };

    return true;
  }

  /**
   * 删除记录
   *
   * @param params - 删除参数
   * @returns 是否成功（成功返回 true，失败抛出异常）
   *
   * 注意事项：
   * - 如果 where 为空，会删除所有记录，请确认是否需要
   * - 返回值永远是 true，如果要检查是否删除了记录，使用 lastAffectedRows
   * - 删除操作不可逆，建议在生产环境使用软删除（更新 status 字段）
   */
  public async remove(params: {
    where?: Where;
    order?: Record<string, any>;
    limit?: number;
  }): Promise<boolean> {
    const { where, order, limit } = params;

    const { prepare, holders } = this.dialect.buildDelete({
      table: this.tableName,
      where,
      order,
      limit,
    });

    if (process.env.SHOW_SQL_LOG === 'on') {
      Log.v('[SQL]:', this.driver.format(prepare, holders));
    }
    const result = await this.driver.execute(prepare, holders);

    // 保存操作结果
    this._lastOperationResult = {
      type: 'delete',
      affectedRows: result.affectedRows,
    };

    return true;
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

    const { prepare, holders } = this.dialect.buildCount({
      table: this.tableName,
      where,
      join,
      groupBy,
      having,
    });

    if (process.env.SHOW_SQL_LOG === 'on') {
      Log.v('[SQL]:', this.driver.format(prepare, holders));
    }
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
   * @returns 是否成功（成功返回 true，失败抛出异常）
   *
   * 注意事项：
   * - 如果没有字段需要更新（data 为空），会抛出错误
   * - 如果 where 为空，会更新所有记录（请谨慎使用）
   * - 如果没有匹配到记录，lastAffectedRows 为 0（不会报错）
   */
  public async update(params: {
    data: Record<string, any>;
    where?: Where;
    order?: Record<string, any>;
    limit?: number;
  }): Promise<boolean> {
    const { data, where, order, limit } = params;

    try {
      const { prepare, holders } = this.dialect.buildUpdate({
        table: this.tableName,
        data,
        where,
        order,
        limit,
      });

      if (process.env.SHOW_SQL_LOG === 'on') {
        Log.v('[SQL]:', this.driver.format(prepare, holders));
      }
      const result = await this.driver.execute(prepare, holders);

      // 保存操作结果
      this._lastOperationResult = {
        type: 'update',
        affectedRows: result.affectedRows,
      };

      return true;
    } catch (error) {
      // 如果没有字段可更新，返回成功但 affectedRows 为 0
      if (error instanceof Error && error.message === 'No fields to update') {
        this._lastOperationResult = {
          type: 'update',
          affectedRows: 0,
        };
        return true;
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
   * 注意：目前仅支持 MySQL，其他数据库需要在 dialect 中实现。
   *
   * @param params - UPSERT 参数
   * @returns 是否成功（成功返回 true，失败抛出异常）
   *
   * @example
   * ```typescript
   * const userStats = db.table('user_stats');
   *
   * // === 基础 UPSERT ===
   * // 如果 user_id 存在则更新，否则插入
   * await userStats.upsert({
   *   data: {
   *     user_id: 123,
   *     login_count: 1,
   *     last_login: new Date()
   *   },
   *   uniqueKeys: ['user_id']
   * });
   *
   * // 检查实际执行的操作
   * const result = userStats.getLastResult();
   * if (result.action === 'insert') {
   *   console.log('新增了记录');
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
   * @throws {Error} 如果当前数据库类型不支持 UPSERT
   */
  public async upsert(params: {
    data: Record<string, any>;
    uniqueKeys: string[];
    updateData?: Record<string, any>;
  }): Promise<boolean> {
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

    // 检查 dialect 是否支持 upsert
    if (!('buildUpsert' in this.dialect)) {
      throw new Error(
        `Upsert operation is not supported for ${this.dialect.type} dialect`,
      );
    }

    const { prepare, holders } = (this.dialect as any).buildUpsert({
      table: this.tableName,
      data,
      uniqueKeys,
      updateData,
    });

    if (process.env.SHOW_SQL_LOG === 'on') {
      Log.v('[SQL]:', this.driver.format(prepare, holders));
    }
    const result = await this.driver.execute(prepare, holders);

    // MySQL 行为：affectedRows = 1 表示插入，2 表示更新，0 表示无变化
    const action = result.affectedRows === 1 ? 'insert' : 'update';

    // 保存操作结果
    this._lastOperationResult = {
      type: 'upsert',
      action,
      affectedRows: result.affectedRows,
      insertId: result.insertId,
    };

    return true;
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
    const { prepare, holders } = this.dialect.buildExists({
      table: this.tableName,
      where,
    });

    if (process.env.SHOW_SQL_LOG === 'on') {
      Log.v('[SQL]:', this.driver.format(prepare, holders));
    }
    const result = await this.driver.query(prepare, holders);

    return result.length > 0;
  }
}
