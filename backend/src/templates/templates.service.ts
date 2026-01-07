import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { SendTemplateDto, SendTemplateMassiveDto, TemplateVariableDto } from './dto/send-template.dto';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';
import axios from 'axios';

@Injectable()
export class TemplatesService {
  constructor(
    private prisma: PrismaService,
    private whatsappCloudService: WhatsappCloudService,
    private phoneValidationService: PhoneValidationService,
  ) {}

  async create(createTemplateDto: CreateTemplateDto) {
    // Validar campos obrigatórios
    if (!createTemplateDto.name || !createTemplateDto.name.trim()) {
      throw new BadRequestException('Nome do template é obrigatório');
    }

    if (!createTemplateDto.bodyText || !createTemplateDto.bodyText.trim()) {
      throw new BadRequestException('Corpo do template (bodyText) é obrigatório');
    }

    // Se um segmento foi fornecido, verificar se existe
    if (createTemplateDto.segmentId) {
      const segment = await this.prisma.segment.findUnique({
        where: { id: createTemplateDto.segmentId },
      });

      if (!segment) {
        throw new NotFoundException(`Segmento com ID ${createTemplateDto.segmentId} não encontrado`);
      }
    }

    // Serializar arrays para JSON
    const buttons = createTemplateDto.buttons ? JSON.stringify(createTemplateDto.buttons) : null;
    const variables = createTemplateDto.variables ? JSON.stringify(createTemplateDto.variables) : null;

    return this.prisma.template.create({
      data: {
        name: createTemplateDto.name.trim(),
        language: createTemplateDto.language || 'pt_BR',
        category: createTemplateDto.category || 'MARKETING',
        segmentId: createTemplateDto.segmentId || null,  // null = global
        lineId: createTemplateDto.lineId || null,  // Mantido para compatibilidade
        namespace: createTemplateDto.namespace?.trim() || null,
        headerType: createTemplateDto.headerType || null,
        headerContent: createTemplateDto.headerContent?.trim() || null,
        bodyText: createTemplateDto.bodyText.trim(),
        footerText: createTemplateDto.footerText?.trim() || null,
        buttons,
        variables,
        status: 'APPROVED',  // Templates internos já vêm aprovados
      },
    });
  }

  async findAll(filters?: any) {
    const { search, lineId, segmentId, status, ...validFilters } = filters || {};

    const where: any = { ...validFilters };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { bodyText: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (lineId) {
      where.lineId = parseInt(lineId);
    }

    if (segmentId) {
      where.segmentId = parseInt(segmentId);
    }

    if (status) {
      where.status = status;
    }

    const templates = await this.prisma.template.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Parse JSON fields
    return templates.map(template => ({
      ...template,
      buttons: template.buttons ? JSON.parse(template.buttons) : null,
      variables: template.variables ? JSON.parse(template.variables) : null,
    }));
  }

  async findBySegment(segmentId: number) {
    // Retornar templates do segmento específico + templates globais (segmentId = null)
    const templates = await this.prisma.template.findMany({
      where: {
        OR: [
          { segmentId },
          { segmentId: null },  // Templates globais
        ],
        status: 'APPROVED',
      },
      orderBy: { createdAt: 'desc' },
    });

    return templates.map(template => ({
      ...template,
      buttons: template.buttons ? JSON.parse(template.buttons) : null,
      variables: template.variables ? JSON.parse(template.variables) : null,
    }));
  }

  async findByLineAndSegment(lineId: number) {
    // Buscar a linha para obter o segmento
    const line = await this.prisma.linesStock.findUnique({
      where: { id: lineId },
      select: { segment: true },
    });

    if (!line) {
      throw new NotFoundException('Linha não encontrada');
    }

    // Retornar templates do segmento da linha + templates globais
    const templates = await this.prisma.template.findMany({
      where: {
        OR: [
          { segmentId: line.segment },
          { segmentId: null },  // Templates globais
        ],
        status: 'APPROVED',
      },
      orderBy: { createdAt: 'desc' },
    });

    return templates.map(template => ({
      ...template,
      buttons: template.buttons ? JSON.parse(template.buttons) : null,
      variables: template.variables ? JSON.parse(template.variables) : null,
    }));
  }

  async findOne(id: number) {
    const template = await this.prisma.template.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`Template com ID ${id} não encontrado`);
    }

    return {
      ...template,
      buttons: template.buttons ? JSON.parse(template.buttons) : null,
      variables: template.variables ? JSON.parse(template.variables) : null,
    };
  }

  async findByLine(lineId: number) {
    const templates = await this.prisma.template.findMany({
      where: { lineId },
      orderBy: { createdAt: 'desc' },
    });

    return templates.map(template => ({
      ...template,
      buttons: template.buttons ? JSON.parse(template.buttons) : null,
      variables: template.variables ? JSON.parse(template.variables) : null,
    }));
  }

  async update(id: number, updateTemplateDto: UpdateTemplateDto) {
    await this.findOne(id);

    const data: any = { ...updateTemplateDto };

    if (updateTemplateDto.buttons) {
      data.buttons = JSON.stringify(updateTemplateDto.buttons);
    }

    if (updateTemplateDto.variables) {
      data.variables = JSON.stringify(updateTemplateDto.variables);
    }

    const updated = await this.prisma.template.update({
      where: { id },
      data,
    });

    return {
      ...updated,
      buttons: updated.buttons ? JSON.parse(updated.buttons) : null,
      variables: updated.variables ? JSON.parse(updated.variables) : null,
    };
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.template.delete({
      where: { id },
    });
  }

  /**
   * Sincroniza template com WhatsApp Cloud API
   */
  async syncWithCloudApi(id: number) {
    const template = await this.findOne(id);
    const line = await this.prisma.linesStock.findUnique({
      where: { id: template.lineId },
    });

    if (!line || !line.oficial) {
      throw new BadRequestException('Linha não é oficial ou não encontrada');
    }

    // Buscar o App para obter o accessToken e wabaId
    const app = await this.prisma.app.findUnique({
      where: { id: line.appId },
    });

    if (!app || !app.accessToken || !app.wabaId) {
      throw new BadRequestException('Linha não possui app, accessToken ou wabaId configurados');
    }

    try {
      // Montar componentes do template
      const components: any[] = [];

      // Header
      if (template.headerType && template.headerContent) {
        components.push({
          type: 'HEADER',
          format: template.headerType,
          text: template.headerType === 'TEXT' ? template.headerContent : undefined,
          example: template.headerType !== 'TEXT' ? { header_handle: [template.headerContent] } : undefined,
        });
      }

      // Body
      const bodyComponent: any = {
        type: 'BODY',
        text: template.bodyText,
      };

      if (template.variables && template.variables.length > 0) {
        bodyComponent.example = {
          body_text: [template.variables],
        };
      }
      components.push(bodyComponent);

      // Footer
      if (template.footerText) {
        components.push({
          type: 'FOOTER',
          text: template.footerText,
        });
      }

      // Buttons
      if (template.buttons && template.buttons.length > 0) {
        components.push({
          type: 'BUTTONS',
          buttons: template.buttons.map((btn: any) => ({
            type: btn.type,
            text: btn.text,
            url: btn.url,
            phone_number: btn.phoneNumber,
          })),
        });
      }

      // Enviar para Cloud API
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${app.wabaId}/message_templates`,
        {
          name: template.name,
          language: template.language,
          category: template.category,
          components,
        },
        {
          headers: {
            'Authorization': `Bearer ${app.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // Atualizar status do template
      await this.prisma.template.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          namespace: response.data.id,
        },
      });

      return {
        success: true,
        message: 'Template enviado para aprovação',
        templateId: response.data.id,
      };
    } catch (error) {
      console.error('Erro ao sincronizar template:', error.response?.data || error.message);
      
      await this.prisma.template.update({
        where: { id },
        data: { status: 'REJECTED' },
      });

      throw new BadRequestException(
        `Erro ao sincronizar template: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Envia template para um contato (1x1)
   */
  async sendTemplate(dto: SendTemplateDto, user?: any) {
    const template = await this.findOne(dto.templateId);

    // Normalizar telefone (adicionar 55, remover caracteres especiais)
    const normalizedPhone = this.phoneValidationService.normalizePhone(dto.phone);

    // LineId agora é obrigatório
    const lineId = dto.lineId;

    if (!lineId) {
      throw new BadRequestException('Linha é obrigatória para envio de template');
    }

    // Validações para operadores
    if (user) {
      // Validar que operador tem permissão para 1x1
      if (!user.oneToOneActive) {
        throw new BadRequestException('Você não tem permissão para iniciar conversas 1x1');
      }

      // Validar que a linha pertence ao segmento do operador
      const selectedLine = await this.prisma.linesStock.findUnique({
        where: { id: lineId },
      });

      if (!selectedLine) {
        throw new NotFoundException('Linha não encontrada');
      }

      if (selectedLine.segment !== user.segment) {
        throw new BadRequestException('Você só pode usar linhas do seu segmento');
      }

      if (selectedLine.lineStatus !== 'active') {
        throw new BadRequestException('Linha não está ativa');
      }
    }
    
    const line = await this.prisma.linesStock.findUnique({
      where: { id: lineId },
    });

    if (!line) {
      throw new NotFoundException(`Linha com ID ${lineId} não encontrada`);
    }

    // Verificar blocklist (usar telefone normalizado)
    const isBlocked = await this.prisma.blockList.findFirst({
      where: { phone: normalizedPhone },
    });

    if (isBlocked) {
      throw new BadRequestException('Número está na lista de bloqueio');
    }

    // Preparar variáveis
    const variables = dto.variables || [];

    // Buscar o App para obter o accessToken
    const app = await this.prisma.app.findUnique({
      where: { id: line.appId },
    });

    if (!app || !app.accessToken || !line.numberId) {
      throw new BadRequestException('Linha não possui app ou accessToken configurados');
    }

    const result = await this.sendViaCloudApi(line, app, template, normalizedPhone, variables);

    // Criar registro de envio
    const templateMessage = await this.prisma.templateMessage.create({
      data: {
        templateId: dto.templateId,
        contactPhone: normalizedPhone,
        contactName: dto.contactName,
        lineId,
        status: result.success ? 'SENT' : 'FAILED',
        messageId: result.messageId,
        variables: variables.length > 0 ? JSON.stringify(variables) : null,
        errorMessage: result.error,
      },
    });

    // Criar conversa se enviado com sucesso
    if (result.success) {
      // Substituir variáveis no texto
      let messageText = template.bodyText;
      variables.forEach((v: TemplateVariableDto, index: number) => {
        messageText = messageText.replace(`{{${index + 1}}}`, v.value);
        messageText = messageText.replace(`{{${v.key}}}`, v.value);
      });

      // Buscar contato para obter segmento (usar telefone normalizado)
      const contact = await this.prisma.contact.findFirst({
        where: { phone: normalizedPhone },
      });

      // Buscar operador se userId foi fornecido
      let operator = null;
      if (user?.id) {
        operator = await this.prisma.user.findUnique({
          where: { id: user.id },
        });
      }

      await this.prisma.conversation.create({
        data: {
          contactName: dto.contactName || contact?.name || 'Contato',
          contactPhone: normalizedPhone,
          segment: contact?.segment || line.segment || operator?.segment || null,
          userName: operator?.name || null,
          userLine: lineId,
          userId: operator?.id || null, // IMPORTANTE: userId é necessário para filtrar conversas do operador
          message: `template: ${messageText}`,
          sender: 'operator',
          messageType: 'template',
        },
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
    }

    return {
      success: result.success,
      messageId: result.messageId,
      templateMessageId: templateMessage.id,
      error: result.error,
    };
  }

  /**
   * Envia template via WhatsApp Cloud API
   */
  private async sendViaCloudApi(
    line: any,
    app: any,
    template: any,
    phone: string,
    variables: TemplateVariableDto[],
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Montar componentes com variáveis
      const components: any[] = [];

      // Header com variáveis
      if (template.headerType === 'TEXT' && template.headerContent) {
        const headerVars = variables.filter(v => v.key.startsWith('header'));
        if (headerVars.length > 0) {
          components.push({
            type: 'header',
            parameters: headerVars.map(v => ({
              type: 'text',
              text: v.value,
            })),
          });
        }
      }

      // Body com variáveis
      const bodyVars = variables.filter(v => !v.key.startsWith('header') && !v.key.startsWith('button'));
      if (bodyVars.length > 0) {
        components.push({
          type: 'body',
          parameters: bodyVars.map(v => ({
            type: 'text',
            text: v.value,
          })),
        });
      }

      // Buttons com variáveis
      const buttonVars = variables.filter(v => v.key.startsWith('button'));
      buttonVars.forEach((v, index) => {
        components.push({
          type: 'button',
          sub_type: 'url',
          index,
          parameters: [{
            type: 'text',
            text: v.value,
          }],
        });
      });

      const response = await this.whatsappCloudService.sendTemplate({
        phoneNumberId: line.numberId,
        token: app.accessToken,
        to: phone,
        templateName: template.name,
        language: template.language,
        components: components.length > 0 ? components : undefined,
      });

      return {
        success: true,
        messageId: response.messages?.[0]?.id,
      };
    } catch (error: any) {
      console.error('Erro ao enviar template via Cloud API:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }


  /**
   * Envia template para múltiplos contatos (massivo)
   */
  async sendTemplateMassive(dto: SendTemplateMassiveDto) {
    const template = await this.findOne(dto.templateId);
    const lineId = dto.lineId || template.lineId;

    const results: Array<{
      phone: string;
      success: boolean;
      messageId?: string;
      error?: string;
    }> = [];

    for (const recipient of dto.recipients) {
      try {
        const result = await this.sendTemplate({
          templateId: dto.templateId,
          phone: recipient.phone,
          contactName: recipient.contactName,
          variables: recipient.variables,
          lineId,
        });

        results.push({
          phone: recipient.phone,
          success: result.success,
          messageId: result.messageId,
          error: result.error,
        });
      } catch (error) {
        results.push({
          phone: recipient.phone,
          success: false,
          error: error.message,
        });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      status: failed === 0 ? 'success' : successful === 0 ? 'error' : 'partial',
      total: dto.recipients.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Obtém histórico de envios de um template
   */
  async getTemplateHistory(templateId: number, filters?: any) {
    const { startDate, endDate, status } = filters || {};

    const where: any = { templateId };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (status) {
      where.status = status;
    }

    return this.prisma.templateMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Obtém estatísticas de um template
   */
  async getTemplateStats(templateId: number) {
    const total = await this.prisma.templateMessage.count({
      where: { templateId },
    });

    const sent = await this.prisma.templateMessage.count({
      where: { templateId, status: 'SENT' },
    });

    const delivered = await this.prisma.templateMessage.count({
      where: { templateId, status: 'DELIVERED' },
    });

    const read = await this.prisma.templateMessage.count({
      where: { templateId, status: 'READ' },
    });

    const failed = await this.prisma.templateMessage.count({
      where: { templateId, status: 'FAILED' },
    });

    return {
      total,
      sent,
      delivered,
      read,
      failed,
      deliveryRate: total > 0 ? ((delivered / total) * 100).toFixed(2) : '0',
      readRate: delivered > 0 ? ((read / delivered) * 100).toFixed(2) : '0',
    };
  }

  /**
   * Exporta templates para CSV
   */
  async exportToCsv(filters?: any): Promise<string> {
    const where: any = {};

    if (filters?.search) {
      const search = filters.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { bodyText: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (filters?.segmentId) {
      where.segmentId = parseInt(filters.segmentId);
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    const templates = await this.prisma.template.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Buscar nomes dos segmentos
    const segmentIds = [...new Set(templates.map(t => t.segmentId).filter(Boolean))];
    const segments = await this.prisma.segment.findMany({
      where: { id: { in: segmentIds as number[] } },
    });
    const segmentMap = new Map(segments.map(s => [s.id, s.name]));

    // Cabeçalho CSV
    const headers = [
      'ID',
      'Nome',
      'Idioma',
      'Categoria',
      'Segmento',
      'Status',
      'Namespace',
      'Tipo de Cabeçalho',
      'Conteúdo do Cabeçalho',
      'Corpo do Template',
      'Rodapé',
      'Botões',
      'Variáveis',
      'Data de Criação',
      'Data de Atualização',
    ];

    // Linhas CSV
    const rows = templates.map(template => {
      const segmentName = template.segmentId ? segmentMap.get(template.segmentId) || `Segmento ${template.segmentId}` : 'Global';
      
      // Parsear botões e variáveis para exibição
      let buttonsStr = '';
      let variablesStr = '';
      
      try {
        if (template.buttons) {
          const buttons = JSON.parse(template.buttons);
          buttonsStr = Array.isArray(buttons) 
            ? buttons.map((b: any) => `${b.type}:${b.text || b.url || ''}`).join('; ')
            : template.buttons;
        }
      } catch {
        buttonsStr = template.buttons || '';
      }

      try {
        if (template.variables) {
          const variables = JSON.parse(template.variables);
          variablesStr = Array.isArray(variables) 
            ? variables.join(', ')
            : template.variables;
        }
      } catch {
        variablesStr = template.variables || '';
      }

      return [
        template.id.toString(),
        this.escapeCsvField(template.name),
        template.language || 'pt_BR',
        template.category || 'MARKETING',
        this.escapeCsvField(segmentName),
        template.status || 'PENDING',
        this.escapeCsvField(template.namespace || ''),
        this.escapeCsvField(template.headerType || ''),
        this.escapeCsvField(template.headerContent || ''),
        this.escapeCsvField(template.bodyText || ''),
        this.escapeCsvField(template.footerText || ''),
        this.escapeCsvField(buttonsStr),
        this.escapeCsvField(variablesStr),
        template.createdAt.toISOString(),
        template.updatedAt.toISOString(),
      ];
    });

    // Combinar cabeçalho e linhas
    const csvLines = [headers.join(','), ...rows.map(row => row.join(','))];
    
    return csvLines.join('\n');
  }

  /**
   * Escapa campos CSV (adiciona aspas se necessário e escapa aspas duplas)
   */
  private escapeCsvField(field: string): string {
    if (!field) return '';
    
    // Se contém vírgula, quebra de linha ou aspas, precisa ser envolvido em aspas
    if (field.includes(',') || field.includes('\n') || field.includes('"')) {
      // Escapar aspas duplas duplicando-as
      return `"${field.replace(/"/g, '""')}"`;
    }
    
    return field;
  }
}

