import {
  BaseDialect,
  ValueHolders,
  SQLHolderValue,
  SQLValue,
  SQLValueArray,
} from './BaseDialect';
import {
  Where,
  FieldValue,
  UpdateFieldValue,
  Operator,
  OperatorMap,
  UpdateOperator,
  WhereCondition,
  JoinConfig,
  JoinType,
  GroupBy,
  Having,
  OrderBy,
} from '../type';

/**
 * 字段记录类型
 */
type FieldRecord = Record<string, FieldValue>;

/**
 * MySQL 方言实现
 * 实现 MySQL 特定的 SQL 语法
 */
export class MySQLDialect extends BaseDialect {
  readonly type = 'mysql' as const;

  /**
   * MySQL 使用反引号转义标识符
   */
  escapeIdentifier(identifier: string): string {
    return `\`${identifier}\``;
  }

  /**
   * MySQL 使用 ? 作为占位符
   */
  getPlaceholder(): string {
    return '?';
  }

  /**
   * 创建字段过滤条件
   */
  createFilter(key: string, value: FieldValue): ValueHolders {
    let prepare = '';
    let holders: Array<SQLHolderValue> = [];

    // 如果值为 null 或 undefined
    if (value === null) {
      return {
        prepare: `${this.escapeIdentifier(key)} IS NULL`,
        holders: [],
      };
    }

    if (value === undefined) {
      return { prepare: '', holders: [] };
    }

    // 如果是普通值（非对象），直接等于查询
    if (typeof value !== 'object' || value instanceof Date) {
      return {
        prepare: `${this.escapeIdentifier(key)} = ?`,
        holders: [this.toSQLHolder(value)],
      };
    }

    // 如果是操作符对象
    const operators = Object.keys(value) as Operator[];

    // 多个操作符时，用 AND 连接
    const conditions: string[] = [];

    for (const op of operators) {
      const opValue = (value as Record<Operator, unknown>)[op];
      const result = this.createOperatorCondition(key, op, opValue);

      if (result.prepare) {
        conditions.push(result.prepare);
        holders.push(...result.holders);
      }
    }

    if (conditions.length === 0) {
      return { prepare: '', holders: [] };
    }

    // 如果有多个条件，用括号和 AND 连接
    prepare =
      conditions.length > 1 ? `(${conditions.join(' AND ')})` : conditions[0];

    return { prepare, holders };
  }

  /**
   * 根据操作符生成条件
   */
  private createOperatorCondition(
    key: string,
    operator: Operator,
    value: unknown,
  ): ValueHolders {
    const field = this.escapeIdentifier(key);
    let prepare = '';
    let holders: Array<SQLHolderValue> = [];

    switch (operator) {
      // 比较操作符
      case 'eq':
      case 'ne':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        prepare = `${field} ${OperatorMap[operator]} ?`;
        holders.push(this.toSQLHolder(value as SQLValue | Date));
        break;

      // IN / NOT IN
      case 'in':
      case 'notIn':
        if (!Array.isArray(value)) {
          throw new Error(`${operator} operator requires an array value`);
        }
        if (value.length === 0) {
          throw new Error(`${operator} operator requires a non-empty array`);
        }
        const placeholders = value.map(() => '?').join(', ');
        prepare = `${field} ${OperatorMap[operator]} (${placeholders})`;
        holders.push(
          ...(value as SQLValueArray).map((v) => this.toSQLHolder(v)),
        );
        break;

      // BETWEEN / NOT BETWEEN
      case 'between':
      case 'notBetween':
        if (!Array.isArray(value)) {
          throw new Error(`${operator} operator requires an array value`);
        }
        if (value.length !== 2) {
          throw new Error(`${operator} operator requires exactly 2 values`);
        }
        prepare = `${field} ${OperatorMap[operator]} ? AND ?`;
        const [min, max] = value as [SQLValue | Date, SQLValue | Date];
        holders.push(this.toSQLHolder(min), this.toSQLHolder(max));
        break;

      // LIKE / NOT LIKE / RLIKE / NOT RLIKE
      case 'like':
      case 'notLike':
      case 'rlike':
      case 'notRlike':
        prepare = `${field} ${OperatorMap[operator]} ?`;
        holders.push(value as string);
        break;

      // 便捷字符串操作符
      case 'startsWith':
        prepare = `${field} LIKE ?`;
        holders.push(`${value as string}%`);
        break;

      case 'endsWith':
        prepare = `${field} LIKE ?`;
        holders.push(`%${value as string}`);
        break;

      case 'contains':
        prepare = `${field} LIKE ?`;
        holders.push(`%${value as string}%`);
        break;

      // IS NULL / IS NOT NULL
      case 'isNull':
        if (value === true) {
          prepare = `${field} IS NULL`;
        } else if (value === false) {
          prepare = `${field} IS NOT NULL`;
        }
        break;

      case 'isNotNull':
        if (value === true) {
          prepare = `${field} IS NOT NULL`;
        } else if (value === false) {
          prepare = `${field} IS NULL`;
        }
        break;

      default:
        // 未知操作符，忽略
        break;
    }

    return { prepare, holders };
  }

  /**
   * 创建数据过滤（用于 UPDATE）
   */
  createDataFilter(key: string, value: UpdateFieldValue): ValueHolders {
    const field = this.escapeIdentifier(key);
    let prepare = '';
    let holders: Array<SQLHolderValue> = [];

    // 如果值为 null 或 undefined，直接设置为 NULL
    if (value === null) {
      return {
        prepare: `${field} = NULL`,
        holders: [],
      };
    }

    if (value === undefined) {
      return { prepare: '', holders: [] };
    }

    // 如果是普通值（非对象），直接赋值
    if (typeof value !== 'object' || value instanceof Date) {
      return {
        prepare: `${field} = ?`,
        holders: [this.toSQLHolder(value)],
      };
    }

    // 如果是操作符对象
    const operators = Object.keys(value) as UpdateOperator[];

    // 只支持单个操作符
    if (operators.length === 0) {
      return { prepare: '', holders: [] };
    }

    const operator = operators[0];
    const opValue = (value as Record<UpdateOperator, unknown>)[operator];

    switch (operator) {
      case 'set':
        prepare = `${field} = ?`;
        holders.push(this.toSQLHolder(opValue as SQLValue | Date));
        break;

      case 'increment':
        prepare = `${field} = ${field} + ?`;
        holders.push(opValue as number);
        break;

      case 'decrement':
        prepare = `${field} = ${field} - ?`;
        holders.push(opValue as number);
        break;

      case 'multiply':
        prepare = `${field} = ${field} * ?`;
        holders.push(opValue as number);
        break;

      case 'divide':
        prepare = `${field} = ${field} / ?`;
        holders.push(opValue as number);
        break;

      default:
        // 未知操作符，忽略
        break;
    }

    return { prepare, holders };
  }

  /**
   * 创建 WHERE 条件
   */
  createWhere(where?: Where): ValueHolders {
    // 空值处理
    if (
      !where ||
      (typeof where === 'object' && Object.keys(where).length === 0)
    ) {
      return { prepare: '', holders: [] };
    }

    // 原始 SQL 字符串
    if (typeof where === 'string') {
      return { prepare: where, holders: [] };
    }

    // 带占位符的原始 SQL
    if (Array.isArray(where)) {
      const [sql, params] = where;
      return { prepare: sql, holders: params || [] };
    }

    // 对象格式 - 处理 AND/OR 逻辑
    return this.createLogicalWhere(where as Record<string, unknown>);
  }

  /**
   * 处理逻辑操作符（AND/OR）
   */
  private createLogicalWhere(where: Record<string, unknown>): ValueHolders {
    const conditions: string[] = [];
    const holders: Array<SQLHolderValue> = [];

    // 提取 AND/OR 逻辑操作符
    const andConditions = where.AND as WhereCondition[] | undefined;
    const orConditions = where.OR as WhereCondition[] | undefined;

    // 提取普通字段条件（排除 AND/OR）
    const fieldConditions: FieldRecord = {};
    for (const key in where) {
      if (key !== 'AND' && key !== 'OR') {
        fieldConditions[key] = where[key] as FieldValue;
      }
    }

    // 处理普通字段条件（隐式 AND）
    if (Object.keys(fieldConditions).length > 0) {
      const result = this.createFieldConditions(fieldConditions);
      if (result.prepare) {
        conditions.push(result.prepare);
        holders.push(...result.holders);
      }
    }

    // 处理显式 AND 条件
    if (andConditions && andConditions.length > 0) {
      const result = this.createAndConditions(andConditions);
      if (result.prepare) {
        conditions.push(result.prepare);
        holders.push(...result.holders);
      }
    }

    // 处理 OR 条件
    if (orConditions && orConditions.length > 0) {
      const result = this.createOrConditions(orConditions);
      if (result.prepare) {
        // 如果已有其他条件，OR 需要用括号包裹
        const orPart =
          conditions.length > 0 ? `( ${result.prepare} )` : result.prepare;
        conditions.push(orPart);
        holders.push(...result.holders);
      }
    }

    // 用 AND 连接所有顶层条件
    return {
      prepare: conditions.join(' AND '),
      holders,
    };
  }

  /**
   * 处理字段条件（对象的普通字段）
   */
  private createFieldConditions(fields: FieldRecord): ValueHolders {
    const conditions: string[] = [];
    const holders: Array<SQLHolderValue> = [];

    for (const key in fields) {
      const value = fields[key];
      const result = this.createFilter(key, value);

      if (result.prepare) {
        conditions.push(result.prepare);
        holders.push(...result.holders);
      }
    }

    return {
      prepare: conditions.join(' AND '),
      holders,
    };
  }

  /**
   * 处理 AND 条件数组
   */
  private createAndConditions(conditions: WhereCondition[]): ValueHolders {
    const parts: string[] = [];
    const holders: Array<SQLHolderValue> = [];

    for (const condition of conditions) {
      const result = this.createWhere(condition);

      if (result.prepare) {
        // 如果条件包含 OR，需要用括号包裹
        const needsBracket =
          typeof condition === 'object' &&
          condition !== null &&
          !Array.isArray(condition) &&
          'OR' in condition;
        const part = needsBracket ? `( ${result.prepare} )` : result.prepare;
        parts.push(part);
        holders.push(...result.holders);
      }
    }

    return {
      prepare: parts.join(' AND '),
      holders,
    };
  }

  /**
   * 处理 OR 条件数组
   */
  private createOrConditions(conditions: WhereCondition[]): ValueHolders {
    const parts: string[] = [];
    const holders: Array<SQLHolderValue> = [];

    for (const condition of conditions) {
      const result = this.createWhere(condition);

      if (result.prepare) {
        // 如果条件包含多个字段或包含 AND，需要用括号包裹
        const needsBracket =
          typeof condition === 'object' &&
          condition !== null &&
          !Array.isArray(condition) &&
          (Object.keys(condition).length > 1 || 'AND' in condition);
        const part = needsBracket ? `( ${result.prepare} )` : result.prepare;
        parts.push(part);
        holders.push(...result.holders);
      }
    }

    return {
      prepare: parts.join(' OR '),
      holders,
    };
  }

  /**
   * 创建 ORDER BY 子句
   * 
   * 支持不区分大小写的排序方向参数，但生成的 SQL 始终使用大写。
   * TypeScript 会自动提示所有可能的大小写组合。
   * 
   * @param order - 排序配置对象，key 为字段名，value 为排序方向（支持所有大小写组合）
   * @returns ORDER BY 子句字符串（不含 ORDER BY 关键字）
   * 
   * @example
   * ```typescript
   * // TypeScript 会自动提示: 'asc', 'ASC', 'Asc', 'desc', 'DESC', 'Desc' 等
   * createOrder({ created_at: 'desc', id: 'asc' })
   * // → `created_at` DESC, `id` ASC
   * 
   * // 支持大写
   * createOrder({ name: 'ASC' })
   * // → `name` ASC
   * 
   * // 支持混合
   * createOrder({ age: 'DESC', status: 'asc' })
   * // → `age` DESC, `status` ASC
   * 
   * // 无效的排序方向会被 TypeScript 标记为类型错误
   * createOrder({ field1: 'invalid' }) // ❌ TypeScript 类型错误
   * ```
   */
  createOrder(
    order?: OrderBy | null,
  ): string {
    if (!order) {
      return '';
    }
    
    const parts: Array<string> = [];
    
    for (const key in order) {
      const value = order[key];
      
      // 确保值是字符串类型
      if (typeof value !== 'string') {
        continue;
      }
      
      // 转换为大写并验证
      const direction = value.toUpperCase();
      
      // 只接受 ASC 或 DESC
      if (direction === 'ASC' || direction === 'DESC') {
        parts.push(`${this.escapeIdentifier(key)} ${direction}`);
      }
    }
    
    return parts.join(', ');
  }

  /**
   * 创建 JOIN 子句
   * 支持多种 JOIN 类型和配置
   * 
   * 示例:
   * 1. 简单字符串格式:
   *    { orders: 'users.id = orders.user_id' }
   *    → INNER JOIN `orders` ON users.id = orders.user_id
   * 
   * 2. 完整配置格式:
   *    { orders: { type: 'LEFT', on: 'users.id = orders.user_id' } }
   *    → LEFT JOIN `orders` ON users.id = orders.user_id
   * 
   * 3. USING 语法:
   *    { orders: { type: 'INNER', using: ['user_id'] } }
   *    → INNER JOIN `orders` USING (`user_id`)
   * 
   * 4. CROSS JOIN:
   *    { orders: { type: 'CROSS' } }
   *    → CROSS JOIN `orders`
   */
  createJoin(join?: Record<string, string | JoinConfig>): string {
    if (!join || Object.keys(join).length === 0) {
      return '';
    }

    const parts: Array<string> = [];

    for (const tableName of Object.keys(join)) {
      const joinDef = join[tableName];
      
      // 如果是字符串，默认为 INNER JOIN
      if (typeof joinDef === 'string') {
        parts.push(` INNER JOIN ${this.escapeIdentifier(tableName)} ON ${joinDef}`);
        continue;
      }

      // 如果是对象配置
      const { type = 'INNER', on, using } = joinDef;

      // 验证 JOIN 类型
      const validTypes: Array<JoinType> = ['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'];
      if (!validTypes.includes(type)) {
        throw new Error(`Invalid JOIN type: ${type}. Valid types are: ${validTypes.join(', ')}`);
      }

      // 构建 JOIN 子句
      let joinClause = ` ${type} JOIN ${this.escapeIdentifier(tableName)}`;

      // CROSS JOIN 不需要 ON 或 USING
      if (type === 'CROSS') {
        parts.push(joinClause);
        continue;
      }

      // 优先使用 USING 语法
      if (using !== undefined) {
        if (!Array.isArray(using) || using.length === 0) {
          throw new Error(`JOIN "using" must be a non-empty array for table "${tableName}"`);
        }
        const usingFields = using.map(field => this.escapeIdentifier(field)).join(', ');
        joinClause += ` USING (${usingFields})`;
        parts.push(joinClause);
        continue;
      }

      // 使用 ON 语法
      if (on) {
        joinClause += ` ON ${on}`;
        parts.push(joinClause);
        continue;
      }

      // 如果既没有 ON 也没有 USING（且不是 CROSS JOIN），抛出错误
      throw new Error(`JOIN on table "${tableName}" requires either "on" or "using" condition (or use type: "CROSS")`);
    }

    return parts.join('');
  }

  /**
   * 创建 GROUP BY 子句
   */
  createGroupBy(groupBy?: GroupBy): string {
    if (!groupBy) {
      return '';
    }

    // 处理单个字段字符串
    if (typeof groupBy === 'string') {
      // 如果字段包含点号（表名.字段名），需要分别转义
      if (groupBy.includes('.')) {
        const parts = groupBy.split('.');
        return parts.map(part => this.escapeIdentifier(part)).join('.');
      }
      return this.escapeIdentifier(groupBy);
    }

    // 处理数组（多个字段）
    if (Array.isArray(groupBy)) {
      if (groupBy.length === 0) {
        return '';
      }
      return groupBy.map(field => {
        // 如果字段包含点号（表名.字段名），需要分别转义
        if (field.includes('.')) {
          const parts = field.split('.');
          return parts.map(part => this.escapeIdentifier(part)).join('.');
        }
        return this.escapeIdentifier(field);
      }).join(', ');
    }

    return '';
  }

  /**
   * 创建 HAVING 子句
   */
  createHaving(having?: Having): ValueHolders {
    if (!having) {
      return { prepare: '', holders: [] };
    }

    // 字符串格式
    if (typeof having === 'string') {
      return { prepare: having, holders: [] };
    }

    // 数组格式 [sql] 或 [sql, params]
    if (Array.isArray(having)) {
      const [sql, params] = having;
      return {
        prepare: sql,
        holders: (params || []) as SQLHolderValue[],
      };
    }

    // 对象格式：类似 WHERE 的条件构建
    const conditions: string[] = [];
    const holders: SQLHolderValue[] = [];

    for (const key in having) {
      const value = having[key];
      const filterResult = this.createFilter(key, value);
      if (filterResult.prepare) {
        conditions.push(filterResult.prepare);
        holders.push(...filterResult.holders);
      }
    }

    return {
      prepare: conditions.length > 0 ? conditions.join(' AND ') : '',
      holders,
    };
  }

  /**
   * MySQL LIMIT 语法
   */
  protected buildLimitOffset(limit: number, offset: number): string {
    if (offset > 0) {
      return ` LIMIT ${offset}, ${limit}`;
    }
    return ` LIMIT ${limit}`;
  }

  /**
   * 构建 MySQL UPSERT (INSERT ... ON DUPLICATE KEY UPDATE)
   */
  buildUpsert(params: {
    table: string;
    data: Record<string, any>;
    uniqueKeys: string[];
    updateData?: Record<string, any>;
  }): ValueHolders {
    const { table, data, uniqueKeys, updateData } = params;

    const fields: string[] = [];
    const holders: Array<SQLHolderValue> = [];

    for (const key in data) {
      fields.push(this.escapeIdentifier(key));
      holders.push(this.toSQLHolder(data[key]));
    }

    const placeholders = fields.map(() => '?').join(', ');
    let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${fields.join(', ')}) VALUES (${placeholders})`;

    // 构建 ON DUPLICATE KEY UPDATE 部分
    const updateFields = updateData || data;
    const updateParts: string[] = [];

    for (const key in updateFields) {
      // 跳过 uniqueKeys（通常不需要更新唯一键）
      if (uniqueKeys.includes(key)) {
        continue;
      }
      updateParts.push(`${this.escapeIdentifier(key)} = ?`);
      holders.push(this.toSQLHolder(updateFields[key]));
    }

    if (updateParts.length > 0) {
      sql += ` ON DUPLICATE KEY UPDATE ${updateParts.join(', ')}`;
    }

    return { prepare: sql, holders };
  }
}
