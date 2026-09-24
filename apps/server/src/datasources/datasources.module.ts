import { Module } from '@nestjs/common';
import { DatasourcesService } from './datasources.service';
import { DatasourcesController } from './datasources.controller';

@Module({
  controllers: [DatasourcesController],
  providers: [DatasourcesService],
  exports: [DatasourcesService],
})
export class DatasourcesModule {}
