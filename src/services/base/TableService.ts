import { Injectable } from '@nestjs/common';
import { MySQLService } from './MySQLService';
import { Table } from './database/Table';

/**
 * 表管理服务
 *
 * 集中管理所有表实例，避免重复创建
 */
@Injectable()
export class TableService {
  /** 示例表 */
  public example: Table;

  constructor(private db: MySQLService) {
    this.example = this.db.table('example');
  }
}
