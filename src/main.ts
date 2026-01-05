import { NestFactory } from '@nestjs/core';
import { AppModule } from './module';
import { ConfigService } from '@nestjs/config';
import { GlobalExceptionFilter } from './exception';
import { Logger } from '@nestjs/common';
import { globalValidation } from './validation';
import cookie from 'cookie-parser';
import { Utils } from './common/Utils';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CtlAppModule } from './controllers/app/module';
import { NestExpressApplication } from '@nestjs/platform-express';

/**
 * 应用程序启动入口
 */
(async () => {
  // 创建应用实例
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: true,
  });

  if (!Utils.isProd()) {
    const docConfig = new DocumentBuilder()
      .setTitle('Project Title')
      .setDescription(
        `Here you can write some project description information using Markdown.<br/>
        Current environment: ${process.env.NODE_ENV || 'development'}`,
      )
      .setVersion('1.0')
      .build();
    const documentFactory = () =>
      SwaggerModule.createDocument(app, docConfig, {
        include: [CtlAppModule],
      });
    SwaggerModule.setup('__api__', app, documentFactory);
  }

  // 获取配置服务
  const config = app.get<ConfigService>(ConfigService);
  const port = config.get<string>('PORT');
  const cors = config.get('cors');

  // 使用cookie解析中间件
  app.use(cookie());

  // 配置CORS
  if (cors) {
    app.enableCors(cors);
  }

  // 设置全局前缀（可选）
  // app.setGlobalPrefix('api');

  // 注册全局异常过滤器
  app.useGlobalFilters(new GlobalExceptionFilter());

  // 注册全局验证管道
  app.useGlobalPipes(globalValidation);

  // 启动应用
  await app.listen(port ?? 3001);

  const logger = new Logger('Bootstrap');
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`api docs is running on: http://localhost:${port}/__api__`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
})();
