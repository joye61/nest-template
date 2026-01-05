import { Where, FieldValue, UpdateFieldValue, JoinDefinition, GroupBy, Having, OrderBy } from '../type';
import type { DatabaseType } from '../drivers/IDatabaseDriver';

/**
 * SQL 值类型
 */
export type SQLValue = string | number | boolean | Date | null | undefined;

/**
 * SQL 占位符值类型
 */
export type SQLHolderValue = string | number;

/**
 * SQL 值数组类型
 */
export type SQLValueArray = Array<string | number | boolean | Date>;

/**
 * 查询结果类型
 */
export type ValueHolders = {
  prepare: string;
  holders: Array<SQLHolderValue>;
};

/**
 * 数据库方言抽象类
 * 定义了 SQL 构建的统一接口，不同数据库可以继承并实现自己的方言
 */
export abstract class BaseDialect {
  /**
   * 数据库类型标识
   */
  abstract readonly type: DatabaseType;

  /**
   * 转换值为 SQL 占位符值
   * @param value 原始值
   * @returns SQL 占位符值
   */
  protected toSQLHolder(value: SQLValue | Date): SQLHolderValue {
    if (value instanceof Date) {
      return this.formatDate(value);
    }
    if (typeof value === 'boolean') {
      return this.formatBoolean(value);
    }
    return value as SQLHolderValue;
  }

  /**
   * 格式化日期（子类可重写）
   * @param date
   */
  protected formatDate(date: Date): string {
    return date.toISOString();
  }

  /**
   * 格式化布尔值（子类可重写）
   * @param value
   */
  protected formatBoolean(value: boolean): number {
    return value ? 1 : 0;
  }

  /**
   * 转义字段名（子类必须实现）
   * 
   * 不同数据库使用不同的转义字符来保护字段名和表名免受关键字冲突。
   * 
   * 数据库差异：
   * - MySQL: 使用反引号 `field`
   * - PostgreSQL: 使用双引号 "field"
   * - SQLite: 使用反引号 `field`
   * - MSSQL: 使用方括号 [field]
   * 
   * @param identifier - 需要转义的标识符（表名、字段名等）
   * @returns 转义后的标识符
   * 
   * @example
   * ```typescript
   * // MySQL 实现
   * escapeIdentifier('user') // → `user`
   * escapeIdentifier('order') // → `order` (避免关键字冲突)
   * escapeIdentifier('user_id') // → `user_id`
   * 
   * // PostgreSQL 实现
   * escapeIdentifier('user') // → "user"
   * escapeIdentifier('Order') // → "Order" (保持大小写敏感)
   * ```
   */
  abstract escapeIdentifier(identifier: string): string;

  /**
   * 获取占位符（子类必须实现）
   * 
   * 不同数据库使用不同的占位符语法来表示参数化查询中的参数位置。
   * 
   * 数据库差异：
   * - MySQL: 使用 ? 作为占位符，不需要索引
   * - PostgreSQL: 使用 $1, $2, $3... 作为占位符，需要索引
   * - SQLite: 使用 ? 作为占位符，不需要索引
   * - Oracle: 使用 :1, :2, :3... 作为占位符，需要索引
   * 
   * @param index - 参数索引（从 0 开始），PostgreSQL 等数据库需要
   * @returns 占位符字符串
   * 
   * @example
   * ```typescript
   * // MySQL 实现
   * getPlaceholder() // → '?'
   * getPlaceholder(0) // → '?'
   * getPlaceholder(5) // → '?'
   * 
   * // PostgreSQL 实现
   * getPlaceholder(0) // → '$1'
   * getPlaceholder(1) // → '$2'
   * getPlaceholder(5) // → '$6'
   * 
   * // 使用示例（构建 SQL）
   * const holders = [];
   * let sql = 'SELECT * FROM users WHERE ';
   * sql += `age > ${this.getPlaceholder(holders.length)}`;
   * holders.push(18);
   * sql += ` AND city = ${this.getPlaceholder(holders.length)}`;
   * holders.push('Beijing');
   * // MySQL: SELECT * FROM users WHERE age > ? AND city = ?
   * // PostgreSQL: SELECT * FROM users WHERE age > $1 AND city > $2
   * ```
   */
  abstract getPlaceholder(index?: number): string;

  /**
   * 创建 WHERE 条件（子类必须实现）
   * 
   * 将各种格式的 WHERE 条件转换为 SQL 字符串和占位符参数。
   * 支持对象格式、字符串格式、带占位符的数组格式。
   * 
   * @param where - WHERE 条件，支持多种格式
   * @returns { prepare: SQL字符串, holders: 占位符参数数组 }
   * 
   * @example
   * ```typescript
   * // ========== 格式 1：简单对象（等值查询）==========
   * createWhere({ age: 18, status: 1 })
   * // → { prepare: '`age` = ? AND `status` = ?', holders: [18, 1] }
   * 
   * // ========== 格式 2：操作符对象 ==========
   * createWhere({ 
   *   age: { gt: 18, lt: 60 },
   *   name: { like: 'John%' }
   * })
   * // → { 
   * //   prepare: '(`age` > ? AND `age` < ?) AND `name` LIKE ?',
   * //   holders: [18, 60, 'John%']
   * // }
   * 
   * // ========== 格式 3：IN 操作符 ==========
   * createWhere({ 
   *   status: { in: [1, 2, 3] },
   *   age: { between: [18, 60] }
   * })
   * // → { 
   * //   prepare: '`status` IN (?, ?, ?) AND `age` BETWEEN ? AND ?',
   * //   holders: [1, 2, 3, 18, 60]
   * // }
   * 
   * // ========== 格式 4：逻辑组合（AND/OR）==========
   * createWhere({
   *   age: { gt: 18 },
   *   OR: [
   *     { city: 'Beijing' },
   *     { city: 'Shanghai' }
   *   ]
   * })
   * // → { 
   * //   prepare: '`age` > ? AND ( `city` = ? OR `city` = ? )',
   * //   holders: [18, 'Beijing', 'Shanghai']
   * // }
   * 
   * // ========== 格式 5：原始 SQL 字符串 ==========
   * createWhere('age > 18 AND status = 1')
   * // → { prepare: 'age > 18 AND status = 1', holders: [] }
   * 
   * // ========== 格式 6：带占位符的数组 ==========
   * createWhere(['age > ? AND status = ?', [18, 1]])
   * // → { prepare: 'age > ? AND status = ?', holders: [18, 1] }
   * 
   * // ========== 格式 7：复杂嵌套 ==========
   * createWhere({
   *   AND: [
   *     { age: { gte: 18 } },
   *     {
   *       OR: [
   *         { city: 'Beijing', status: 1 },
   *         { city: 'Shanghai', status: 2 }
   *       ]
   *     }
   *   ]
   * })
   * // → { 
   * //   prepare: '`age` >= ? AND ( ( `city` = ? AND `status` = ? ) OR ( `city` = ? AND `status` = ? ) )',
   * //   holders: [18, 'Beijing', 1, 'Shanghai', 2]
   * // }
   * 
   * // ========== 格式 8：NULL 值处理 ==========
   * createWhere({ 
   *   email: null,
   *   deleted_at: { isNotNull: true }
   * })
   * // → { 
   * //   prepare: '`email` IS NULL AND `deleted_at` IS NOT NULL',
   * //   holders: []
   * // }
   * ```
   */
  abstract createWhere(where?: Where): ValueHolders;

  /**
   * 创建字段过滤条件（子类必须实现）
   * 
   * 为单个字段生成查询条件，支持直接值、操作符对象等多种格式。
   * 主要用于构建 WHERE 和 HAVING 子句。
   * 
   * @param key - 字段名
   * @param value - 字段值或操作符对象
   * @returns { prepare: SQL条件字符串, holders: 占位符参数数组 }
   * 
   * @example
   * ```typescript
   * // ========== 直接值（等值查询）==========
   * createFilter('age', 18)
   * // → { prepare: '`age` = ?', holders: [18] }
   * 
   * createFilter('name', 'John')
   * // → { prepare: '`name` = ?', holders: ['John'] }
   * 
   * // ========== NULL 值 ==========
   * createFilter('email', null)
   * // → { prepare: '`email` IS NULL', holders: [] }
   * 
   * // ========== 比较操作符 ==========
   * createFilter('age', { gt: 18 })
   * // → { prepare: '`age` > ?', holders: [18] }
   * 
   * createFilter('age', { gte: 18, lte: 60 })
   * // → { prepare: '(`age` >= ? AND `age` <= ?)', holders: [18, 60] }
   * 
   * createFilter('price', { ne: 0 })
   * // → { prepare: '`price` != ?', holders: [0] }
   * 
   * // ========== 范围操作符 ==========
   * createFilter('status', { in: [1, 2, 3] })
   * // → { prepare: '`status` IN (?, ?, ?)', holders: [1, 2, 3] }
   * 
   * createFilter('status', { notIn: [0, -1] })
   * // → { prepare: '`status` NOT IN (?, ?)', holders: [0, -1] }
   * 
   * createFilter('age', { between: [18, 60] })
   * // → { prepare: '`age` BETWEEN ? AND ?', holders: [18, 60] }
   * 
   * // ========== 字符串操作符 ==========
   * createFilter('name', { like: 'John%' })
   * // → { prepare: '`name` LIKE ?', holders: ['John%'] }
   * 
   * createFilter('name', { startsWith: 'John' })
   * // → { prepare: '`name` LIKE ?', holders: ['John%'] }
   * 
   * createFilter('name', { endsWith: 'Doe' })
   * // → { prepare: '`name` LIKE ?', holders: ['%Doe'] }
   * 
   * createFilter('name', { contains: 'oh' })
   * // → { prepare: '`name` LIKE ?', holders: ['%oh%'] }
   * 
   * createFilter('description', { notLike: '%test%' })
   * // → { prepare: '`description` NOT LIKE ?', holders: ['%test%'] }
   * 
   * // ========== 正则匹配（MySQL RLIKE）==========
   * createFilter('email', { rlike: '^[a-z]+@example\\.com$' })
   * // → { prepare: '`email` RLIKE ?', holders: ['^[a-z]+@example\\.com$'] }
   * 
   * // ========== 空值检查 ==========
   * createFilter('deleted_at', { isNull: true })
   * // → { prepare: '`deleted_at` IS NULL', holders: [] }
   * 
   * createFilter('deleted_at', { isNotNull: true })
   * // → { prepare: '`deleted_at` IS NOT NULL', holders: [] }
   * 
   * // ========== 日期类型 ==========
   * createFilter('created_at', new Date('2024-01-01'))
   * // → { prepare: '`created_at` = ?', holders: ['2024-01-01T00:00:00.000Z'] }
   * 
   * createFilter('created_at', { gt: new Date('2024-01-01') })
   * // → { prepare: '`created_at` > ?', holders: ['2024-01-01T00:00:00.000Z'] }
   * 
   * // ========== 多个操作符组合 ==========
   * createFilter('age', { gte: 18, lt: 60 })
   * // → { prepare: '(`age` >= ? AND `age` < ?)', holders: [18, 60] }
   * 
   * // ========== undefined 值（忽略）==========
   * createFilter('optional_field', undefined)
   * // → { prepare: '', holders: [] }
   * ```
   */
  abstract createFilter(key: string, value: FieldValue): ValueHolders;

  /**
   * 创建数据过滤（用于 UPDATE）（子类必须实现）
   * 
   * 为 UPDATE 语句生成字段赋值表达式，支持直接赋值和操作符（increment、decrement 等）。
   * 
   * @param key - 字段名
   * @param value - 字段值或更新操作符对象
   * @returns { prepare: SQL赋值表达式, holders: 占位符参数数组 }
   * 
   * @example
   * ```typescript
   * // ========== 直接赋值 ==========
   * createDataFilter('name', 'John')
   * // → { prepare: '`name` = ?', holders: ['John'] }
   * 
   * createDataFilter('age', 25)
   * // → { prepare: '`age` = ?', holders: [25] }
   * 
   * createDataFilter('is_active', true)
   * // → { prepare: '`is_active` = ?', holders: [1] }  // 布尔值转为 0/1
   * 
   * // ========== NULL 赋值 ==========
   * createDataFilter('email', null)
   * // → { prepare: '`email` = NULL', holders: [] }
   * 
   * // ========== 日期赋值 ==========
   * createDataFilter('updated_at', new Date('2024-01-01'))
   * // → { prepare: '`updated_at` = ?', holders: ['2024-01-01T00:00:00.000Z'] }
   * 
   * // ========== set 操作符（显式赋值）==========
   * createDataFilter('status', { set: 1 })
   * // → { prepare: '`status` = ?', holders: [1] }
   * 
   * // ========== increment 操作符（自增）==========
   * createDataFilter('view_count', { increment: 1 })
   * // → { prepare: '`view_count` = `view_count` + ?', holders: [1] }
   * 
   * createDataFilter('balance', { increment: 100 })
   * // → { prepare: '`balance` = `balance` + ?', holders: [100] }
   * 
   * // ========== decrement 操作符（自减）==========
   * createDataFilter('stock', { decrement: 1 })
   * // → { prepare: '`stock` = `stock` - ?', holders: [1] }
   * 
   * createDataFilter('balance', { decrement: 50 })
   * // → { prepare: '`balance` = `balance` - ?', holders: [50] }
   * 
   * // ========== multiply 操作符（乘法）==========
   * createDataFilter('price', { multiply: 1.1 })
   * // → { prepare: '`price` = `price` * ?', holders: [1.1] }
   * 
   * createDataFilter('score', { multiply: 2 })
   * // → { prepare: '`score` = `score` * ?', holders: [2] }
   * 
   * // ========== divide 操作符（除法）==========
   * createDataFilter('total', { divide: 2 })
   * // → { prepare: '`total` = `total` / ?', holders: [2] }
   * 
   * createDataFilter('average', { divide: 10 })
   * // → { prepare: '`average` = `average` / ?', holders: [10] }
   * 
   * // ========== undefined 值（忽略，不更新该字段）==========
   * createDataFilter('optional_field', undefined)
   * // → { prepare: '', holders: [] }
   * 
   * // ========== 实际 UPDATE 语句示例 ==========
   * // 以下展示如何组合多个字段：
   * 
   * // 示例 1：简单更新
   * // UPDATE `users` SET `name` = ?, `age` = ?, `updated_at` = ?
   * // [name: 'John', age: 26, updated_at: new Date()]
   * 
   * // 示例 2：使用操作符
   * // UPDATE `products` SET 
   * //   `stock` = `stock` - ?,
   * //   `sold_count` = `sold_count` + ?,
   * //   `updated_at` = ?
   * // [stock: { decrement: 5 }, sold_count: { increment: 5 }, updated_at: new Date()]
   * 
   * // 示例 3：混合使用
   * // UPDATE `orders` SET
   * //   `status` = ?,
   * //   `total_amount` = `total_amount` * ?,
   * //   `updated_at` = ?
   * // [status: 'completed', total_amount: { multiply: 1.1 }, updated_at: new Date()]
   * ```
   */
  abstract createDataFilter(key: string, value: UpdateFieldValue): ValueHolders;

  /**
   * 创建 ORDER BY 子句
   * 
   * 支持不区分大小写的排序方向参数，TypeScript 会自动提示所有可能的大小写组合。
   * 子类实现应将排序方向统一转换为大写。
   * 
   * @param order - 排序配置对象，value 支持所有大小写组合（asc/ASC/Asc/desc/DESC/Desc 等）
   * @returns ORDER BY 子句字符串
   */
  abstract createOrder(
    order?: OrderBy | null,
  ): string;

  /**
   * 创建 JOIN 子句
   * @param join
   */
  abstract createJoin(join?: JoinDefinition): string;

  /**
   * 创建 GROUP BY 子句
   * @param groupBy
   */
  abstract createGroupBy(groupBy?: GroupBy): string;

  /**
   * 创建 HAVING 子句
   * @param having
   */
  abstract createHaving(having?: Having): ValueHolders;

  /**
   * 构建 SELECT 语句
   */
  buildSelect(params: {
    table: string;
    fields?: string;
    where?: Where;
    order?: OrderBy;
    limit?: number;
    offset?: number;
    join?: JoinDefinition;
    groupBy?: GroupBy;
    having?: Having;
  }): ValueHolders {
    const { table, fields = '*', where, order, limit, offset = 0, join, groupBy, having } = params;

    let sql = `SELECT ${fields} FROM ${this.escapeIdentifier(table)}`;
    const holders: SQLHolderValue[] = [];

    // JOIN
    const joinStr = this.createJoin(join);
    if (joinStr) {
      sql += joinStr;
    }

    // WHERE
    const whereResult = this.createWhere(where);
    if (whereResult.prepare) {
      sql += ` WHERE ${whereResult.prepare}`;
      holders.push(...whereResult.holders);
    }

    // GROUP BY
    const groupByStr = this.createGroupBy(groupBy);
    if (groupByStr) {
      sql += ` GROUP BY ${groupByStr}`;
    }

    // HAVING
    const havingResult = this.createHaving(having);
    if (havingResult.prepare) {
      sql += ` HAVING ${havingResult.prepare}`;
      holders.push(...havingResult.holders);
    }

    // ORDER BY
    const orderStr = this.createOrder(order);
    if (orderStr) {
      sql += ` ORDER BY ${orderStr}`;
    }

    // LIMIT & OFFSET
    if (limit && limit > 0) {
      sql += this.buildLimitOffset(limit, offset);
    }

    return { prepare: sql, holders };
  }

  /**
   * 构建 INSERT 语句
   */
  buildInsert(params: {
    table: string;
    data: Array<Record<string, any>>;
  }): ValueHolders {
    const { table, data } = params;

    if (!data || data.length === 0) {
      throw new Error('Insert data cannot be empty');
    }

    const fields = Object.keys(data[0]);
    const escapedFields = fields.map((f) => this.escapeIdentifier(f));

    let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${escapedFields.join(', ')}) VALUES`;

    const holders: SQLHolderValue[] = [];
    const valueSets: string[] = [];

    for (const row of data) {
      const placeholders: string[] = [];
      for (const field of fields) {
        placeholders.push(this.getPlaceholder(holders.length));
        holders.push(this.toSQLHolder(row[field]));
      }
      valueSets.push(`(${placeholders.join(', ')})`);
    }

    sql += ` ${valueSets.join(', ')}`;

    return { prepare: sql, holders };
  }

  /**
   * 构建 UPDATE 语句
   */
  buildUpdate(params: {
    table: string;
    data: Record<string, any>;
    where?: Where;
    order?: OrderBy;
    limit?: number;
  }): ValueHolders {
    const { table, data, where, order, limit } = params;

    const holders: SQLHolderValue[] = [];
    const parts: string[] = [];

    for (const key in data) {
      const result = this.createDataFilter(key, data[key]);
      if (result.prepare) {
        parts.push(result.prepare);
        holders.push(...result.holders);
      }
    }

    if (parts.length === 0) {
      throw new Error('No fields to update');
    }

    let sql = `UPDATE ${this.escapeIdentifier(table)} SET ${parts.join(', ')}`;

    // WHERE
    const whereResult = this.createWhere(where);
    if (whereResult.prepare) {
      sql += ` WHERE ${whereResult.prepare}`;
      holders.push(...whereResult.holders);
    }

    // ORDER BY
    const orderStr = this.createOrder(order);
    if (orderStr) {
      sql += ` ORDER BY ${orderStr}`;
    }

    // LIMIT
    if (limit && limit > 0) {
      sql += ` LIMIT ${limit}`;
    }

    return { prepare: sql, holders };
  }

  /**
   * 构建 DELETE 语句
   */
  buildDelete(params: {
    table: string;
    where?: Where;
    order?: OrderBy;
    limit?: number;
  }): ValueHolders {
    const { table, where, order, limit } = params;

    let sql = `DELETE FROM ${this.escapeIdentifier(table)}`;
    const holders: SQLHolderValue[] = [];

    // WHERE
    const whereResult = this.createWhere(where);
    if (whereResult.prepare) {
      sql += ` WHERE ${whereResult.prepare}`;
      holders.push(...whereResult.holders);
    }

    // ORDER BY
    const orderStr = this.createOrder(order);
    if (orderStr) {
      sql += ` ORDER BY ${orderStr}`;
    }

    // LIMIT
    if (limit && limit > 0) {
      sql += ` LIMIT ${limit}`;
    }

    return { prepare: sql, holders };
  }

  /**
   * 构建 COUNT 语句
   */
  buildCount(params: {
    table: string;
    where?: Where;
    join?: JoinDefinition;
    groupBy?: GroupBy;
    having?: Having;
  }): ValueHolders {
    const { table, where, join, groupBy, having } = params;

    let sql = `SELECT COUNT(*) as ${this.escapeIdentifier('total_num')} FROM ${this.escapeIdentifier(table)}`;
    const holders: SQLHolderValue[] = [];

    // JOIN
    const joinStr = this.createJoin(join);
    if (joinStr) {
      sql += joinStr;
    }

    // WHERE
    const whereResult = this.createWhere(where);
    if (whereResult.prepare) {
      sql += ` WHERE ${whereResult.prepare}`;
      holders.push(...whereResult.holders);
    }

    // GROUP BY
    const groupByStr = this.createGroupBy(groupBy);
    if (groupByStr) {
      sql += ` GROUP BY ${groupByStr}`;
    }

    // HAVING
    const havingResult = this.createHaving(having);
    if (havingResult.prepare) {
      sql += ` HAVING ${havingResult.prepare}`;
      holders.push(...havingResult.holders);
    }

    return { prepare: sql, holders };
  }

  /**
   * 构建 EXISTS 语句
   */
  buildExists(params: { table: string; where?: Where }): ValueHolders {
    const { table, where } = params;

    let sql = `SELECT 1 FROM ${this.escapeIdentifier(table)}`;
    const holders: SQLHolderValue[] = [];

    // WHERE
    const whereResult = this.createWhere(where);
    if (whereResult.prepare) {
      sql += ` WHERE ${whereResult.prepare}`;
      holders.push(...whereResult.holders);
    }

    sql += ' LIMIT 1';

    return { prepare: sql, holders };
  }

  /**
   * 构建 LIMIT OFFSET 子句（子类可重写）
   */
  protected buildLimitOffset(limit: number, offset: number): string {
    if (offset > 0) {
      return ` LIMIT ${offset}, ${limit}`;
    }
    return ` LIMIT ${limit}`;
  }
}

