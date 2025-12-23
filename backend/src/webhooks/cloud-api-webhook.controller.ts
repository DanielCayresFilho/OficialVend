import { Controller, Get, Post, Body, Query, Headers, HttpCode, HttpStatus, BadRequestException, Req, RawBodyRequest, Res } from '@nestjs/common';
import { Request, Response } from 'express';
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
   * IMPORTANTE: A Meta espera que retornemos APENAS o challenge como texto puro, não JSON
   */
  @Get('cloud-api')
  verifyWebhook(
    @Res() res: Response,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    // Buscar token de verificação da variável de ambiente (obrigatório)
    const expectedToken = process.env.WEBHOOK_VERIFY_TOKEN;
    
    if (!expectedToken) {
      console.error('❌ [Webhook] WEBHOOK_VERIFY_TOKEN não configurado no .env');
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).type('text/plain').send('WEBHOOK_VERIFY_TOKEN não configurado');
    }

    // Validar parâmetros obrigatórios
    if (!mode || !verifyToken || !challenge) {
      console.warn(`⚠️ [Webhook] Parâmetros faltando - mode: ${mode}, verifyToken: ${verifyToken ? 'presente' : 'ausente'}, challenge: ${challenge ? 'presente' : 'ausente'}`);
      return res.status(HttpStatus.BAD_REQUEST).type('text/plain').send('Parâmetros obrigatórios faltando');
    }

    // Log para debug (sem expor o token completo)
    const tokenMatch = verifyToken === expectedToken;
    console.log(`🔍 [Webhook] Verificação recebida - mode: ${mode}, token length: ${verifyToken.length}, token match: ${tokenMatch}`);

    if (mode === 'subscribe' && tokenMatch) {
      console.log(`✅ [Webhook] Verificação bem-sucedida, retornando challenge (length: ${challenge.length})`);
      // Retornar challenge como texto puro (text/plain) - A Meta espera APENAS o challenge, sem JSON
      return res.status(HttpStatus.OK).type('text/plain').send(challenge);
    }

    console.warn(`⚠️ [Webhook] Verificação falhou - mode: ${mode}, token match: ${tokenMatch}`);
    return res.status(HttpStatus.FORBIDDEN).type('text/plain').send('Token de verificação inválido');
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

