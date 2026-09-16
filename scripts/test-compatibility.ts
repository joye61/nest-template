import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import cookie from 'cookie-parser';
import assert from 'node:assert/strict';
import { Utils } from 'src/common/Utils';
import { Errors } from 'src/errors';
import { GlobalExceptionFilter } from 'src/exception';
import { AppModule } from 'src/module';
import { globalValidation } from 'src/validation';

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
  /** 返回经过全局验证管道处理的请求。 */
  @Post()
  @HttpCode(200)
  echo(@Body() body: CompatibilityDto) {
    return Utils.json(body);
  }
}

/** 加载实际应用及测试控制器，不访问外部数据库。 */
@Module({ imports: [AppModule], controllers: [CompatibilityController] })
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

    assert.equal(app.get(ConfigService).get('DATABASE_TYPE'), 'sqlite');
    assert.ok(app.get(SchedulerRegistry));
    assert.ok(document.paths['/compatibility']?.post);
    assert.ok(document.components?.schemas?.CompatibilityDto);

    const baseUrl = await app.getUrl();
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
