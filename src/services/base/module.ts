import { Module } from '@nestjs/common';
import { MySQLService } from './MySQLService';
import { TableService } from './TableService';
import { RedisService } from './RedisService';
import { MutexLock } from './MutexLock';
import { RequestService } from './RequestService';
import { OrderNoService } from './OrderNoService';

@Module({
  providers: [
    MySQLService,
    TableService,
    RedisService,
    MutexLock,
    RequestService,
    OrderNoService,
  ],
  exports: [
    MySQLService,
    TableService,
    RedisService,
    MutexLock,
    RequestService,
    OrderNoService,
  ],
})
export class BaseModule {}
