import { Module } from '@nestjs/common';
import { AppsService } from './apps.service';
import { AppsController } from './apps.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [AppsController],
  providers: [AppsService, PrismaService],
  exports: [AppsService],
})
export class AppsModule {}

