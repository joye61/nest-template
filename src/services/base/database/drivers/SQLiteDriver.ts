import { AsyncLocalStorage } from 'async_hooks';
import { DatabaseSync, StatementResultingChanges } from 'node:sqlite';
import {
  DatabaseConfig,
  IDatabaseDriver,
  ResultHeader,
  TransactionCallback,
} from './IDatabaseDriver';

/**
 * SQLite 驱动实现
 *
 * 基于 Node.js 内置 SQLite，使用单连接串行执行模型。transaction() 会在整个异步
 * 回调期间独占连接，避免其他请求意外加入当前事务。
 */
export class SQLiteDriver implements IDatabaseDriver {
  readonly type = 'sqlite' as const;

  private readonly database: DatabaseSync;
  private readonly transactionStore = new AsyncLocalStorage<boolean>();
  private operationQueue: Promise<void> = Promise.resolve();
  private manualTransaction = false;
  private manualRelease?: () => void;
  private closed = false;

  constructor(config: DatabaseConfig | string) {
    const resolved = this.resolveConfig(config);
    this.database = new DatabaseSync(resolved.filename, {
      readOnly: resolved.readOnly,
      timeout: resolved.timeout,
      enableForeignKeyConstraints: resolved.enableForeignKeyConstraints,
    });
    this.database.function('regexp', (pattern: string, value: unknown) => {
      if (value === null || value === undefined) {
        return 0;
      }
      return new RegExp(pattern).test(String(value)) ? 1 : 0;
    });
  }

  /**
   * 获取 Node.js 原始 SQLite 连接
   */
  getDatabase(): DatabaseSync {
    return this.database;
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.runExclusive(() => {
      const statement = this.database.prepare(sql);
      return statement.all(...this.normalizeParams(params)) as T[];
    });
  }

  async execute(sql: string, params?: any[]): Promise<ResultHeader> {
    return this.runExclusive(() => {
      const statement = this.database.prepare(sql);
      const result = statement.run(
        ...this.normalizeParams(params),
      ) as StatementResultingChanges;
      const isPlainInsert =
        /^\s*(INSERT|REPLACE)\b/i.test(sql) && !/\bON\s+CONFLICT\b/i.test(sql);

      return {
        affectedRows: Number(result.changes),
        insertId:
          !isPlainInsert || result.lastInsertRowid === 0
            ? undefined
            : Number(result.lastInsertRowid),
      };
    });
  }

  format(sql: string, params?: any[]): string {
    let index = 0;
    return sql.replace(/\?/g, () => {
      if (!params || index >= params.length) {
        return '?';
      }
      return this.formatValue(params[index++]);
    });
  }

  async begin(): Promise<void> {
    if (this.manualTransaction) {
      throw new Error('事务已经开始，不能重复开启');
    }
    this.manualRelease = await this.acquireLock();
    try {
      this.assertOpen();
      this.database.exec('BEGIN IMMEDIATE');
      this.manualTransaction = true;
    } catch (error) {
      this.manualRelease();
      this.manualRelease = undefined;
      throw error;
    }
  }

  async commit(): Promise<void> {
    if (!this.manualTransaction) {
      throw new Error('没有活动的事务可以提交');
    }
    try {
      this.database.exec('COMMIT');
    } finally {
      this.finishManualTransaction();
    }
  }

  async rollback(): Promise<void> {
    if (!this.manualTransaction) {
      throw new Error('没有活动的事务可以回滚');
    }
    try {
      this.database.exec('ROLLBACK');
    } finally {
      this.finishManualTransaction();
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.manualTransaction) {
      await this.rollback();
    }
    await this.withLock(() => {
      this.database.close();
      this.closed = true;
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    if (this.transactionStore.getStore()) {
      return await callback();
    }

    return this.withLock(async () => {
      this.assertOpen();
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const result = await this.transactionStore.run(true, callback);
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          // 保留原始业务异常
        }
        throw error;
      }
    });
  }

  private resolveConfig(config: DatabaseConfig | string): {
    filename: string;
    readOnly: boolean;
    timeout: number;
    enableForeignKeyConstraints: boolean;
  } {
    if (typeof config === 'string') {
      return {
        filename: this.parseFilename(config),
        readOnly: false,
        timeout: 5000,
        enableForeignKeyConstraints: true,
      };
    }

    return {
      filename: this.parseFilename(
        config.connectionString ||
          config.filename ||
          config.database ||
          ':memory:',
      ),
      readOnly: config.readOnly === true,
      timeout: config.timeout ?? 5000,
      enableForeignKeyConstraints: config.enableForeignKeyConstraints !== false,
    };
  }

  private parseFilename(value: string): string {
    if (!value.startsWith('sqlite:')) {
      return value;
    }
    if (!value.startsWith('sqlite://')) {
      return value.slice('sqlite:'.length);
    }

    const url = new URL(value);
    let filename = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:\//.test(filename)) {
      filename = filename.slice(1);
    }
    return filename === '/:memory:' ? ':memory:' : filename;
  }

  private normalizeParams(params?: any[]): any[] {
    return (params || []).map((value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      if (typeof value === 'boolean') {
        return value ? 1 : 0;
      }
      return value;
    });
  }

  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }
    const normalized =
      value instanceof Date ? value.toISOString() : String(value);
    return `'${normalized.replace(/'/g, "''")}'`;
  }

  private async runExclusive<T>(operation: () => T): Promise<T> {
    this.assertOpen();
    if (this.transactionStore.getStore() || this.manualTransaction) {
      return operation();
    }
    return this.withLock(operation);
  }

  private async withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    const release = await this.acquireLock();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async acquireLock(): Promise<() => void> {
    const previous = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }

  private finishManualTransaction(): void {
    this.manualTransaction = false;
    this.manualRelease?.();
    this.manualRelease = undefined;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('SQLite 数据库连接已关闭');
    }
  }
}
