import { Database, Table, TransactionResult } from './database';

/**
 * 数据库服务统一注入令牌
 */
export const DATABASE_SERVICE = Symbol('DATABASE_SERVICE');

/**
 * MySQLService 与 SQLiteService 共同遵循的服务契约
 */
export interface DatabaseService {
  database(name: string): Database;
  table(id: string, separator?: string): Table;
  query<T = any>(
    statement: string,
    holders?: any[],
    separator?: string,
  ): Promise<T[]>;
  transaction<T = any>(
    callback: () => TransactionResult<T>,
    dbname?: string,
  ): Promise<T>;
}
