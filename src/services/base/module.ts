import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Table } from './mysql';
import { MySQLService } from './MySQLService';
import { TableService } from './TableService';
import { RedisService } from './RedisService';
import { MutexLock } from './MutexLock';
import { RequestService } from './RequestService';
import { OrderNoService } from './OrderNoService';
import { CaptchaService } from './CaptchaService';

@Module({
  providers: [
    MySQLService,
    TableService,
    RedisService,
    MutexLock,
    RequestService,
    OrderNoService,
    CaptchaService,
  ],
  exports: [
    MySQLService,
    TableService,
    RedisService,
    MutexLock,
    RequestService,
    OrderNoService,
    CaptchaService,
  ],
})
export class BaseModule implements NestModule {
  /** 为每个 HTTP 请求建立结果上下文，并在响应完成或连接关闭时释放。 */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((_request: Request, response: Response, next: NextFunction) => {
        void Table.withResultContext(async () => {
          let finish!: () => void;
          const completed = new Promise<void>((resolve) => {
            finish = resolve;
          });
          response.once('finish', finish);
          response.once('close', finish);
          try {
            next();
            await completed;
          } finally {
            response.off('finish', finish);
            response.off('close', finish);
          }
        }).catch(next);
      })
      .forRoutes('{*path}');
  }
}
