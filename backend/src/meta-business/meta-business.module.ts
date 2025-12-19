import { Module } from '@nestjs/common';
import { MetaBusinessService } from './meta-business.service';
import { MetaBusinessController } from './meta-business.controller';

@Module({
  controllers: [MetaBusinessController],
  providers: [MetaBusinessService],
  exports: [MetaBusinessService],
})
export class MetaBusinessModule {}

