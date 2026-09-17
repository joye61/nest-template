import { Injectable } from '@nestjs/common';
import { Table } from './mysql';
import { MySQLService } from './MySQLService';

/**
 * 表管理服务
 *
 * 集中管理所有表实例，避免重复创建
 */
@Injectable()
export class TableService {
  /** 示例表 */
  public example: Table;

  constructor(private readonly db: MySQLService) {
    this.example = this.db.table('example');
  }
}
