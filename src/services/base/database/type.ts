/**
 * 数据库查询操作符类型定义
 * 类似 MongoDB/Prisma 的类型友好查询语法
 */

/**
 * 比较操作符
 */
export interface ComparisonOperators<T = any> {
  /** 等于 (=) */
  eq?: T;
  /** 不等于 (!=, <>) */
  ne?: T;
  /** 大于 (>) */
  gt?: T;
  /** 大于等于 (>=) */
  gte?: T;
  /** 小于 (<) */
  lt?: T;
  /** 小于等于 (<=) */
  lte?: T;
}

/**
 * 范围操作符
 */
export interface RangeOperators<T = any> {
  /** IN 操作符 */
  in?: T[];
  /** NOT IN 操作符 */
  notIn?: T[];
  /** BETWEEN 操作符 [min, max] */
  between?: [T, T];
  /** NOT BETWEEN 操作符 [min, max] */
  notBetween?: [T, T];
}

/**
 * 字符串操作符
 */
export interface StringOperators {
  /** LIKE 操作符 */
  like?: string;
  /** NOT LIKE 操作符 */
  notLike?: string;
  /** RLIKE (正则匹配) */
  rlike?: string;
  /** NOT RLIKE */
  notRlike?: string;
  /** 以...开始 (LIKE 'value%') */
  startsWith?: string;
  /** 以...结束 (LIKE '%value') */
  endsWith?: string;
  /** 包含 (LIKE '%value%') */
  contains?: string;
}

/**
 * 空值操作符
 */
export interface NullOperators {
  /** IS NULL */
  isNull?: boolean;
  /** IS NOT NULL */
  isNotNull?: boolean;
}

/**
 * 更新操作符（用于 UPDATE 语句）
 */
export interface UpdateOperators<T = any> {
  /** 直接设置值 (=) */
  set?: T;
  /** 增加 (+=) */
  increment?: number;
  /** 减少 (-=) */
  decrement?: number;
  /** 乘以 (*=) */
  multiply?: number;
  /** 除以 (/=) */
  divide?: number;
}

/**
 * 所有查询操作符的联合类型
 */
export type QueryOperators<T = any> =
  | ComparisonOperators<T>
  | RangeOperators<T>
  | StringOperators
  | NullOperators;

/**
 * 字段查询条件
 * 可以是直接值或者操作符对象
 */
export type FieldCondition<T = any> = T | QueryOperators<T>;

/**
 * 字段值类型：可以是单个值、操作符对象或数组
 */
export type FieldValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | QueryOperators
  | Array<string | number | boolean | Date>;

/**
 * 更新字段值类型
 */
export type UpdateFieldValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | UpdateOperators
  | Array<string | number | boolean | Date>;

/**
 * Where 条件类型
 * 支持多种格式：
 * 1. 对象格式: { field: value } 或 { field: { gt: 1 } }
 * 2. 原始字符串: "id > 1 AND status = 1"
 * 3. 带占位符: ["id > ? AND status = ?", [1, 1]]
 */
export type WhereCondition<T = any> =
  | { [K in keyof T]?: FieldCondition<T[K]> }
  | string
  | [string]
  | [string, Array<string | number>]
  | null;

/**
 * AND/OR 组合条件
 */
export interface LogicalOperators<T = any> {
  /** AND 条件 */
  AND?: WhereCondition<T>[];
  /** OR 条件 */
  OR?: WhereCondition<T>[];
}

/**
 * 完整的 Where 类型
 */
export type Where<T = any> =
  | WhereCondition<T>
  | LogicalOperators<T>
  | (WhereCondition<T> & LogicalOperators<T>);

/**
 * Update 数据类型
 * 支持直接赋值或使用操作符
 */
export type UpdateData<T = any> = {
  [K in keyof T]?: T[K] | UpdateOperators<T[K]> | null;
};

/**
 * 操作符映射到 SQL
 */
export const OperatorMap = {
  eq: '=',
  ne: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: 'IN',
  notIn: 'NOT IN',
  between: 'BETWEEN',
  notBetween: 'NOT BETWEEN',
  like: 'LIKE',
  notLike: 'NOT LIKE',
  rlike: 'RLIKE',
  notRlike: 'NOT RLIKE',
  isNull: 'IS NULL',
  isNotNull: 'IS NOT NULL',
  // 便捷操作符（内部转换为 LIKE）
  startsWith: 'LIKE',
  endsWith: 'LIKE',
  contains: 'LIKE',
} as const;

/**
 * 操作符类型
 */
export type Operator = keyof typeof OperatorMap;

/**
 * 更新操作符类型
 */
export type UpdateOperator = keyof UpdateOperators;

/**
 * JOIN 类型
 */
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';

/**
 * JOIN 配置
 */
export interface JoinConfig {
  /** JOIN 类型，默认 INNER */
  type?: JoinType;
  /** JOIN 条件，如 'users.id = orders.user_id' */
  on?: string;
  /** 使用 USING 语法的字段，如 ['user_id'] */
  using?: string[];
}

/**
 * JOIN 定义
 * 支持两种格式：
 * 1. 简单字符串: { orders: 'users.id = orders.user_id' }
 * 2. 完整配置: { orders: { type: 'LEFT', on: 'users.id = orders.user_id' } }
 */
export type JoinDefinition = Record<string, string | JoinConfig>;

/**
 * GROUP BY 定义
 * 支持多种格式：
 * 1. 单个字段字符串: 'user_id'
 * 2. 多个字段数组: ['user_id', 'status']
 * 3. 带表名的字段: ['users.id', 'orders.status']
 */
export type GroupBy = string | string[];

/**
 * HAVING 条件类型
 * 用于 GROUP BY 后的条件过滤
 * 支持格式：
 * 1. 对象格式: { 'COUNT(*)': { gt: 5 } }
 * 2. 原始字符串: "COUNT(*) > 5"
 * 3. 带占位符: ["COUNT(*) > ?", [5]]
 */
export type Having =
  | Record<string, FieldCondition>
  | string
  | [string]
  | [string, Array<string | number>]
  | null;

/**
 * 排序方向类型
 * 支持大小写不敏感的 ASC/DESC
 *
 * 注意：由于 TypeScript 类型系统的限制，我们只列出了常用的大小写组合。
 * 运行时实现会接受任何大小写组合，但 TypeScript 只会提示这里列出的变体。
 *
 * @example
 * ```typescript
 * const order1: OrderDirection = 'asc';    // 正确
 * const order2: OrderDirection = 'ASC';    // 正确
 * const order3: OrderDirection = 'Asc';    // 正确
 * const order4: OrderDirection = 'desc';   // 正确
 * const order5: OrderDirection = 'DESC';   // 正确
 * const order6: OrderDirection = 'Desc';   // 正确
 * const order7: OrderDirection = 'invalid'; // 类型错误
 * ```
 */
export type OrderDirection =
  | 'asc'
  | 'ASC'
  | 'Asc' // 最常用的 3 种
  | 'desc'
  | 'DESC'
  | 'Desc' // 最常用的 3 种
  | string; // 允许其他大小写组合，但不会有智能提示

/**
 * ORDER BY 定义
 * 支持大小写不敏感的排序方向
 *
 * @example
 * ```typescript
 * // TypeScript 会智能提示常用的大小写组合
 * const order1: OrderBy = { id: 'asc' };
 * const order2: OrderBy = { id: 'ASC' };
 * const order3: OrderBy = { created_at: 'desc', id: 'ASC' };
 * const order4: OrderBy = { name: 'Desc' };
 *
 * // 也接受其他大小写组合，只是不会有智能提示
 * const order5: OrderBy = { id: 'aSc' };
 * ```
 */
export type OrderBy = Record<string, OrderDirection>;
