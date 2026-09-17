import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Post,
  Req,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import cookie from 'cookie-parser';
import type { Request } from 'express';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Utils } from 'src/common/Utils';
import { Errors } from 'src/errors';
import { GlobalExceptionFilter } from 'src/exception';
import { AppModule } from 'src/module';
import { globalValidation } from 'src/validation';
import { MySQLService } from 'src/services/base/MySQLService';
import { TableService } from 'src/services/base/TableService';
import { BaseModule } from 'src/services/base/module';
import type { OperationResult } from 'src/services/base/mysql';

const completedResultReaders: Array<() => OperationResult | undefined> = [];
const resultRequestWaiters: Array<() => void> = [];

/** 验证隐式类型转换和白名单处理的请求参数。 */
class CompatibilityDto {
  @ApiProperty({ description: '数量', minimum: 1 })
  @IsInt()
  @Min(1)
  count!: number;
}

/** 仅供依赖兼容性测试使用的控制器。 */
@Controller('compatibility')
class CompatibilityController {
  constructor(private readonly tables: TableService) {}

  /** 验证请求结果隔离及响应结束、异常和断连时的上下文释放。 */
  @Get('database-result')
  async databaseResult(@Req() request: Request) {
    const table = this.tables.example;
    const before = table.getLastResult();
    const own = await table.update({ data: {} });
    const resume = AsyncLocalStorage.snapshot();
    completedResultReaders.push(() => resume(() => table.getLastResult()));

    if (request.query.mode === 'error') {
      throw new BadRequestException('结果上下文异常测试');
    }
    if (request.query.mode === 'close') {
      request.res!.destroy();
      return;
    }
    await new Promise<void>((resolve) => {
      resultRequestWaiters.push(resolve);
      if (resultRequestWaiters.length === 2) {
        for (const release of resultRequestWaiters.splice(0)) release();
      }
    });
    return Utils.json({
      empty: before === undefined,
      isolated: table.getLastResult() === own,
    });
  }

  /** 返回经过可信代理规则解析的客户端地址。 */
  @Get('ip')
  ip(@Req() request: Request) {
    return Utils.json(Utils.ip(request));
  }

  /** 返回经过全局验证管道处理的请求。 */
  @Post()
  @HttpCode(200)
  echo(@Body() body: CompatibilityDto) {
    return Utils.json(body);
  }
}

/** 加载实际应用及测试控制器，不访问外部数据库。 */
@Module({
  imports: [AppModule, BaseModule],
  controllers: [CompatibilityController],
})
class CompatibilityModule {}

/** 检查应用初始化、Swagger 和 HTTP 验证行为。 */
async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(
    CompatibilityModule,
    { logger: false, rawBody: true, bodyParser: true, abortOnError: false },
  );

  try {
    app.use(cookie());
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(globalValidation);

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('兼容性测试').setVersion('1.0').build(),
    );
    SwaggerModule.setup('__api__', app, document);
    await app.listen(0, '127.0.0.1');

    assert.ok(app.get(ConfigService));
    assert.equal(
      app.get(TableService).example,
      app.get(MySQLService).table('example'),
    );
    assert.ok(app.get(SchedulerRegistry));
    assert.ok(document.paths['/compatibility']?.post);
    assert.ok(document.components?.schemas?.CompatibilityDto);

    const baseUrl = await app.getUrl();
    const resultResponses = await Promise.all(
      [1, 2].map(async () => {
        const response = await fetch(
          `${baseUrl}/compatibility/database-result`,
          {
            signal: AbortSignal.timeout(5000),
          },
        );
        assert.equal(response.status, 200);
        return response.json();
      }),
    );
    for (const response of resultResponses) {
      assert.deepEqual(response.data, { empty: true, isolated: true });
    }
    const failedResult = await fetch(
      `${baseUrl}/compatibility/database-result?mode=error`,
      {
        signal: AbortSignal.timeout(5000),
      },
    );
    assert.equal(failedResult.status, 400);
    await failedResult.text();
    await assert.rejects(
      fetch(`${baseUrl}/compatibility/database-result?mode=close`, {
        signal: AbortSignal.timeout(5000),
      }),
    );
    assert.equal(completedResultReaders.length, 4);
    for (const read of completedResultReaders) {
      assert.equal(read(), undefined, '已结束 HTTP 请求不再持有操作结果');
    }
    completedResultReaders.length = 0;

    const ipHeaders = {
      'x-real-ip': '203.0.113.99',
      'x-forwarded-for': '203.0.113.99, 198.51.100.20',
      'cf-connecting-ip': '203.0.113.99',
      'x-client-ip': '203.0.113.99',
    };
    const directResponse = await fetch(`${baseUrl}/compatibility/ip`, {
      headers: ipHeaders,
      signal: AbortSignal.timeout(5000),
    });
    assert.equal((await directResponse.json()).data, '127.0.0.1');

    app.set('trust proxy', 'loopback');
    const proxyResponse = await fetch(`${baseUrl}/compatibility/ip`, {
      headers: ipHeaders,
      signal: AbortSignal.timeout(5000),
    });
    assert.equal((await proxyResponse.json()).data, '198.51.100.20');
    app.set('trust proxy', false);

    const validResponse = await fetch(`${baseUrl}/compatibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: '2', unexpected: '应当移除' }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(validResponse.status, 200);
    const validBody = await validResponse.json();
    assert.equal(validBody.code, 0);
    assert.deepEqual(validBody.data, { count: 2 });

    const invalidResponse = await fetch(`${baseUrl}/compatibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 0 }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(invalidResponse.status, 200);
    const invalidBody = await invalidResponse.json();
    assert.equal(invalidBody.code, Errors.ValidationFailed[0]);
    assert.equal(invalidBody.data, null);
    assert.ok(invalidBody.message);

    const swaggerResponse = await fetch(`${baseUrl}/__api__-json`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(swaggerResponse.status, 200);
    assert.ok((await swaggerResponse.json()).paths['/compatibility']);
    console.log('Nest 应用、Swagger 和参数验证兼容性测试通过');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
