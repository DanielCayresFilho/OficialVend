import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => WebsocketGateway))
    private websocketGateway: WebsocketGateway,
  ) {}

  async create(createConversationDto: CreateConversationDto) {
    return this.prisma.conversation.create({
      data: {
        ...createConversationDto,
        datetime: new Date(),
      },
    });
  }

  async findAll(filters?: any) {
    // Remover campos inválidos que não existem no schema
    const { search, ...validFilters } = filters || {};
    
    // Se houver busca por texto, aplicar filtros
    const where = search 
      ? {
          ...validFilters,
          OR: [
            { contactName: { contains: search, mode: 'insensitive' } },
            { contactPhone: { contains: search } },
            { message: { contains: search, mode: 'insensitive' } },
          ],
        }
      : validFilters;

    return this.prisma.conversation.findMany({
      where,
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
  }

  async findByContactPhone(contactPhone: string, tabulated: boolean = false, userLine?: number) {
    const where: any = {
      contactPhone,
      tabulation: tabulated ? { not: null } : null,
    };

    // Se for operador, filtrar apenas conversas da sua linha
    if (userLine) {
      where.userLine = userLine;
    }

    return this.prisma.conversation.findMany({
      where,
      orderBy: {
        datetime: 'asc',
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

  async findActiveConversations(userLine?: number, userId?: number) {
    const where: any = {
      tabulation: null,
    };

    // IMPORTANTE: Para operadores, buscar apenas por userId (não por userLine)
    // Isso permite que as conversas continuem aparecendo mesmo se a linha foi banida
    if (userId) {
      where.userId = userId;
    } else if (userLine) {
      // Fallback: se não tiver userId, usar userLine (para compatibilidade)
      where.userLine = userLine;
    }

    // Retornar TODAS as mensagens não tabuladas (o frontend vai agrupar)
    // Usar select explícito para evitar problemas com campos que podem não existir no banco
    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: {
        datetime: 'asc', // Ordem cronológica para histórico
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
        // messageId omitido temporariamente até confirmar que a coluna existe no banco
      },
    });

    return conversations;
  }

  async findTabulatedConversations(userLine?: number, userId?: number) {
    const where: any = {
      tabulation: { not: null },
    };

    // IMPORTANTE: Para operadores, buscar apenas por userId (não por userLine)
    // Isso permite que as conversas tabuladas continuem aparecendo mesmo se a linha foi banida
    if (userId) {
      where.userId = userId;
    } else if (userLine) {
      // Fallback: se não tiver userId, usar userLine (para compatibilidade)
      where.userLine = userLine;
    }

    // Retornar TODAS as mensagens tabuladas (o frontend vai agrupar)
    // Usar select explícito para evitar problemas com campos que podem não existir no banco
    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: {
        datetime: 'asc', // Ordem cronológica para histórico
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
        // messageId omitido temporariamente até confirmar que a coluna existe no banco
      },
    });

    return conversations;
  }

  async findOne(id: number) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversa com ID ${id} não encontrada`);
    }

    return conversation;
  }

  async update(id: number, updateConversationDto: UpdateConversationDto) {
    await this.findOne(id);

    return this.prisma.conversation.update({
      where: { id },
      data: updateConversationDto,
    });
  }

  async tabulateConversation(contactPhone: string, tabulationId: number) {
    // Atualizar todas as mensagens daquele contactPhone que ainda não foram tabuladas
    return this.prisma.conversation.updateMany({
      where: {
        contactPhone,
        tabulation: null,
      },
      data: {
        tabulation: tabulationId,
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.conversation.delete({
      where: { id },
    });
  }

  async getConversationsBySegment(segment: number, tabulated: boolean = false) {
    return this.prisma.conversation.findMany({
      where: {
        segment,
        tabulation: tabulated ? { not: null } : null,
      },
      orderBy: {
        datetime: 'desc',
      },
    });
  }

  /**
   * Rechamar contato após linha banida
   * Cria uma nova conversa ativa para o contato na nova linha do operador
   */
  async recallContact(contactPhone: string, userId: number, userLine: number | null) {
    if (!userLine) {
      throw new NotFoundException('Operador não possui linha atribuída');
    }

    // Buscar contato
    const contact = await this.prisma.contact.findFirst({
      where: { phone: contactPhone },
    });

    if (!contact) {
      throw new NotFoundException('Contato não encontrado');
    }

    // Buscar última conversa com este contato para pegar dados
    const lastConversation = await this.prisma.conversation.findFirst({
      where: { contactPhone },
      orderBy: { datetime: 'desc' },
    });

    // Buscar dados do operador
    const operator = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!operator) {
      throw new NotFoundException('Operador não encontrado');
    }

    // Criar nova conversa ativa (não tabulada) na nova linha
    const newConversation = await this.prisma.conversation.create({
      data: {
        contactName: contact.name,
        contactPhone: contact.phone,
        segment: contact.segment || lastConversation?.segment || operator.segment,
        userName: operator.name,
        userLine: userLine,
        userId: userId,
        message: 'Contato rechamado após linha banida',
        sender: 'operator',
        messageType: 'text',
        tabulation: null, // Conversa ativa
      },
    });

    return newConversation;
  }

  /**
   * Transfere todas as conversas ativas de um contato para outro operador
   * Usado por supervisores para redistribuir atendimentos
   */
  async transferConversation(
    contactPhone: string,
    targetOperatorId: number,
    currentUser: any,
  ) {
    // Validar que usuário é supervisor
    if (currentUser.role !== 'supervisor' && currentUser.role !== 'admin') {
      throw new Error('Apenas supervisores podem transferir conversas');
    }

    // Buscar operador destino
    const targetOperator = await this.prisma.user.findUnique({
      where: { id: targetOperatorId },
    });

    if (!targetOperator || targetOperator.role !== 'operator') {
      throw new Error('Operador destino não encontrado ou inválido');
    }

    // Validar que operador destino está no mesmo segmento do supervisor
    if (currentUser.role === 'supervisor' && currentUser.segment !== targetOperator.segment) {
      throw new Error('Operador destino deve estar no mesmo segmento');
    }

    // Buscar todas as conversas ativas do contato
    const activeConversations = await this.prisma.conversation.findMany({
      where: {
        contactPhone,
        tabulation: null, // Apenas conversas ativas
      },
    });

    if (activeConversations.length === 0) {
      throw new Error('Nenhuma conversa ativa encontrada para este contato');
    }

    // Buscar linha da primeira conversa (assumindo que todas são da mesma linha)
    const firstConversation = activeConversations[0];
    const lineId = firstConversation.userLine;

    // Atualizar todas as conversas ativas para o novo operador
    const updatedConversations = await this.prisma.$transaction(
      activeConversations.map(conversation =>
        this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            userId: targetOperatorId,
            userName: targetOperator.name,
          },
        })
      )
    );

    // Emitir eventos WebSocket para notificar ambos operadores
    if (firstConversation.userId) {
      // Notificar operador origem sobre a transferência
      this.websocketGateway.emitToUser(firstConversation.userId, 'conversation-transferred', {
        contactPhone,
        toOperatorId: targetOperatorId,
        toOperatorName: targetOperator.name,
      });
    }

    // Notificar operador destino sobre a nova conversa
    this.websocketGateway.emitToUser(targetOperatorId, 'conversation-received', {
      contactPhone,
      contactName: activeConversations[0]?.contactName || 'Contato',
      fromOperatorId: firstConversation.userId,
    });

    // Emitir atualização de conversa para ambos
    if (updatedConversations.length > 0) {
      const updatedConversation = updatedConversations[0];
      await this.websocketGateway.emitNewMessage({
        ...updatedConversation,
        contactPhone,
      });
    }

    return {
      success: true,
      transferred: updatedConversations.length,
      contactPhone,
      fromOperatorId: firstConversation.userId,
      toOperatorId: targetOperatorId,
      toOperatorName: targetOperator.name,
    };
  }
}
