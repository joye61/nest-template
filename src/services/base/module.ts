import { Module } from '@nestjs/common';
import { MySQLService } from './MySQLService';
import { TableService } from './TableService';
import { RedisService } from './RedisService';
import { MutexLock } from './MutexLock';
import { RequestService } from './RequestService';

@Module({
  providers: [
    MySQLService,
    TableService,
    RedisService,
    MutexLock,
    RequestService,
  ],
  exports: [
    MySQLService,
    TableService,
    RedisService,
    MutexLock,
    RequestService,
  ],
})
export class BaseModule {}
