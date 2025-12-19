import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import { AppLoggerService } from '../logger/logger.service';
import { HumanizationService } from '../humanization/humanization.service';
import { SpintaxService } from '../spintax/spintax.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import { MediaService } from '../media/media.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';

interface SendMessageOptions {
  phoneNumberId: string;
  token: string;
  contactPhone: string;
  message: string;
  messageType?: 'text' | 'image' | 'document' | 'video' | 'audio';
  mediaUrl?: string;
  fileName?: string;
  traceId?: string;
}

@Injectable()
export class MessageSendingService {
  constructor(
    private prisma: PrismaService,
    private circuitBreakerService: CircuitBreakerService,
    private logger: AppLoggerService,
    private spintaxService: SpintaxService,
    private phoneValidationService: PhoneValidationService,
    private whatsappCloudService: WhatsappCloudService,
    private mediaService: MediaService,
  ) {}

  /**
   * Envia mensagem via WhatsApp Cloud API com circuit breaker e retry inteligente
   */
  async sendMessage(options: SendMessageOptions): Promise<{ success: boolean; error?: string }> {
    const { phoneNumberId, token, contactPhone, message, messageType, mediaUrl, fileName, traceId } = options;

    try {
      const cleanPhone = this.phoneValidationService.cleanPhone(contactPhone);
      
      // Aplicar Spintax se necessário
      let finalMessage = message;
      if (this.spintaxService.hasSpintax(message)) {
        finalMessage = this.spintaxService.applySpintax(message);
        this.logger.log(
          `Spintax aplicado: "${message}" → "${finalMessage}"`,
          'MessageSending',
          { traceId },
        );
      }

      // Criar ação para circuit breaker
      const sendAction = async () => {
        if (messageType === 'image' && mediaUrl) {
          // Upload e envio de imagem
          let filePath: string;
          if (mediaUrl.startsWith('/media/')) {
            const filename = mediaUrl.replace('/media/', '');
            filePath = await this.mediaService.getFilePath(filename);
          } else if (mediaUrl.startsWith('http')) {
            const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
            if (mediaUrl.startsWith(appUrl)) {
              const urlPath = new URL(mediaUrl).pathname;
              const filename = urlPath.replace('/media/', '');
              filePath = await this.mediaService.getFilePath(filename);
            } else {
              const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
              filePath = path.join('./uploads', `temp-${Date.now()}-image.jpg`);
              await fs.mkdir('./uploads', { recursive: true });
              await fs.writeFile(filePath, response.data);
            }
          } else {
            filePath = path.join('./uploads', mediaUrl.replace(/^\/media\//, ''));
          }

          const uploadResult = await this.whatsappCloudService.uploadMedia({
            phoneNumberId,
            token,
            mediaPath: filePath,
            mediaType: 'image',
          });

          const result = await this.whatsappCloudService.sendMedia({
            phoneNumberId,
            token,
            to: contactPhone,
            mediaType: 'image',
            mediaId: uploadResult.id,
            caption: finalMessage,
          });

          if (filePath.includes('temp-')) {
            await fs.unlink(filePath).catch(() => {});
          }

          return result;
        } else if ((messageType === 'document' || messageType === 'video' || messageType === 'audio') && mediaUrl) {
          // Upload e envio de mídia
          const getMediaType = (filename: string): 'document' | 'video' | 'audio' => {
            const ext = filename.split('.').pop()?.toLowerCase();
            if (['mp4', 'mpeg', 'avi', 'mov'].includes(ext || '')) return 'video';
            if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext || '')) return 'audio';
            return 'document';
          };
          const mediaType = getMediaType(fileName || mediaUrl.split('/').pop() || 'document.pdf');

          let filePath: string;
          if (mediaUrl.startsWith('/media/')) {
            const filename = mediaUrl.replace('/media/', '');
            filePath = await this.mediaService.getFilePath(filename);
          } else if (mediaUrl.startsWith('http')) {
            const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
            if (mediaUrl.startsWith(appUrl)) {
              const urlPath = new URL(mediaUrl).pathname;
              const filename = urlPath.replace('/media/', '');
              filePath = await this.mediaService.getFilePath(filename);
            } else {
              const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
              filePath = path.join('./uploads', `temp-${Date.now()}-${fileName || 'file'}`);
              await fs.mkdir('./uploads', { recursive: true });
              await fs.writeFile(filePath, response.data);
            }
          } else {
            filePath = path.join('./uploads', mediaUrl.replace(/^\/media\//, ''));
          }

          const uploadResult = await this.whatsappCloudService.uploadMedia({
            phoneNumberId,
            token,
            mediaPath: filePath,
            mediaType,
          });

          const result = await this.whatsappCloudService.sendMedia({
            phoneNumberId,
            token,
            to: contactPhone,
            mediaType,
            mediaId: uploadResult.id,
            caption: finalMessage,
            filename: fileName,
          });

          if (filePath.includes('temp-')) {
            await fs.unlink(filePath).catch(() => {});
          }

          return result;
        } else {
          // Enviar mensagem de texto
          return await this.whatsappCloudService.sendTextMessage({
            phoneNumberId,
            token,
            to: contactPhone,
            message: finalMessage,
          });
        }
      };

      // Executar através do circuit breaker
      const breakerName = `cloud-api-${phoneNumberId}`;
      const response = await this.circuitBreakerService.execute(
        breakerName,
        sendAction,
        [],
        {
          timeout: 30000,
          errorThresholdPercentage: 50,
          resetTimeout: 30000,
        },
      );

      this.logger.log(
        `Mensagem enviada com sucesso para ${cleanPhone}`,
        'MessageSending',
        { contactPhone: cleanPhone, messageType, traceId },
      );

      return { success: true };
    } catch (error: any) {
      const errorMessage = error.message || 'Erro desconhecido';
      const isCircuitOpen = error.name === 'CircuitBreakerOpenError';
      
      this.logger.error(
        `Erro ao enviar mensagem para ${contactPhone}`,
        error.stack,
        'MessageSending',
        {
          contactPhone,
          messageType,
          error: errorMessage,
          isCircuitOpen,
          traceId,
        },
      );

      return {
        success: false,
        error: isCircuitOpen
          ? 'Serviço temporariamente indisponível. Tente novamente em alguns instantes.'
          : errorMessage,
      };
    }
  }

  /**
   * Envia typing indicator (Cloud API não suporta typing indicator nativamente)
   * Este método é mantido para compatibilidade mas não faz nada
   */
  async sendTypingIndicator(
    phoneNumberId: string,
    token: string,
    contactPhone: string,
    isTyping: boolean,
    traceId?: string,
  ): Promise<void> {
    // WhatsApp Cloud API não suporta typing indicator
    // Este método é mantido para compatibilidade mas não faz nada
    this.logger.debug(
      `Typing indicator solicitado (não suportado pela Cloud API)`,
      'MessageSending',
      { contactPhone, isTyping, traceId },
    );
  }
}

