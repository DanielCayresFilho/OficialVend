import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BlocklistService } from '../blocklist/blocklist.service';
import { ConversationsService } from '../conversations/conversations.service';
import { RateLimitingService } from '../rate-limiting/rate-limiting.service';
import { LineReputationService } from '../line-reputation/line-reputation.service';
import { AppLoggerService } from '../logger/logger.service';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import { ControlPanelService } from '../control-panel/control-panel.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';
import axios from 'axios';

interface TemplateVariable {
  key: string;
  value: string;
}

@Injectable()
@Processor('campaigns')
export class CampaignsProcessor {
  constructor(
    private prisma: PrismaService,
    private blocklistService: BlocklistService,
    private conversationsService: ConversationsService,
    private rateLimitingService: RateLimitingService,
    private lineReputationService: LineReputationService,
    private logger: AppLoggerService,
    private whatsappCloudService: WhatsappCloudService,
    private controlPanelService: ControlPanelService,
    private phoneValidationService: PhoneValidationService,
  ) {}

  @Process('send-campaign-message')
  async handleSendMessage(job: Job) {
    const { 
      campaignId, 
      contactName, 
      contactPhone: rawContactPhone, 
      contactSegment, 
      lineId, 
      message,
      useTemplate,
      templateId,
      templateVariables,
    } = job.data;

    try {
      // Normalizar telefone (adicionar 55, remover caracteres especiais)
      const contactPhone = this.phoneValidationService.normalizePhone(rawContactPhone);

      // Verificar se está na blocklist
      const isBlocked = await this.blocklistService.isBlocked(contactPhone);
      if (isBlocked) {
        console.log(`❌ Contato ${contactPhone} está na blocklist`);
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { response: false },
        });
        return;
      }

      // Verificar CPC (Contato por Cliente)
      const cpcCheck = await this.controlPanelService.canContactCPC(contactPhone, contactSegment);
      if (!cpcCheck.allowed) {
        this.logger.warn(
          `Campanha: Bloqueio CPC para ${contactPhone}`,
          'CampaignsProcessor',
          { campaignId, contactPhone, reason: cpcCheck.reason },
        );
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { response: false },
        });
        return;
      }

      // Verificar reenvio (intervalo mínimo entre campanhas)
      const resendCheck = await this.controlPanelService.canResend(contactPhone, contactSegment);
      if (!resendCheck.allowed) {
        this.logger.warn(
          `Campanha: Bloqueio reenvio para ${contactPhone}`,
          'CampaignsProcessor',
          { campaignId, contactPhone, reason: resendCheck.reason },
        );
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { response: false },
        });
        return;
      }

      // Buscar a linha
      const line = await this.prisma.linesStock.findUnique({
        where: { id: lineId },
      });

      if (!line || line.lineStatus !== 'active') {
        throw new Error('Linha não disponível');
      }

      // Rate Limiting: Verificar se a linha pode enviar mensagem (CAMPANHAS TAMBÉM RESPEITAM LIMITES)
      const canSend = await this.rateLimitingService.canSendMessage(lineId);
      if (!canSend) {
        const rateLimitInfo = await this.rateLimitingService.getRateLimitInfo(lineId);
        this.logger.warn(
          `Campanha: Limite de mensagens atingido para linha ${line.phone}`,
          'CampaignsProcessor',
          { campaignId, lineId, rateLimitInfo },
        );
        throw new Error(`Limite de mensagens atingido (${rateLimitInfo.messagesToday}/${rateLimitInfo.limit.daily} hoje)`);
      }

      // Verificar reputação da linha
      const isLineHealthy = await this.lineReputationService.isLineHealthy(lineId);
      if (!isLineHealthy) {
        this.logger.warn(
          `Campanha: Linha ${line.phone} com baixa reputação`,
          'CampaignsProcessor',
          { campaignId, lineId },
        );
        throw new Error('Linha com baixa reputação, envio bloqueado');
      }

      // Buscar o App para obter o accessToken
      const app = await this.prisma.app.findUnique({
        where: { id: line.appId },
      });

      if (!app || !app.accessToken || !line.numberId) {
        throw new Error('Linha não possui app ou accessToken configurados');
      }

      let retries = 0;
      let sent = false;
      let finalMessage = message || 'Olá! Esta é uma mensagem da nossa campanha.';

      while (retries < 3 && !sent) {
        try {
          // Se usar template, enviar via template
          if (useTemplate && templateId) {
            const template = await this.prisma.template.findUnique({
              where: { id: templateId },
            });

            if (!template) {
              throw new Error('Template não encontrado');
            }

            // Substituir variáveis no template
            let templateText = template.bodyText;
            const variables: TemplateVariable[] = templateVariables ? 
              (typeof templateVariables === 'string' ? JSON.parse(templateVariables) : templateVariables) 
              : [];

            variables.forEach((v: TemplateVariable, index: number) => {
              templateText = templateText.replace(`{{${index + 1}}}`, v.value);
              templateText = templateText.replace(`{{${v.key}}}`, v.value);
            });

            finalMessage = templateText;

            // Enviar via Cloud API (contactPhone já está normalizado)
            await this.sendTemplateViaCloudApi(line, app, template, contactPhone, variables);

            // Registrar envio de template
            await this.prisma.templateMessage.create({
              data: {
                templateId: template.id,
                contactPhone,
                contactName,
                lineId,
                status: 'SENT',
                variables: variables.length > 0 ? JSON.stringify(variables) : null,
                campaignId,
              },
            });
          } else {
            // Envio de mensagem de texto normal via Cloud API
            await this.whatsappCloudService.sendTextMessage({
              phoneNumberId: line.numberId,
              token: app.accessToken,
              to: contactPhone,
              message: finalMessage,
            });
          }

          sent = true;

          // Buscar operadores da linha e distribuir (máximo 2)
          const lineOperators = await this.prisma.lineOperator.findMany({
            where: { lineId },
            include: {
              user: true,
            },
          });

          // Filtrar apenas operadores online
          const onlineOperators = lineOperators
            .filter(lo => lo.user.status === 'Online' && lo.user.role === 'operator')
            .map(lo => lo.user);

          // Se não houver operadores online, usar null (sistema)
          let assignedOperatorId: number | null = null;
          if (onlineOperators.length > 0) {
            // Distribuir de forma round-robin: contar conversas ativas de cada operador
            const operatorConversationCounts = await Promise.all(
              onlineOperators.map(async (operator) => {
                const count = await this.prisma.conversation.count({
                  where: {
                    userLine: lineId,
                    userId: operator.id,
                    tabulation: null,
                  },
                });
                return { operatorId: operator.id, count };
              })
            );

            operatorConversationCounts.sort((a, b) => a.count - b.count);
            assignedOperatorId = operatorConversationCounts[0]?.operatorId || onlineOperators[0]?.id || null;
          }

          // Registrar conversa
          await this.conversationsService.create({
            contactName,
            contactPhone,
            segment: contactSegment,
            userName: 'Sistema',
            userLine: lineId,
            userId: assignedOperatorId, // Operador específico que vai receber a resposta
            message: useTemplate ? `[TEMPLATE] ${finalMessage}` : finalMessage,
            sender: 'operator',
            messageType: useTemplate ? 'template' : 'text',
          });

          // Atualizar campanha
          await this.prisma.campaign.update({
            where: { id: campaignId },
            data: { response: true },
          });

          console.log(`✅ Mensagem ${useTemplate ? '(template)' : ''} enviada para ${contactPhone}`);
        } catch (error) {
          retries++;
          console.error(`Tentativa ${retries} falhou para ${contactPhone}:`, error.message);

          if (retries >= 3) {
            await this.prisma.campaign.update({
              where: { id: campaignId },
              data: {
                response: false,
                retryCount: retries,
              },
            });

            // Se template, registrar falha
            if (useTemplate && templateId) {
              await this.prisma.templateMessage.create({
                data: {
                  templateId,
                  contactPhone,
                  contactName,
                  lineId,
                  status: 'FAILED',
                  errorMessage: error.message,
                  campaignId,
                },
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Erro ao processar campanha:', error);
      throw error;
    }
  }

  /**
   * Envia template via WhatsApp Cloud API
   */
  private async sendTemplateViaCloudApi(
    line: any,
    app: any,
    template: any,
    phone: string,
    variables: TemplateVariable[],
  ) {
    const components: any[] = [];

    // Body com variáveis
    if (variables.length > 0) {
      components.push({
        type: 'body',
        parameters: variables.map(v => ({
          type: 'text',
          text: v.value,
        })),
      });
    }

    await this.whatsappCloudService.sendTemplate({
      phoneNumberId: line.numberId,
      token: app.accessToken,
      to: phone,
      templateName: template.name,
      language: template.language,
      components: components.length > 0 ? components : undefined,
    });
  }
}
