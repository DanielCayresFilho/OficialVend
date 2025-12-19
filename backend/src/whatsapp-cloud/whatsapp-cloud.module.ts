import { Module } from '@nestjs/common';
import { WhatsappCloudService } from './whatsapp-cloud.service';

@Module({
  providers: [WhatsappCloudService],
  exports: [WhatsappCloudService],
})
export class WhatsappCloudModule {}

