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
  ) {}

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
    const app = await this.prisma.app.findUnique({
      where: { id: createLineDto.appId },
    });

    if (!app) {
      throw new BadRequestException(`App com ID ${createLineDto.appId} não encontrado`);
    }

    // Verificar se já existe uma linha com este telefone
    const existingLine = await this.prisma.linesStock.findUnique({
      where: { phone: createLineDto.phone },
    });

    if (existingLine) {
      throw new BadRequestException('Já existe uma linha com este telefone');
    }

    // Verificar se já existe uma linha com este numberId
    const existingNumberId = await this.prisma.linesStock.findFirst({
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
      const newLine = await this.prisma.linesStock.create({
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

      // Tentar vincular automaticamente a um operador online sem linha do mesmo segmento
      if (newLine.segment) {
        await this.tryAssignLineToOperator(newLine.id, newLine.segment);
      }

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

    const lines = await this.prisma.linesStock.findMany({
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
    const apps = await this.prisma.app.findMany({
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
    const line = await this.prisma.linesStock.findUnique({
      where: { id },
    });

    if (!line) {
      throw new NotFoundException(`Linha com ID ${id} não encontrada`);
    }

    // Buscar o App
    const app = await this.prisma.app.findUnique({
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
    const app = await this.prisma.app.findUnique({
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
      const app = await this.prisma.app.findUnique({
        where: { id: appId },
      });
      if (!app) {
        throw new BadRequestException(`App com ID ${appId} não encontrado`);
      }
      updateData.appId = appId;
    }
    if (numberId !== undefined) updateData.numberId = numberId;
    if (segment !== undefined) updateData.segment = segment;
    if (lineStatus !== undefined) updateData.lineStatus = lineStatus;
    if (receiveMedia !== undefined) updateData.receiveMedia = receiveMedia;

    return this.prisma.linesStock.update({
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

    return this.prisma.linesStock.delete({
      where: { id },
    });
  }

  // Lógica automática de troca de linhas banidas
  async handleBannedLine(lineId: number) {
    const line = await this.findOne(lineId);

    // Buscar todos os operadores vinculados à linha (tabela LineOperator)
    const lineOperators = await this.prisma.lineOperator.findMany({
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
        operatorsCount: lineOperators.length,
      },
      null,
      EventSeverity.ERROR,
    );

    if (operatorIds.length > 0) {
      console.log(`🔄 [handleBannedLine] Desvinculando ${operatorIds.length} operador(es) da linha banida ${lineId}`);

      // Buscar conversas ativas (não tabuladas) da linha banida, agrupadas por operador
      const activeConversations = await this.prisma.conversation.findMany({
        where: {
          userLine: lineId,
          tabulation: null, // Apenas conversas ativas
          userId: { in: operatorIds }, // Apenas dos operadores desta linha
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
        distinct: ['contactPhone', 'userId'], // Evitar duplicatas
      });

      // Agrupar contatos por operador
      const contactsByOperator = new Map<number, Array<{ phone: string; name: string }>>();
      activeConversations.forEach(conv => {
        if (conv.userId) {
          if (!contactsByOperator.has(conv.userId)) {
            contactsByOperator.set(conv.userId, []);
          }
          contactsByOperator.get(conv.userId)!.push({
            phone: conv.contactPhone,
            name: conv.contactName,
          });
        }
      });

      // Desvincular todos os operadores da tabela LineOperator
      await this.prisma.lineOperator.deleteMany({
        where: { lineId },
      });

      // Atualizar campos legacy (line e linkedTo)
      for (const operatorId of operatorIds) {
        await this.prisma.user.update({
          where: { id: operatorId },
          data: { line: null },
        });
      }

      // Limpar linkedTo da linha banida
      await this.prisma.linesStock.update({
        where: { id: lineId },
        data: { linkedTo: null },
      });

      // Tentar atribuir novas linhas aos operadores desvinculados
      for (const operatorId of operatorIds) {
        const operator = await this.prisma.user.findUnique({
          where: { id: operatorId },
          include: { lineOperators: true },
        });

        if (!operator || operator.lineOperators.length > 0) {
          continue; // Operador já tem outra linha ou não existe
        }

        // Buscar uma nova linha ativa do mesmo segmento (aceita linhas com 1 operador)
        let availableLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
            segment: line.segment,
          },
          include: {
            operators: {
              include: {
                user: true,
              },
            },
          },
        });

        // Filtrar apenas linhas ativas (Cloud API)

        // Aceitar linhas com menos de 2 operadores e que não tenham operadores de outro segmento
        const availableLine = availableLines.find(l => {
          if (l.operators.length >= 2) return false;
          
          // Verificar se todos os operadores são do mesmo segmento do operador atual
          if (l.operators.length > 0 && operator.segment) {
            const allSameSegment = l.operators.every(lo => lo.user.segment === operator.segment);
            if (!allSameSegment) return false;
          }
          
          return true;
        });

        if (availableLine) {
          // Vincular nova linha ao operador usando a tabela LineOperator
          await this.assignOperatorToLine(availableLine.id, operatorId);
          console.log(`✅ [handleBannedLine] Linha ${availableLine.phone} atribuída ao operador ${operator.name} (ID: ${operatorId})`);
          
          // IMPORTANTE: Atualizar userLine das conversas ativas para a nova linha
          // Isso mantém as conversas vinculadas ao operador, mas usando a nova linha
          await this.prisma.conversation.updateMany({
            where: {
              userId: operatorId,
              userLine: lineId, // Linha banida
              tabulation: null, // Apenas conversas ativas
            },
            data: {
              userLine: availableLine.id, // Nova linha
            },
          });
          console.log(`🔄 [handleBannedLine] Conversas do operador ${operator.name} atualizadas para usar a nova linha ${availableLine.phone}`);
          
          // NÃO notificar o operador - ele não precisa saber que a linha foi banida
          // As conversas continuam aparecendo normalmente
        } else {
          console.warn(`⚠️ [handleBannedLine] Nenhuma linha disponível para substituir a linha banida para o operador ${operator?.name || operatorId}`);
          
          // Fechar conversas ativas do operador
          try {
            await this.prisma.conversation.updateMany({
              where: {
                userId: operatorId,
                userLine: lineId,
                tabulation: null, // Apenas conversas não tabuladas
              },
              data: {
                tabulation: -1, // Marcar como fechada (usar -1 como código especial)
              },
            });
            console.log(`🔄 [handleBannedLine] Conversas ativas do operador ${operator?.name || operatorId} foram fechadas`);
          } catch (error) {
            console.error(`❌ [handleBannedLine] Erro ao fechar conversas:`, error);
          }
          
          // Notificar operador via WebSocket
          try {
            const operatorSockets = Array.from(this.websocketGateway['connectedUsers']?.entries() || [])
              .filter(([_, socket]: [any, any]) => socket.data?.user?.id === operatorId)
              .map(([_, socket]: [any, any]) => socket);
            
            for (const socket of operatorSockets) {
              socket.emit('line-lost', {
                message: 'Sua linha foi removida e não há linha disponível no momento. Você será notificado quando uma nova linha for atribuída.',
              });
            }
          } catch (error) {
            console.error(`❌ [handleBannedLine] Erro ao notificar operador:`, error);
          }
          
          // Adicionar operador em fila de espera
          try {
            await (this.prisma as any).operatorWaitingQueue.upsert({
              where: { userId: operatorId },
              update: { createdAt: new Date() },
              create: { userId: operatorId, createdAt: new Date() },
            });
            console.log(`📋 [handleBannedLine] Operador ${operator?.name || operatorId} adicionado à fila de espera`);
          } catch (error) {
            console.warn(`⚠️ [handleBannedLine] Não foi possível adicionar operador à fila de espera:`, error.message);
          }
        }
      }
    } else if (line.linkedTo) {
      // Fallback: se não há operadores na tabela LineOperator mas há linkedTo (legacy)
      await this.prisma.user.update({
        where: { id: line.linkedTo },
        data: { line: null },
      });

      // Buscar uma nova linha ativa do mesmo segmento
      const availableLine = await this.prisma.linesStock.findFirst({
        where: {
          lineStatus: 'active',
          segment: line.segment,
          linkedTo: null,
        },
      });

      if (availableLine) {
        // Vincular nova linha ao operador (usando campo legacy linkedTo diretamente no Prisma)
        await this.prisma.linesStock.update({
          where: { id: availableLine.id },
          data: { linkedTo: line.linkedTo },
        });
        await this.prisma.user.update({
          where: { id: line.linkedTo },
          data: { line: availableLine.id },
        });

        console.log(`✅ [handleBannedLine] Linha ${availableLine.phone} atribuída ao operador ${line.linkedTo} (legacy)`);
      } else {
        console.warn(`⚠️ [handleBannedLine] Nenhuma linha disponível para substituir a linha banida`);
      }
    }

    console.log(`✅ [handleBannedLine] Linha ${lineId} marcada como banida e operadores desvinculados`);
  }

  async getAvailableLines(segment: number) {
    return this.prisma.linesStock.findMany({
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
    return this.prisma.linesStock.findMany({
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
    const line = await this.prisma.linesStock.findUnique({
      where: { id: lineId },
    });

    if (!line || !line.segment) {
      console.warn(`⚠️ [LinesService] Linha ${lineId} não encontrada ou sem segmento`);
      return null;
    }

    // Buscar todos operadores online do segmento (não apenas vinculados à linha)
    const segmentOperators = await this.prisma.user.findMany({
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
    const existingConversation = await this.prisma.conversation.findFirst({
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
        const activeConversations = await this.prisma.conversation.count({
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

  // Distribuir mensagem inbound entre os operadores da linha (máximo 2)
  // Retorna o ID do operador que deve receber a mensagem
  // DEPRECATED: Usar distributeInboundMessage ao invés deste método
  async assignInboundMessageToOperator(lineId: number, contactPhone: string): Promise<number | null> {
    // Buscar operadores vinculados à linha
    const lineOperators = await this.prisma.lineOperator.findMany({
      where: { lineId },
      include: {
        user: true,
      },
    });

    console.log(`🔍 [LinesService] Buscando operadores para linha ${lineId}:`, {
      totalVinculados: lineOperators.length,
      operadores: lineOperators.map(lo => ({
        userId: lo.userId,
        userName: lo.user.name,
        status: lo.user.status,
        role: lo.user.role,
      })),
    });

    // Filtrar apenas operadores online
    const onlineOperators = lineOperators
      .filter(lo => lo.user.status === 'Online' && lo.user.role === 'operator')
      .map(lo => lo.user);

    console.log(`🔍 [LinesService] Operadores online na linha ${lineId}:`, {
      totalOnline: onlineOperators.length,
      operadores: onlineOperators.map(op => ({
        id: op.id,
        name: op.name,
        status: op.status,
      })),
    });

    if (onlineOperators.length === 0) {
      console.log(`⚠️ [LinesService] Nenhum operador online na linha ${lineId}`);
      
      // Verificar se há operadores vinculados mas offline
      const offlineOperators = lineOperators.filter(lo => lo.user.status !== 'Online');
      if (offlineOperators.length > 0) {
        console.log(`ℹ️ [LinesService] Há ${offlineOperators.length} operador(es) vinculado(s) mas offline:`, 
          offlineOperators.map(lo => `${lo.user.name} (${lo.user.status})`));
      }
      
      // FALLBACK: Se não encontrou na tabela LineOperator, verificar campo legacy (linkedTo)
      const line = await this.prisma.linesStock.findUnique({
        where: { id: lineId },
      });
      
      if (line && line.linkedTo) {
        const legacyOperator = await this.prisma.user.findUnique({
          where: { id: line.linkedTo },
        });
        
        if (legacyOperator && legacyOperator.status === 'Online' && legacyOperator.role === 'operator') {
          console.log(`✅ [LinesService] Fallback: Encontrado operador legacy online: ${legacyOperator.name} (ID: ${legacyOperator.id})`);
          
          // Sincronizar: criar entrada na tabela LineOperator
          const existingLink = await this.prisma.lineOperator.findFirst({
            where: {
              lineId: lineId,
              userId: legacyOperator.id,
            },
          });
          
          if (!existingLink) {
            await this.prisma.lineOperator.create({
              data: {
                lineId: lineId,
                userId: legacyOperator.id,
              },
            });
            console.log(`✅ [LinesService] Operador legacy sincronizado na tabela LineOperator`);
          }
          
          return legacyOperator.id;
        }
      }
      
      return null;
    }

    // Usar transaction com lock para evitar race condition
    return await this.prisma.$transaction(async (tx) => {
      // Verificar se já existe conversa ativa com algum operador específico (com lock)
      const existingConversation = await tx.conversation.findFirst({
        where: {
          contactPhone,
          userLine: lineId,
          tabulation: null, // Conversa não tabulada (ativa)
          userId: { in: onlineOperators.map(op => op.id) },
        },
        orderBy: {
          datetime: 'desc',
        },
      });

      // Se já existe conversa ativa, atribuir ao mesmo operador
      if (existingConversation && existingConversation.userId) {
        console.log(`✅ [LinesService] Mensagem atribuída ao operador existente: ${existingConversation.userId}`);
        return existingConversation.userId;
      }

      // Distribuir de forma round-robin: contar conversas ativas de cada operador (com lock)
      const operatorConversationCounts = await Promise.all(
        onlineOperators.map(async (operator) => {
          const count = await tx.conversation.count({
            where: {
              userLine: lineId,
              userId: operator.id,
              tabulation: null, // Apenas conversas ativas
            },
          });
          return { operatorId: operator.id, count };
        })
      );

      // Ordenar por menor número de conversas (balanceamento)
      operatorConversationCounts.sort((a, b) => a.count - b.count);

      // Retornar o operador com menos conversas
      const selectedOperatorId = operatorConversationCounts[0]?.operatorId || onlineOperators[0]?.id;
      console.log(`✅ [LinesService] Mensagem atribuída ao operador ${selectedOperatorId} (${operatorConversationCounts[0]?.count || 0} conversas ativas)`);
      
      return selectedOperatorId || null;
    }, { isolationLevel: 'Serializable' });
  }

  // Vincular operador à linha (máximo 2 operadores por linha)
  // Usa transação + lock para evitar race conditions
  async assignOperatorToLine(lineId: number, userId: number): Promise<void> {
    // Usar transação com lock para evitar race conditions
    return await this.prisma.$transaction(async (tx) => {
      // Lock na linha para evitar atribuições simultâneas
      const line = await tx.linesStock.findUnique({
        where: { id: lineId },
      });

      if (!line) {
        throw new NotFoundException('Linha não encontrada');
      }

      if (line.lineStatus !== 'active') {
        throw new BadRequestException('Linha não está ativa');
      }

      // Verificar se a linha está ativa (Cloud API sempre está ativa se token/numberId válidos)

      // Verificar se a linha já tem 2 operadores (com lock)
      const currentOperators = await tx.lineOperator.count({
        where: { lineId },
      });

      if (currentOperators >= 2) {
        throw new BadRequestException('Linha já possui o máximo de 2 operadores vinculados');
      }

      // Verificar se o operador já está vinculado a esta linha
      const existing = await tx.lineOperator.findUnique({
        where: {
          lineId_userId: {
            lineId,
            userId,
          },
        },
      });

      if (existing) {
        throw new BadRequestException('Operador já está vinculado a esta linha');
      }

      // Verificar se operador já tem outra linha
      const operatorCurrentLine = await tx.lineOperator.findFirst({
        where: { userId },
      });

      if (operatorCurrentLine && operatorCurrentLine.lineId !== lineId) {
        // Desvincular da linha anterior
        await tx.lineOperator.deleteMany({
          where: { userId, lineId: operatorCurrentLine.lineId },
        });
      }

      // Criar vínculo
      await tx.lineOperator.create({
        data: {
          lineId,
          userId,
        },
      });

      // Atualizar campo legacy para compatibilidade
      await tx.user.update({
        where: { id: userId },
        data: { line: lineId },
      });

      // Atualizar linkedTo apenas se for o primeiro operador
      if (currentOperators === 0) {
        await tx.linesStock.update({
          where: { id: lineId },
          data: { linkedTo: userId },
        });
      }

      console.log(`✅ Operador ${userId} vinculado à linha ${lineId} (com lock)`);
    }, {
      isolationLevel: 'Serializable', // Nível mais alto de isolamento para evitar race conditions
      timeout: 10000, // 10 segundos de timeout
    });
  }

  // Desvincular operador da linha
  async unassignOperatorFromLine(lineId: number, userId: number): Promise<void> {
    await this.prisma.lineOperator.deleteMany({
      where: {
        lineId,
        userId,
      },
    });

    // Atualizar campo legacy
    await this.prisma.user.update({
      where: { id: userId },
      data: { line: null },
    });

    // Se era o primeiro operador (linkedTo), atualizar para o próximo
    const line = await this.prisma.linesStock.findUnique({
      where: { id: lineId },
    });

    if (line && line.linkedTo === userId) {
      const remainingOperator = await this.prisma.lineOperator.findFirst({
        where: { lineId },
      });

      await this.prisma.linesStock.update({
        where: { id: lineId },
        data: { linkedTo: remainingOperator?.userId || null },
      });
    }

    console.log(`✅ Operador ${userId} desvinculado da linha ${lineId}`);
  }

  // Relatório de produtividade dos ativadores
  async getActivatorsProductivity() {
    const activators = await this.prisma.user.findMany({
      where: {
        role: 'ativador',
      },
      include: {
        createdLines: {
          select: {
            id: true,
            phone: true,
            lineStatus: true,
            createdAt: true,
          },
        },
      },
    });

    const productivity = activators.map(activator => {
      const totalLines = activator.createdLines.length;
      const activeLines = activator.createdLines.filter(l => l.lineStatus === 'active').length;
      const bannedLines = activator.createdLines.filter(l => l.lineStatus === 'ban').length;

      // Agrupar por mês
      const linesByMonth = activator.createdLines.reduce((acc, line) => {
        const month = new Date(line.createdAt).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        acc[month] = (acc[month] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        id: activator.id,
        name: activator.name,
        email: activator.email,
        totalLines,
        activeLines,
        bannedLines,
        linesByMonth,
        createdAt: activator.createdAt,
      };
    });

    return productivity.sort((a, b) => b.totalLines - a.totalLines); // Ordenar por total de linhas (maior primeiro)
  }

  /**
   * Busca estatísticas de alocação de linhas com operadores
   */
  async getLinesAllocationStats() {
    // Total de linhas ativas
    const totalActiveLines = await this.prisma.linesStock.count({
      where: { lineStatus: 'active' },
    });

    // Buscar todas as linhas ativas com seus operadores
    const activeLines = await this.prisma.linesStock.findMany({
      where: { lineStatus: 'active' },
      include: {
        operators: true,
      },
    });

    // Contar linhas com vínculo (pelo menos 1 operador)
    const linesWithOperatorsCount = activeLines.filter(line => line.operators.length > 0).length;

    // Linhas sem vínculo
    const linesWithoutOperatorsCount = totalActiveLines - linesWithOperatorsCount;

    // Linhas com 1 operador
    const linesWithOneOperatorCount = activeLines.filter(line => line.operators.length === 1).length;

    // Linhas com 2 operadores
    const linesWithTwoOperatorsCount = activeLines.filter(line => line.operators.length === 2).length;

    return {
      totalActiveLines,
      linesWithOperators: linesWithOperatorsCount,
      linesWithoutOperators: linesWithoutOperatorsCount,
      linesWithOneOperator: linesWithOneOperatorCount,
      linesWithTwoOperators: linesWithTwoOperatorsCount,
    };
  }

  // Tentar vincular linha automaticamente a operadores online sem linha do mesmo segmento (máximo 2)
  private async tryAssignLineToOperator(lineId: number, segment: number) {
    try {
      // Buscar operador online sem linha do mesmo segmento
      // Verificar quantos operadores já estão vinculados
      const currentOperatorsCount = await this.prisma.lineOperator.count({
        where: { lineId },
      });

      if (currentOperatorsCount >= 2) {
        console.log(`ℹ️ [LinesService] Linha ${lineId} já possui 2 operadores vinculados`);
        return;
      }

      // Buscar operadores online sem linha do mesmo segmento
      // Primeiro, buscar todos os operadores online do segmento
      const allOnlineOperators = await this.prisma.user.findMany({
        where: {
          role: 'operator',
          status: 'Online',
          segment: segment,
        },
      });

      // Filtrar apenas os que não têm vínculo com nenhuma linha
      const operatorsWithoutLine = [];
      for (const operator of allOnlineOperators) {
        const hasLine = await this.prisma.lineOperator.findFirst({
          where: { userId: operator.id },
        });
        if (!hasLine && operatorsWithoutLine.length < (2 - currentOperatorsCount)) {
          operatorsWithoutLine.push(operator);
        }
      }

      for (const operator of operatorsWithoutLine) {
        try {
          await this.assignOperatorToLine(lineId, operator.id);

          // Notificar operador via WebSocket
          if (this.websocketGateway) {
            const line = await this.findOne(lineId);
            this.websocketGateway.emitToUser(operator.id, 'line-assigned', {
              lineId: lineId,
              linePhone: line.phone,
              message: `Você foi vinculado à linha ${line.phone} automaticamente.`,
            });
          }

          console.log(`✅ [LinesService] Linha ${lineId} vinculada automaticamente ao operador ${operator.name} (segmento ${segment})`);
        } catch (error) {
          console.error(`❌ [LinesService] Erro ao vincular operador ${operator.id} à linha ${lineId}:`, error.message);
        }
      }

      if (operatorsWithoutLine.length === 0) {
        console.log(`ℹ️ [LinesService] Nenhum operador online sem linha encontrado no segmento ${segment} para vincular a linha ${lineId}`);
      }
    } catch (error) {
      console.error('❌ [LinesService] Erro ao tentar vincular linha automaticamente:', error);
      // Não lançar erro, apenas logar - a linha foi criada com sucesso
    }
  }
}
