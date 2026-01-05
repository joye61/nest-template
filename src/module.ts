import { Module } from '@nestjs/common';
import { AppConfig } from './config';
import { ScheduleModule } from '@nestjs/schedule';
import { CtlAdminModule } from './controllers/admin/module';
import { CtlAppModule } from './controllers/app/module';

/**
 * 应用根模块
 */
@Module({
  imports: [
    // 配置模块（全局）
    AppConfig.forRoot(),
    // 定时任务模块
    ScheduleModule.forRoot(),

    // 控制器业务模块
    CtlAdminModule,
    CtlAppModule,
  ],
})
export class AppModule {}
