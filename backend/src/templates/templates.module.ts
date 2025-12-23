import { Module } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { PrismaService } from '../prisma.service';
import { WhatsappCloudModule } from '../whatsapp-cloud/whatsapp-cloud.module';
import { PhoneValidationModule } from '../phone-validation/phone-validation.module';

@Module({
  imports: [WhatsappCloudModule, PhoneValidationModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, PrismaService],
  exports: [TemplatesService],
})
export class TemplatesModule {}

