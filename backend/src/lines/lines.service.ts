import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateLineDto } from './dto/create-line.dto';
import { UpdateLineDto } from './dto/update-line.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { ControlPanelService } from '../control-panel/control-panel.service';
import { SystemEventsService, EventType, EventModule, EventSeverity } from '../system-events/system-events.service';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import axios from 'axios';

@Injectable()
export class LinesService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => WebsocketGateway))
    private websocketGateway: WebsocketGateway,
    private controlPanelService: ControlPanelService,
    private systemEventsService: SystemEventsService,
    private whatsappCloudService: WhatsappCloudService,
  ) { }

  async create(createLineDto: CreateLineDto, createdBy?: number) {
    console.log('📝 Dados recebidos no service:', JSON.stringify(createLineDto, null, 2));

    // Validar campos obrigatórios
    if (!createLineDto.appId) {
      throw new BadRequestException('AppId é obrigatório');
    }
    if (!createLineDto.numberId || createLineDto.numberId === '') {
      throw new BadRequestException('NumberId é obrigatório');
    }

    // Buscar o App
    const app = await (this.prisma as any).app.findUnique({
      where: { id: createLineDto.appId },
    });

    if (!app) {
      throw new BadRequestException(`App com ID ${createLineDto.appId} não encontrado`);
    }

    // Verificar se já existe uma linha com este telefone
    const existingLine = await (this.prisma as any).linesStock.findUnique({
      where: { phone: createLineDto.phone },
    });

    if (existingLine) {
      throw new BadRequestException('Já existe uma linha com este telefone');
    }

    // Verificar se já existe uma linha com este numberId
    const existingNumberId = await (this.prisma as any).linesStock.findFirst({
      where: { numberId: createLineDto.numberId },
    });

    if (existingNumberId) {
      throw new BadRequestException('Já existe uma linha com este NumberId');
    }

    // Validar credenciais via Meta API usando o accessToken do App
    try {
      console.log('🔍 Validando credenciais via Meta API...');
      const isValid = await this.whatsappCloudService.validateCredentials(
        app.accessToken,
        createLineDto.numberId,
      );

      if (!isValid) {
        throw new BadRequestException('Credenciais inválidas. Verifique o accessToken do app e o numberId.');
      }

      console.log('✅ Credenciais validadas com sucesso');
    } catch (error) {
      console.error('❌ Erro ao validar credenciais:', error.message);
      throw new BadRequestException(
        `Erro ao validar credenciais: ${error.message || 'AccessToken do app ou NumberId inválidos'}`
      );
    }

    // Criar linha no banco
    try {
      const newLine = await (this.prisma as any).linesStock.create({
        data: {
          phone: createLineDto.phone,
          lineStatus: createLineDto.lineStatus || 'active',
          segment: createLineDto.segment,
          oficial: true, // Todas as linhas são oficiais (Cloud API)
          appId: createLineDto.appId,
          numberId: createLineDto.numberId,
          receiveMedia: createLineDto.receiveMedia || false,
          createdBy,
        },
      });

      // Registrar evento
      await this.systemEventsService.logEvent(
        EventType.LINE_CREATED,
        EventModule.LINES,
        {
          lineId: newLine.id,
          linePhone: newLine.phone,
          numberId: newLine.numberId,
        },
        createdBy || undefined,
        EventSeverity.INFO,
      );

      // Remoção do vínculo automático: agora as linhas pertencem ao pool do segmento
      // e são acessadas por qualquer operador do segmento.


      return newLine;
    } catch (error) {
      console.error('❌ Erro ao criar linha:', error);

      if (error.code === 'P2002') {
        throw new BadRequestException('Telefone ou NumberId já cadastrado');
      }

      throw new BadRequestException(`Erro ao criar linha: ${error.message}`);
    }
  }

  async findAll(filters?: any) {
    // Remover campos inválidos que não existem no schema
    const { search, ...validFilters } = filters || {};

    // Se houver busca por texto, aplicar filtros
    const where = search
      ? {
        ...validFilters,
        OR: [
          { phone: { contains: search } },
          { numberId: { contains: search } },
        ],
      }
      : validFilters;

    const lines = await (this.prisma as any).linesStock.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        operators: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    // Buscar os Apps para cada linha
    const appIds = [...new Set(lines.map(l => l.appId))];
    const apps = await (this.prisma as any).app.findMany({
      where: { id: { in: appIds } },
    });
    const appsMap = new Map(apps.map(a => [a.id, a]));

    // Mapear para incluir operadores vinculados e app
    return lines.map(line => ({
      ...line,
      app: appsMap.get(line.appId) || null,
      operators: line.operators.map(lo => ({
        id: lo.user.id,
        name: lo.user.name,
        email: lo.user.email,
      })),
    }));
  }

  async findOne(id: number) {
    const line = await (this.prisma as any).linesStock.findUnique({
      where: { id },
    });

    if (!line) {
      throw new NotFoundException(`Linha com ID ${id} não encontrada`);
    }

    // Buscar o App
    const app = await (this.prisma as any).app.findUnique({
      where: { id: line.appId },
    });

    return {
      ...line,
      app: app || null,
    };
  }

  /**
   * Testa conexão com Meta API
   * Cloud API não usa QR Code - este método valida as credenciais
   */
  async testConnection(id: number) {
    const line = await this.findOne(id);

    if (!line.appId || !line.numberId) {
      throw new BadRequestException('Linha não possui appId ou numberId configurados');
    }

    // Buscar o App para obter o accessToken
    const app = await (this.prisma as any).app.findUnique({
      where: { id: line.appId },
    });

    if (!app) {
      throw new BadRequestException(`App com ID ${line.appId} não encontrado`);
    }

    try {
      const isValid = await this.whatsappCloudService.validateCredentials(
        app.accessToken,
        line.numberId,
      );

      return {
        connected: isValid,
        message: isValid
          ? 'Linha conectada e funcionando'
          : 'Linha não conectada - verifique as credenciais do app',
      };
    } catch (error) {
      return {
        connected: false,
        message: `Erro ao testar conexão: ${error.message}`,
      };
    }
  }

  async update(id: number, updateLineDto: UpdateLineDto) {
    const currentLine = await this.findOne(id);

    // Se receiveMedia foi alterado, reconfigurar webhook
    if (updateLineDto.receiveMedia !== undefined && updateLineDto.receiveMedia !== currentLine.receiveMedia) {
      await this.updateWebhookConfig(currentLine, updateLineDto.receiveMedia);
    }

    // Filtrar apenas campos válidos do DTO
    const { phone, appId, numberId, segment, lineStatus, receiveMedia } = updateLineDto;
    const updateData: any = {};

    if (phone !== undefined) updateData.phone = phone;
    if (appId !== undefined) {
      // Validar que o App existe
      const app = await (this.prisma as any).app.findUnique({
        where: { id: appId },
      });
      if (!app) {
        throw new BadRequestException(`App com ID ${appId} não encontrado`);
      }
      updateData.appId = appId;
    }
    if (numberId !== undefined) updateData.numberId = numberId;
    if (segment !== undefined && segment !== currentLine.segment) {
      // Buscar o segmento "Padrão" para validar a regra
      const defaultSegment = await (this.prisma as any).segment.findUnique({
        where: { name: 'Padrão' },
      });

      // Regra: Linha nunca pode trocar de segmento, exceto se for linha "Padrão"
      if (currentLine.segment !== defaultSegment?.id) {
        throw new BadRequestException('Esta linha já possui um segmento fixo e não pode ser alterada. Apenas linhas do segmento "Padrão" permitem troca.');
      }

      updateData.segment = segment;
    }

    if (lineStatus !== undefined) updateData.lineStatus = lineStatus;
    if (receiveMedia !== undefined) updateData.receiveMedia = receiveMedia;

    return (this.prisma as any).linesStock.update({
      where: { id },
      data: updateData,
    });
  }

  // Cloud API não requer atualização de webhook base64 - webhook é configurado via Meta Business API
  private async updateWebhookConfig(line: any, enableBase64: boolean) {
    // Webhook é configurado via Meta Business API, não requer atualização manual
    console.log(`ℹ️ Webhook Cloud API configurado via Meta Business API para linha ${line.phone}`);
  }

  async remove(id: number) {
    const line = await this.findOne(id);

    // Cloud API não requer deletar instância - apenas remover do banco
    // Webhook será desativado automaticamente quando a linha for removida

    return (this.prisma as any).linesStock.delete({
      where: { id },
    });
  }

  // Lógica automática de troca de linhas banidas
  async handleBannedLine(lineId: number) {
    const line = await this.findOne(lineId);

    // Buscar todos os operadores vinculados à linha (tabela LineOperator)
    const lineOperators = await (this.prisma as any).lineOperator.findMany({
      where: { lineId },
      include: {
        user: true,
      },
    });

    const operatorIds = lineOperators.map(lo => lo.userId);

    // Marcar linha como banida
    await this.update(lineId, { lineStatus: 'ban' });

    // Registrar evento de linha banida
    await this.systemEventsService.logEvent(
      EventType.LINE_BANNED,
      EventModule.LINES,
      {
        lineId: line.id,
        linePhone: line.phone,
      },
      null,
      EventSeverity.ERROR,
    );

    // Desvincular todos os operadores da tabela LineOperator para esta linha
    await (this.prisma as any).lineOperator.deleteMany({
      where: { lineId },
    });

    // Buscar uma nova linha ativa do mesmo segmento para herdar as conversas ativas
    const availableLine = await (this.prisma as any).linesStock.findFirst({
      where: {
        lineStatus: 'active',
        segment: line.segment,
      },
    });

    if (availableLine) {
      // Atualizar todas as conversas ativas da linha banida para a nova linha do pool
      const updatedCount = await (this.prisma as any).conversation.updateMany({
        where: {
          userLine: lineId,
          tabulation: null, // Apenas conversas ativas
        },
        data: {
          userLine: availableLine.id,
        },
      });
      console.log(`🔄 [handleBannedLine] ${updatedCount.count} conversas migradas da linha banida ${line.phone} para a linha ${availableLine.phone}`);
    } else {
      console.warn(`⚠️ [handleBannedLine] Nenhuma outra linha disponível no segmento ${line.segment} para migrar conversas.`);

      // Se não há linha, as conversas ativas ficam "órfãs" de linha (o operador verá, mas não poderá responder outbound até ter uma linha)
      // O frontend costuma filtrar por linhas ativas, então isso é tratado lá.
    }
    console.log(`✅ [handleBannedLine] Linha ${lineId} marcada como banida e operadores desvinculados`);
  }

  async getAvailableLines(segment: number) {
    return (this.prisma as any).linesStock.findMany({
      where: {
        lineStatus: 'active',
        segment,
        linkedTo: null,
      },
    });
  }

  /**
   * Retorna linhas disponíveis para um segmento (sem necessidade de vinculação)
   */
  async getAvailableLinesForSegment(segmentId: number): Promise<any[]> {
    return (this.prisma as any).linesStock.findMany({
      where: {
        lineStatus: 'active',
        segment: segmentId,
      },
      include: {
        operators: {
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        phone: 'asc',
      },
    });
  }

  /**
   * Distribui mensagem inbound de forma inteligente baseado em:
   * - Tempo logado (mais tempo = prioridade)
   * - Carga de trabalho (menos de 5 atendimentos = prioridade)
   * - Balanceamento entre operadores
   */
  async distributeInboundMessage(lineId: number, contactPhone: string): Promise<number | null> {
    // Buscar a linha e seu segmento
    const line = await (this.prisma as any).linesStock.findUnique({
      where: { id: lineId },
    });

    if (!line || !line.segment) {
      console.warn(`⚠️ [LinesService] Linha ${lineId} não encontrada ou sem segmento`);
      return null;
    }

    // Buscar todos operadores online do segmento (não apenas vinculados à linha)
    const segmentOperators = await (this.prisma as any).user.findMany({
      where: {
        role: 'operator',
        status: 'Online',
        segment: line.segment,
      },
    });

    if (segmentOperators.length === 0) {
      console.log(`⚠️ [LinesService] Nenhum operador online no segmento ${line.segment}`);
      return null;
    }

    // Verificar se já existe conversa ativa com algum operador
    const existingConversation = await (this.prisma as any).conversation.findFirst({
      where: {
        contactPhone,
        userLine: lineId,
        tabulation: null,
        userId: { in: segmentOperators.map(op => op.id) },
      },
      orderBy: {
        datetime: 'desc',
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

    // Se já existe conversa ativa, manter com o mesmo operador
    if (existingConversation?.userId) {
      console.log(`✅ [LinesService] Mantendo conversa com operador existente: ${existingConversation.userId}`);
      return existingConversation.userId;
    }

    // Calcular prioridade de cada operador
    const operatorPriorities = await Promise.all(
      segmentOperators.map(async (operator) => {
        // Contar atendimentos em andamento (conversas não tabuladas)
        const activeConversations = await (this.prisma as any).conversation.count({
          where: {
            userId: operator.id,
            tabulation: null,
          },
        });

        // Obter tempo logado do WebSocketGateway
        const connectionTime = this.websocketGateway.getOperatorConnectionTime(operator.id);
        const timeLogged = connectionTime ? Date.now() - connectionTime : 0;

        return {
          operatorId: operator.id,
          operatorName: operator.name,
          activeConversations,
          timeLogged,
          hasCapacity: activeConversations < 5,
        };
      })
    );

    // Filtrar operadores com capacidade (menos de 5 atendimentos)
    const operatorsWithCapacity = operatorPriorities.filter(op => op.hasCapacity);

    let selectedOperator;

    if (operatorsWithCapacity.length > 0) {
      // Se há operadores com capacidade, escolher o com:
      // 1. Menor número de atendimentos
      // 2. Maior tempo logado (em caso de empate)
      operatorsWithCapacity.sort((a, b) => {
        if (a.activeConversations !== b.activeConversations) {
          return a.activeConversations - b.activeConversations;
        }
        return b.timeLogged - a.timeLogged; // Mais tempo logado primeiro
      });
      selectedOperator = operatorsWithCapacity[0];
    } else {
      // Se todos têm 5+ atendimentos, escolher o com mais tempo logado
      operatorPriorities.sort((a, b) => b.timeLogged - a.timeLogged);
      selectedOperator = operatorPriorities[0];
    }

    console.log(`✅ [LinesService] Mensagem distribuída para ${selectedOperator.operatorName} (ID: ${selectedOperator.operatorId}) - ${selectedOperator.activeConversations} atendimentos, ${Math.round(selectedOperator.timeLogged / 1000 / 60)}min logado`);

    return selectedOperator.operatorId;
  }

}
