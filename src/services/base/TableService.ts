import { Inject, Injectable } from '@nestjs/common';
import { Table } from './database/Table';
import { DATABASE_SERVICE } from './DatabaseService';
import type { DatabaseService } from './DatabaseService';

/**
 * 表管理服务
 *
 * 集中管理所有表实例，避免重复创建
 */
@Injectable()
export class TableService {
  /** 示例表 */
  public example: Table;

  constructor(@Inject(DATABASE_SERVICE) private db: DatabaseService) {
    this.example = this.db.table('example');
  }
}
