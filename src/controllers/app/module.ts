import { Module } from '@nestjs/common';
import { BaseModule } from 'src/services/base/module';

@Module({
  imports: [BaseModule],
  controllers: [],
})
export class CtlAppModule {}
