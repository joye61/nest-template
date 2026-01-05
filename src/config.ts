import { Module, DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigFactory } from '@nestjs/config';
import { Utils } from './common/Utils';
import { Log } from './common/Log';
import defaultConfig from './configs/default';

/**
 * 配置模块
 * 支持多环境配置，特定环境配置会覆盖默认配置
 *
 * 配置文件说明：
 * - .env                | ./configs/default.ts        - 默认配置（所有环境通用）
 * - .env.development    | ./configs/development.ts    - 开发环境配置
 * - .env.production     | ./configs/production.ts     - 生产环境配置
 */
@Module({})
export class AppConfig {
  /**
   * 创建配置模块
   */
  static forRoot(): DynamicModule {
    const env = Utils.env();
    const envFilePath: string[] = ['.env'];
    const load: Array<ConfigFactory> = [() => defaultConfig];

    // 加载环境特定的配置
    if (env) {
      envFilePath.unshift(`.env.${env}`);
      load.push(async () => {
        let result: Record<string, any> = {};
        try {
          const loaded = await import(`./configs/${env}.js`);
          result = loaded.default.default || loaded.default;
        } catch (error) {
          // 环境配置文件不存在时使用默认配置，不打印错误
          Log.e(`No ${env} config file found, using default config`);
        }
        return result;
      });
    }

    return {
      module: AppConfig,
      imports: [
        ConfigModule.forRoot({
          load,
          envFilePath,
          isGlobal: true,
          cache: true,
        }),
      ],
      exports: [ConfigModule],
    };
  }
}
