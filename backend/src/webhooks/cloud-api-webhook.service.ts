import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { LinesService } from '../lines/lines.service';
import { MediaService } from '../media/media.service';
import { BlocklistService } from '../blocklist/blocklist.service';
import { ControlPanelService } from '../control-panel/control-panel.service';
import { SystemEventsService, EventType, EventModule, EventSeverity } from '../system-events/system-events.service';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import * as path from 'path';
import * as fs from 'fs/promises';

interface CloudApiWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product?: string;
        metadata?: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: { id: string; caption?: string; mime_type?: string };
          video?: { id: string; caption?: string; mime_type?: string };
          audio?: { id: string; mime_type?: string };
          document?: { id: string; caption?: string; filename?: string; mime_type?: string };
        }>;
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id: string;
          errors?: Array<{
            code: number;
            title: string;
            message?: string;
          }>;
        }>;
      };
      field: string;
    }>;
  }>;
}

@Injectable()
export class CloudApiWebhookService {
  private readonly logger = new Logger(CloudApiWebhookService.name);
  private readonly uploadsDir = './uploads';

  constructor(
    private prisma: PrismaService,
    private conversationsService: ConversationsService,
    private websocketGateway: WebsocketGateway,
    private linesService: LinesService,
    private mediaService: MediaService,
    private blocklistService: BlocklistService,
    private controlPanelService: ControlPanelService,
    private systemEventsService: SystemEventsService,
    private whatsappCloudService: WhatsappCloudService,
  ) {
    // Garantir que o diretório de uploads existe
    this.ensureUploadsDir();
  }

  private async ensureUploadsDir() {
    try {
      await fs.mkdir(this.uploadsDir, { recursive: true });
    } catch (error) {
      this.logger.warn(`Não foi possível criar diretório de uploads: ${error.message}`);
    }
  }

  /**
   * Processa webhook do WhatsApp Cloud API
   */
  async handleWebhook(data: CloudApiWebhookPayload): Promise<{ status: string; processed?: number; reason?: string; error?: string }> {
    try {
      this.logger.log('Webhook Cloud API recebido:', JSON.stringify(data, null, 2));

      if (!data.entry || !Array.isArray(data.entry)) {
        return { status: 'ignored', reason: 'Formato inválido' };
      }

      if (data.object !== 'whatsapp_business_account') {
        return { status: 'ignored', reason: 'Objeto não é whatsapp_business_account' };
      }

      let processedCount = 0;

      for (const entry of data.entry) {
        if (!entry.changes || !Array.isArray(entry.changes)) {
          continue;
        }

        for (const change of entry.changes) {
          if (change.field !== 'messages') {
            continue;
          }

          const value = change.value;
          const phoneNumberId = value.metadata?.phone_number_id;

          if (!phoneNumberId) {
            this.logger.warn('Webhook sem phone_number_id');
            continue;
          }

          // Buscar linha pelo numberId
          const line = await this.prisma.linesStock.findFirst({
            where: {
              numberId: phoneNumberId,
              oficial: true,
            },
            include: {
              operators: {
                include: {
                  user: true,
                },
              },
            },
          });

          if (!line) {
            this.logger.warn(`Linha não encontrada para phoneNumberId: ${phoneNumberId}`);
            continue;
          }

          // Processar mensagens recebidas
          if (value.messages && Array.isArray(value.messages)) {
            for (const message of value.messages) {
              // Processar TODAS as mensagens sem verificação de duplicatas
              // O WhatsApp Cloud API garante que cada mensagem tem um wamid único
              await this.processIncomingMessage(message, line, value.contacts);
              processedCount++;
            }
          }

          // Processar status de mensagens
          if (value.statuses && Array.isArray(value.statuses)) {
            for (const status of value.statuses) {
              await this.processMessageStatus(status, line);
              processedCount++;
            }
          }
        }
      }

      return { status: 'success', processed: processedCount };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook: ${error.message}`, error.stack);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Processa mensagem recebida
   */
  private async processIncomingMessage(
    message: any,
    line: any,
    contacts?: Array<{ profile: { name: string }; wa_id: string }>,
  ) {
    try {
      const from = message.from;
      const messageId = message.id;
      const timestamp = parseInt(message.timestamp) * 1000; // Converter para milissegundos

      // Buscar nome do contato
      let contactName = from;
      if (contacts && contacts.length > 0) {
        const contact = contacts.find(c => c.wa_id === from);
        if (contact) {
          contactName = contact.profile.name || from;
        }
      }

      // Extrair texto e tipo da mensagem
      let messageText = 'Mensagem recebida';
      let messageType = 'text';
      let mediaUrl: string | undefined;

      if (message.text) {
        messageText = message.text.body;
        messageType = 'text';
      } else if (message.image) {
        messageText = message.image.caption || 'Imagem recebida';
        messageType = 'image';
        // Baixar mídia
        try {
          const mediaBuffer = await this.whatsappCloudService.downloadMedia(
            message.image.id,
            line.token!,
          );
          const fileName = `${Date.now()}-${from}-image.jpg`;
          const filePath = path.join(this.uploadsDir, fileName);
          await fs.writeFile(filePath, mediaBuffer);
          mediaUrl = `/media/${fileName}`;
        } catch (error) {
          this.logger.error(`Erro ao baixar imagem: ${error.message}`);
        }
      } else if (message.video) {
        messageText = message.video.caption || 'Vídeo recebido';
        messageType = 'video';
        try {
          const mediaBuffer = await this.whatsappCloudService.downloadMedia(
            message.video.id,
            line.token!,
          );
          const fileName = `${Date.now()}-${from}-video.mp4`;
          const filePath = path.join(this.uploadsDir, fileName);
          await fs.writeFile(filePath, mediaBuffer);
          mediaUrl = `/media/${fileName}`;
        } catch (error) {
          this.logger.error(`Erro ao baixar vídeo: ${error.message}`);
        }
      } else if (message.audio) {
        messageText = 'Áudio recebido';
        messageType = 'audio';
        try {
          const mediaBuffer = await this.whatsappCloudService.downloadMedia(
            message.audio.id,
            line.token!,
          );
          const fileName = `${Date.now()}-${from}-audio.ogg`;
          const filePath = path.join(this.uploadsDir, fileName);
          await fs.writeFile(filePath, mediaBuffer);
          mediaUrl = `/media/${fileName}`;
        } catch (error) {
          this.logger.error(`Erro ao baixar áudio: ${error.message}`);
        }
      } else if (message.document) {
        messageText = message.document.caption || 'Documento recebido';
        messageType = 'document';
        try {
          const mediaBuffer = await this.whatsappCloudService.downloadMedia(
            message.document.id,
            line.token!,
          );
          const extension = message.document.filename?.split('.').pop() || 'pdf';
          const fileName = `${Date.now()}-${from}-document.${extension}`;
          const filePath = path.join(this.uploadsDir, fileName);
          await fs.writeFile(filePath, mediaBuffer);
          mediaUrl = `/media/${fileName}`;
        } catch (error) {
          this.logger.error(`Erro ao baixar documento: ${error.message}`);
        }
      }

      // Buscar ou criar contato
      let contact = await this.prisma.contact.findFirst({
        where: { phone: from },
      });

      if (!contact) {
        contact = await this.prisma.contact.create({
          data: {
            name: contactName,
            phone: from,
            segment: line.segment,
          },
        });
      }

      // Registrar resposta do cliente
      await this.controlPanelService.registerClientResponse(from);

      // Verificar frases de bloqueio
      const isBlockPhrase = await this.controlPanelService.checkBlockPhrases(messageText, line.segment);
      let blockedByPhrase = false;

      if (isBlockPhrase) {
        this.logger.log(`Frases de bloqueio detectada: ${messageText}`);
        blockedByPhrase = true;
        await this.blocklistService.create({
          name: contact.name,
          phone: from,
          cpf: contact.cpf,
        });
      }

      // Distribuir mensagem usando algoritmo inteligente
      const finalOperatorId = await this.linesService.distributeInboundMessage(line.id, from);

      // Se ainda não encontrou operador online, adicionar à fila
      if (!finalOperatorId) {
        await (this.prisma as any).messageQueue.create({
          data: {
            contactPhone: from,
            contactName: contact.name,
            message: messageText,
            messageType,
            mediaUrl,
            segment: line.segment || undefined,
            status: 'pending',
          },
        });

        await this.systemEventsService.logEvent(
          EventType.MESSAGE_QUEUED,
          EventModule.WEBHOOKS,
          {
            contactPhone: from,
            contactName: contact.name,
            messageType,
            lineId: line.id,
            linePhone: line.phone,
          },
          null,
          EventSeverity.WARNING,
        );

        return { status: 'queued' };
      }

      // Criar conversa
      const conversation = await this.conversationsService.create({
        contactName: contact.name,
        contactPhone: from,
        segment: line.segment,
        userName: finalOperatorId
          ? line.operators.find(lo => lo.userId === finalOperatorId)?.user.name || null
          : null,
        userLine: line.id,
        userId: finalOperatorId,
        message: messageText,
        sender: 'contact',
        messageType,
        mediaUrl,
        // messageId removido temporariamente até a coluna existir no banco
      });

      // Registrar evento
      await this.systemEventsService.logEvent(
        EventType.MESSAGE_RECEIVED,
        EventModule.WEBHOOKS,
        {
          contactPhone: from,
          contactName: contact.name,
          messageType,
          userId: finalOperatorId,
          lineId: line.id,
          linePhone: line.phone,
          blockedByPhrase,
        },
        finalOperatorId || undefined,
        blockedByPhrase ? EventSeverity.WARNING : EventSeverity.INFO,
      );

      // Emitir via WebSocket
      const messagePayload = {
        ...conversation,
        blockedByPhrase,
      };
      await this.websocketGateway.emitNewMessage(messagePayload);

      return { status: 'success', conversation };
    } catch (error) {
      this.logger.error(`Erro ao processar mensagem recebida: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Processa status de mensagem (sent, delivered, read, failed)
   */
  private async processMessageStatus(status: any, line: any) {
    try {
      const messageId = status.id;
      const statusValue = status.status;
      const timestamp = parseInt(status.timestamp) * 1000;

      // Atualizar TemplateMessage se existir
      const templateMessage = await this.prisma.templateMessage.findFirst({
        where: { messageId },
      });

      if (templateMessage) {
        await this.prisma.templateMessage.update({
          where: { id: templateMessage.id },
          data: {
            status: statusValue.toUpperCase(),
            errorMessage: status.errors && status.errors.length > 0
              ? status.errors.map((e: any) => e.message || e.title).join(', ')
              : null,
          },
        });
      }

      // Emitir evento via WebSocket se necessário
      if (statusValue === 'failed' && status.errors) {
        this.logger.warn(`Mensagem ${messageId} falhou: ${JSON.stringify(status.errors)}`);
      }

      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Erro ao processar status de mensagem: ${error.message}`, error.stack);
      throw error;
    }
  }
}


