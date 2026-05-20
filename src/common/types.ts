/**
 * 通用类型定义
 */

/**
 * 通用对象类型（键值对）
 */
export type Json = Record<string, any>;

/**
 * API 统一响应格式
 */
export interface ApiResult<T = any> {
  /** 响应数据 */
  data: T;
  /** 响应消息 */
  message: string;
  /** 响应码：0 表示成功，非 0 表示失败 */
  code: number;
}

/**
 * 分页查询参数
 */
export interface PageParams {
  /** 页码（从 1 开始） */
  page: number;
  /** 每页数量 */
  pageSize: number;
}

/**
 * 分页查询结果
 */
export interface PageResult<T = any> {
  /** 数据列表 */
  list: T[];
  /** 总记录数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 */
  totalPages: number;
}

/**
 * 数据库分页参数（内部使用）
 */
export interface DbPageParams {
  /** SQL LIMIT 值 */
  limit: number;
  /** SQL OFFSET 值 */
  offset: number;
  /** 页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
}
