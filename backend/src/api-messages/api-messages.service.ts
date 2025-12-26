import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MassiveCpcDto, MessageDto, SendTemplateExternalDto, TemplateVariableDto } from './dto/massive-cpc.dto';
import { TagsService } from '../tags/tags.service';
import { ApiLogsService } from '../api-logs/api-logs.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ContactsService } from '../contacts/contacts.service';
import { HumanizationService } from '../humanization/humanization.service';
import { RateLimitingService } from '../rate-limiting/rate-limiting.service';
import { SpintaxService } from '../spintax/spintax.service';
import { HealthCheckCacheService } from '../health-check-cache/health-check-cache.service';
import { LineReputationService } from '../line-reputation/line-reputation.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import axios from 'axios';

@Injectable()
export class ApiMessagesService {
  constructor(
    private prisma: PrismaService,
    private tagsService: TagsService,
    private apiLogsService: ApiLogsService,
    private conversationsService: ConversationsService,
    private contactsService: ContactsService,
    private humanizationService: HumanizationService,
    private rateLimitingService: RateLimitingService,
    private spintaxService: SpintaxService,
    private healthCheckCacheService: HealthCheckCacheService,
    private lineReputationService: LineReputationService,
    private phoneValidationService: PhoneValidationService,
    private whatsappCloudService: WhatsappCloudService,
  ) {}

  /**
   * Verifica se pode enviar mensagem CPC (Contato por Cliente)
   * Regras:
   * - Cliente só pode receber novo contato se:
   *   - Respondeu à mensagem enviada
   *   - Ou após 24h da primeira interação
   */
  private async canSendCpcMessage(phone: string): Promise<{ canSend: boolean; reason?: string }> {
    // Buscar todas as conversas com este telefone
    const conversations = await this.prisma.conversation.findMany({
      where: { contactPhone: phone },
      orderBy: { datetime: 'asc' },
      select: {
        id: true,
        contactName: true,
        contactPhone: true,
        segment: true,
        userName: true,
        userLine: true,
        userId: true,
        message: true,
        sender: true,
        datetime: true,
        tabulation: true,
        messageType: true,
        mediaUrl: true,
        archived: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (conversations.length === 0) {
      // Se não há conversa anterior, pode enviar
      return { canSend: true };
    }

    // Buscar primeira mensagem do operador (primeira interação)
    const firstOperatorMessage = conversations.find(c => c.sender === 'operator');
    
    if (!firstOperatorMessage) {
      // Se não há mensagem do operador, pode enviar
      return { canSend: true };
    }

    // Verificar se o cliente respondeu (há mensagem do cliente após a primeira do operador)
    const hasResponse = conversations.some(
      c => c.sender === 'contact' && c.datetime > firstOperatorMessage.datetime
    );

    if (hasResponse) {
      // Cliente respondeu, pode enviar
      return { canSend: true };
    }

    // Verificar se passaram 24h desde a primeira interação (primeira mensagem do operador)
    const now = new Date();
    const firstInteractionTime = firstOperatorMessage.datetime;
    const hoursDiff = (now.getTime() - firstInteractionTime.getTime()) / (1000 * 60 * 60);

    if (hoursDiff >= 24) {
      return { canSend: true };
    }

    return {
      canSend: false,
      reason: `Cliente já recebeu mensagem há menos de 24h. Próximo envio permitido em ${(24 - hoursDiff).toFixed(1)} horas`,
    };
  }

  /**
   * Busca operador pelo specialistCode (email antes do @)
   */
  private async findOperatorBySpecialistCode(specialistCode: string) {
    // Buscar usuário cujo email começa com specialistCode@
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          startsWith: `${specialistCode}@`,
        },
        role: 'operator',
      },
    });

    if (!user) {
      throw new NotFoundException(`Operador com specialistCode '${specialistCode}' não encontrado`);
    }

    if (!user.line) {
      throw new BadRequestException(`Operador '${specialistCode}' não possui linha atribuída`);
    }

    return user;
  }

  /**
   * Envia mensagem via WhatsApp Cloud API
   */
  private async sendMessageViaCloudApi(
    line: any,
    phone: string,
    message: string,
  ): Promise<boolean> {
    try {
      // Validação de número antes de enviar
      const phoneValidation = this.phoneValidationService.isValidFormat(phone);
      if (!phoneValidation) {
        console.error(`❌ [ApiMessages] Número inválido ao enviar: ${phone}`);
        return false;
      }

      // Buscar o App para obter o accessToken
      const app = await this.prisma.app.findUnique({
        where: { id: line.appId },
      });

      if (!app || !app.accessToken || !line.numberId) {
        console.error(`❌ [ApiMessages] Linha não possui app ou accessToken: ${line.phone}`);
        return false;
      }

      await this.whatsappCloudService.sendTextMessage({
        phoneNumberId: line.numberId,
        token: app.accessToken,
        to: phone,
        message,
      });

      return true;
    } catch (error) {
      console.error('Erro ao enviar mensagem via Cloud API:', error);
      return false;
    }
  }

  /**
   * Processa disparo CPC
   */
  async sendMassiveCpc(dto: MassiveCpcDto, ipAddress?: string, userAgent?: string) {
    const errors: Array<{ phone: string; reason: string }> = [];
    let processed = 0;

    // Validar tag
    const tag = await this.tagsService.findByName(dto.tag);
    if (!tag) {
      const errorResponse = {
        status: 'error',
        message: `Tag '${dto.tag}' não encontrada`,
        processed: 0,
        errors: [],
      };

      // Registrar log de erro
      await this.apiLogsService.createLog({
        endpoint: '/api/messages/massivocpc',
        method: 'POST',
        requestPayload: dto,
        responsePayload: errorResponse,
        statusCode: 400,
        ipAddress,
        userAgent,
      });

      throw new NotFoundException(`Tag '${dto.tag}' não encontrada`);
    }

    // Processar cada mensagem
    for (const message of dto.messages) {
      try {
        // Normalizar telefone (adicionar 55, remover caracteres especiais)
        const normalizedPhone = this.phoneValidationService.normalizePhone(message.phone);

        // Validação de número: Verificar se o número é válido antes de processar
        const phoneValidation = this.phoneValidationService.isValidFormat(normalizedPhone);
        if (!phoneValidation) {
          errors.push({
            phone: message.phone,
            reason: 'Número de telefone inválido. Verifique o formato do número.',
          });
          continue;
        }

        // Verificar CPC (usar telefone normalizado)
        const cpcCheck = await this.canSendCpcMessage(normalizedPhone);
        if (!cpcCheck.canSend) {
          errors.push({
            phone: message.phone,
            reason: cpcCheck.reason || 'Bloqueado por regra CPC',
          });
          continue;
        }

        // Buscar operador
        const operator = await this.findOperatorBySpecialistCode(message.specialistCode);

        // Buscar linha do operador
        const line = await this.prisma.linesStock.findUnique({
          where: { id: operator.line! },
        });

        if (!line || line.lineStatus !== 'active') {
          errors.push({
            phone: message.phone,
            reason: 'Linha do operador não disponível',
          });
          continue;
        }

        // Rate Limiting: Verificar se a linha pode enviar mensagem
        const canSend = await this.rateLimitingService.canSendMessage(line.id);
        if (!canSend) {
          errors.push({
            phone: message.phone,
            reason: 'Limite de mensagens atingido para esta linha',
          });
          continue;
        }

        // Buscar o App para obter o accessToken
        const app = await this.prisma.app.findUnique({
          where: { id: line.appId },
        });

        if (!app || !app.accessToken || !line.numberId) {
          errors.push({
            phone: message.phone,
            reason: 'Linha não possui app ou accessToken configurados',
          });
          continue;
        }

        // Verificar blocklist (usar telefone normalizado)
        const isBlocked = await this.prisma.blockList.findFirst({
          where: {
            OR: [
              { phone: normalizedPhone },
              { cpf: message.contract },
            ],
          },
        });

        if (isBlocked) {
          errors.push({
            phone: message.phone,
            reason: 'Número ou CPF na lista de bloqueio',
          });
          continue;
        }

        // Determinar se deve usar template oficial
        const useTemplate = message.useOfficialTemplate || dto.useOfficialTemplate;
        const templateId = message.templateId || dto.defaultTemplateId;
        const templateVariables = message.templateVariables || [];

        let sent = false;
        let finalMessage = message.mainTemplate;
        let template: any = null;

        if (useTemplate && templateId) {
          // Buscar template
          template = await this.prisma.template.findUnique({
            where: { id: templateId },
          });

          if (!template) {
            errors.push({
              phone: message.phone,
              reason: `Template com ID ${templateId} não encontrado`,
            });
            continue;
          }

          // Substituir variáveis no template
          let templateText = template.bodyText;
          templateVariables.forEach((v: TemplateVariableDto, index: number) => {
            templateText = templateText.replace(`{{${index + 1}}}`, v.value);
            templateText = templateText.replace(`{{${v.key}}}`, v.value);
          });
          finalMessage = templateText;
        } else {
          // Aplicar Spintax na mensagem (se tiver sintaxe Spintax)
          if (this.spintaxService.hasSpintax(finalMessage)) {
            finalMessage = this.spintaxService.applySpintax(finalMessage);
            console.log(`🔄 [ApiMessages] Spintax aplicado para ${message.phone}`);
          }
        }

        // Humanização: Delay antes de enviar mensagem massiva
        const messageLength = finalMessage?.length || 0;
        const humanizedDelay = await this.humanizationService.getHumanizedDelay(messageLength, false);
        await this.humanizationService.sleep(humanizedDelay);

        // Nota: WhatsApp Cloud API não suporta typing indicator

        // Enviar mensagem (usar telefone normalizado)
        if (useTemplate && templateId && template) {
          // Enviar via Cloud API
          sent = await this.sendTemplateViaCloudApi(line, app, template, normalizedPhone, templateVariables);

          // Registrar envio de template
          if (sent) {
            await this.prisma.templateMessage.create({
              data: {
                templateId: template.id,
                contactPhone: normalizedPhone,
                contactName: message.clientId,
                lineId: line.id,
                status: 'SENT',
                variables: templateVariables.length > 0 ? JSON.stringify(templateVariables) : null,
              },
            });
          }
        } else {
          // Enviar mensagem de texto normal via Cloud API
          sent = await this.sendMessageViaCloudApi(
            line,
            normalizedPhone,
            message.mainTemplate,
          );
        }

        if (!sent) {
          errors.push({
            phone: message.phone,
            reason: useTemplate ? 'Falha ao enviar template' : 'Falha ao enviar mensagem via Cloud API',
          });
          continue;
        }

        // Buscar ou criar contato (usar telefone normalizado)
        let contact = await this.contactsService.findByPhone(normalizedPhone);
        if (!contact) {
          contact = await this.contactsService.create({
            name: message.clientId || 'Cliente',
            phone: message.phone,
            segment: tag.segment || operator.segment || null,
            cpf: message.clientId || null,
            contract: message.contract || null,
          });
        } else {
          // Atualizar contato se necessário
          if (message.contract && !contact.contract) {
            await this.prisma.contact.update({
              where: { id: contact.id },
              data: { contract: message.contract },
            });
          }
        }

        // Criar conversa
        await this.conversationsService.create({
          contactName: contact.name,
          contactPhone: normalizedPhone,
          segment: tag.segment || operator.segment || null,
          userName: operator.name,
          userLine: operator.line!,
          message: useTemplate ? `[TEMPLATE] ${finalMessage}` : finalMessage,
          sender: 'operator',
          messageType: useTemplate ? 'template' : 'text',
        });

        processed++;

        // Delay aleatório entre mensagens massivas (5-15 segundos)
        if (processed < dto.messages.length) {
          const delay = await this.humanizationService.getMassiveMessageDelay(5, 15);
          await this.humanizationService.sleep(delay);
        }
      } catch (error) {
        errors.push({
          phone: message.phone,
          reason: error.message || 'Erro ao processar mensagem',
        });
      }
    }

    const response = {
      status: errors.length === 0 ? 'success' : errors.length < dto.messages.length ? 'partial' : 'error',
      message: errors.length === 0
        ? 'Mensagens enviadas com sucesso'
        : `${processed} mensagens processadas, ${errors.length} com erro`,
      processed,
      errors,
    };

    // Registrar log
    await this.apiLogsService.createLog({
      endpoint: '/api/messages/massivocpc',
      method: 'POST',
      requestPayload: dto,
      responsePayload: response,
      statusCode: errors.length === 0 ? 200 : errors.length === dto.messages.length ? 400 : 207,
      ipAddress,
      userAgent,
    });

    return response;
  }

  /**
   * Envia template via WhatsApp Cloud API
   */
  private async sendTemplateViaCloudApi(
    line: any,
    app: any,
    template: any,
    phone: string,
    variables: TemplateVariableDto[],
  ): Promise<boolean> {
    try {
      // Telefone já deve estar normalizado quando chega aqui
      const cleanPhone = phone;

      // Montar componentes com variáveis
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

      await axios.post(
        `https://graph.facebook.com/v18.0/${line.numberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'template',
          template: {
            name: template.name,
            language: { code: template.language },
            components: components.length > 0 ? components : undefined,
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${app.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return true;
    } catch (error) {
      console.error('Erro ao enviar template via Cloud API:', error.response?.data || error.message);
      return false;
    }
  }


  /**
   * Envia template 1x1 via API externa
   */
  async sendTemplateExternal(dto: SendTemplateExternalDto, ipAddress?: string, userAgent?: string) {
    try {
      // Buscar operador
      const operator = await this.findOperatorBySpecialistCode(dto.specialistCode);

      // Buscar linha do operador
      const line = await this.prisma.linesStock.findUnique({
        where: { id: operator.line! },
      });

      if (!line || line.lineStatus !== 'active') {
        throw new BadRequestException('Linha do operador não disponível');
      }

      // Buscar o App para obter o accessToken
      const app = await this.prisma.app.findUnique({
        where: { id: line.appId },
      });

      if (!app || !app.accessToken || !line.numberId) {
        throw new BadRequestException('Linha não possui app ou accessToken configurados');
      }

      // Verificar blocklist
      const isBlocked = await this.prisma.blockList.findFirst({
        where: { phone: dto.phone },
      });

      if (isBlocked) {
        throw new BadRequestException('Número está na lista de bloqueio');
      }

      // Verificar CPC
      const cpcCheck = await this.canSendCpcMessage(dto.phone);
      if (!cpcCheck.canSend) {
        throw new BadRequestException(cpcCheck.reason || 'Bloqueado por regra CPC');
      }

      // Buscar template
      const template = await this.prisma.template.findUnique({
        where: { id: dto.templateId },
      });

      if (!template) {
        throw new NotFoundException(`Template com ID ${dto.templateId} não encontrado`);
      }

      const variables = dto.variables || [];

      // Substituir variáveis no template
      let templateText = template.bodyText;
      variables.forEach((v: TemplateVariableDto, index: number) => {
        templateText = templateText.replace(`{{${index + 1}}}`, v.value);
        templateText = templateText.replace(`{{${v.key}}}`, v.value);
      });

      // Enviar template via Cloud API
      let sent = false;
      let messageId: string | undefined;

      sent = await this.sendTemplateViaCloudApi(line, app, template, dto.phone, variables);
      
      // Extrair messageId da resposta (se disponível)
      if (sent) {
        // messageId será extraído do response do Cloud API se necessário
      }

      if (!sent) {
        const errorResponse = {
          success: false,
          message: 'Falha ao enviar template',
        };

        await this.apiLogsService.createLog({
          endpoint: '/api/messages/template',
          method: 'POST',
          requestPayload: dto,
          responsePayload: errorResponse,
          statusCode: 500,
          ipAddress,
          userAgent,
        });

        throw new BadRequestException('Falha ao enviar template');
      }

      // Registrar envio de template
      const templateMessage = await this.prisma.templateMessage.create({
        data: {
          templateId: dto.templateId,
          contactPhone: dto.phone,
          contactName: dto.contactName,
          lineId: line.id,
          status: 'SENT',
          messageId,
          variables: variables.length > 0 ? JSON.stringify(variables) : null,
        },
      });

      // Buscar ou criar contato
      let contact = await this.contactsService.findByPhone(dto.phone);
      if (!contact) {
        // Buscar tag para obter segmento
        let segment = operator.segment;
        if (dto.tag) {
          const tag = await this.tagsService.findByName(dto.tag);
          if (tag?.segment) {
            segment = tag.segment;
          }
        }

        contact = await this.contactsService.create({
          name: dto.contactName || 'Cliente',
          phone: dto.phone,
          segment,
        });
      }

      // Criar conversa
      await this.conversationsService.create({
        contactName: contact.name,
        contactPhone: dto.phone,
        segment: contact.segment,
        userName: operator.name,
        userLine: operator.line!,
        message: `[TEMPLATE: ${template.name}] ${templateText}`,
        sender: 'operator',
        messageType: 'template',
      });

      const response = {
        success: true,
        message: 'Template enviado com sucesso',
        templateMessageId: templateMessage.id,
        templateName: template.name,
      };

      await this.apiLogsService.createLog({
        endpoint: '/api/messages/template',
        method: 'POST',
        requestPayload: dto,
        responsePayload: response,
        statusCode: 200,
        ipAddress,
        userAgent,
      });

      return response;
    } catch (error) {
      const errorResponse = {
        success: false,
        message: error.message,
      };

      await this.apiLogsService.createLog({
        endpoint: '/api/messages/template',
        method: 'POST',
        requestPayload: dto,
        responsePayload: errorResponse,
        statusCode: error.status || 500,
        ipAddress,
        userAgent,
      });

      throw error;
    }
  }
}

