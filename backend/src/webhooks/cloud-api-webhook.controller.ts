import { Controller, Get, Post, Body, Query, Headers, HttpCode, HttpStatus, BadRequestException, Req, RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { CloudApiWebhookService } from './cloud-api-webhook.service';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import { PrismaService } from '../prisma.service';

@Controller('webhooks')
export class CloudApiWebhookController {
  constructor(
    private readonly webhookService: CloudApiWebhookService,
    private readonly whatsappCloudService: WhatsappCloudService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /webhooks/cloud-api
   * Verificação de webhook do Meta (challenge)
   */
  @Get('cloud-api')
  @HttpCode(HttpStatus.OK)
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ) {
    // Buscar token de verificação da variável de ambiente (obrigatório)
    const expectedToken = process.env.WEBHOOK_VERIFY_TOKEN;
    
    if (!expectedToken) {
      throw new BadRequestException('WEBHOOK_VERIFY_TOKEN não configurado');
    }

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return challenge;
    }

    throw new BadRequestException('Token de verificação inválido');
  }

  /**
   * POST /webhooks/cloud-api
   * Recebimento de eventos do WhatsApp Cloud API
   */
  @Post('cloud-api')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    try {
      // Validar assinatura se appSecret estiver configurado
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      if (appSecret && signature) {
        // Usar raw body se disponível, senão usar JSON stringify do body parseado
        const rawBody = req.rawBody 
          ? (Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : req.rawBody)
          : JSON.stringify(body);
        const isValid = this.whatsappCloudService.verifyWebhookSignature(
          rawBody,
          signature,
          appSecret,
        );

        if (!isValid) {
          throw new BadRequestException('Assinatura do webhook inválida');
        }
      }

      // Processar webhook
      const result = await this.webhookService.handleWebhook(body);
      return result;
    } catch (error) {
      throw new BadRequestException(`Erro ao processar webhook: ${error.message}`);
    }
  }
}

