import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MySQLService } from './MySQLService';
import { SQLiteService } from './SQLiteService';
import { TableService } from './TableService';
import { RedisService } from './RedisService';
import { MutexLock } from './MutexLock';
import { RequestService } from './RequestService';
import { OrderNoService } from './OrderNoService';
import { CaptchaService } from './CaptchaService';
import { DATABASE_SERVICE } from './DatabaseService';
import type { DatabaseService } from './DatabaseService';

export function shouldUseSQLiteForTableService(
  config: ConfigService,
): boolean {
  const configuredType = (
    config.get<string>('DATABASE_TYPE') ||
    config.get<string>('database.type') ||
    ''
  ).toLowerCase();

  if (configuredType && configuredType !== 'mysql' && configuredType !== 'sqlite') {
    throw new Error(`TableService 不支持数据库类型: ${configuredType}`);
  }

  if (configuredType === 'sqlite') {
    return true;
  }

  if (configuredType === 'mysql') {
    return false;
  }

  const hasSQLiteDefault =
    !!config.get<string>('SQLITE_URL_DEFAULT') ||
    !!config.get('sqlite.default');
  const hasMySQLDefault =
    !!config.get<string>('MYSQL_URL_DEFAULT') ||
    !!config.get('mysql.default');

  return hasSQLiteDefault && !hasMySQLDefault;
}

const databaseServiceProvider = {
  provide: DATABASE_SERVICE,
  inject: [ConfigService, MySQLService, SQLiteService],
  useFactory: (
    config: ConfigService,
    mysql: MySQLService,
    sqlite: SQLiteService,
  ): DatabaseService => {
    if (shouldUseSQLiteForTableService(config)) {
      return sqlite;
    }

    return mysql;
  },
};

@Module({
  providers: [
    MySQLService,
    SQLiteService,
    databaseServiceProvider,
    TableService,
    RedisService,
    MutexLock,
    RequestService,
    OrderNoService,
    CaptchaService,
  ],
  exports: [
    MySQLService,
    SQLiteService,
    DATABASE_SERVICE,
    TableService,
    RedisService,
    MutexLock,
    RequestService,
    OrderNoService,
    CaptchaService,
  ],
})
export class BaseModule {}
