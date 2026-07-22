import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Database, DatabaseConfig } from './database';
import { MySQLService } from './MySQLService';

/**
 * SQLite 服务入口类
 *
 * 复用 MySQLService 的表标识解析和快捷 API，仅覆盖数据库配置解析。
 */
@Injectable()
export class SQLiteService extends MySQLService {
  constructor(config: ConfigService) {
    super(config);
  }

  /**
   * 根据名称获取 SQLite 数据库实例
   *
   * 配置优先级：
   * 1. 环境变量 SQLITE_URL_{NAME}
   * 2. 配置对象 sqlite.{name}
   *
   * URL 可使用 sqlite: 协议，也可以直接填写 SQLite 文件路径。
   *
   * @param name 数据库名称，不区分大小写
   */
  public override database(name: string): Database {
    const normalizedName = name.toLowerCase();
    const envKey = `SQLITE_URL_${normalizedName.toUpperCase()}`;
    const url = this.config.get<string>(envKey);

    if (url) {
      this.assertSQLiteLocation(url, envKey);
      return Database.create(url, 'sqlite');
    }

    const configKey = `sqlite.${normalizedName}`;
    const config = this.config.get<DatabaseConfig>(configKey);

    if (config) {
      this.assertSQLiteConfig(config, configKey);
      return Database.create({ ...config, type: 'sqlite' });
    }

    throw new Error(
      `SQLite 数据库配置未找到: ${envKey} 或 ${configKey}\n` +
        `请在 .env 文件或配置文件中设置:\n` +
        `  方式 1: ${envKey}=sqlite:./data/${normalizedName}.db\n` +
        `  方式 2: 在配置文件中设置 sqlite.${normalizedName} 对象`,
    );
  }

  /**
   * 校验 SQLite 配置对象，避免误把其他数据库连接串当成 SQLite 文件路径。
   */
  private assertSQLiteConfig(config: DatabaseConfig, source: string): void {
    if (config.type && config.type !== 'sqlite') {
      throw new Error(`${source}.type 必须为 sqlite`);
    }

    if (config.connectionString) {
      this.assertSQLiteLocation(config.connectionString, `${source}.connectionString`);
    }

    if (config.database) {
      this.assertSQLiteLocation(config.database, `${source}.database`);
    }

    if (config.filename) {
      this.assertSQLiteLocation(config.filename, `${source}.filename`);
    }
  }

  /**
   * 校验 SQLite 目标地址，允许 sqlite: 协议或普通文件路径。
   */
  private assertSQLiteLocation(value: string, source: string): void {
    if (/^(mysql|postgresql|mssql):/i.test(value)) {
      throw new Error(`${source} 不是有效的 SQLite 连接地址`);
    }
  }
}
