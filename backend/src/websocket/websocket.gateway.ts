import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ControlPanelService } from '../control-panel/control-panel.service';
import { MediaService } from '../media/media.service';
import { LinesService } from '../lines/lines.service';
import { SystemEventsService, EventType, EventModule, EventSeverity } from '../system-events/system-events.service';
import { HumanizationService } from '../humanization/humanization.service';
import { RateLimitingService } from '../rate-limiting/rate-limiting.service';
import { SpintaxService } from '../spintax/spintax.service';
import { HealthCheckCacheService } from '../health-check-cache/health-check-cache.service';
import { LineReputationService } from '../line-reputation/line-reputation.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';
import { LineAssignmentService } from '../line-assignment/line-assignment.service';
import { MessageValidationService } from '../message-validation/message-validation.service';
import { MessageSendingService } from '../message-sending/message-sending.service';
import { AppLoggerService } from '../logger/logger.service';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      const allowedOrigins = process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
        : ['http://localhost:5173', 'http://localhost:3001'];
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers: Map<number, string> = new Map();

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private conversationsService: ConversationsService,
    private controlPanelService: ControlPanelService,
    private mediaService: MediaService,
    @Inject(forwardRef(() => LinesService))
    private linesService: LinesService,
    private systemEventsService: SystemEventsService,
    private humanizationService: HumanizationService,
    private rateLimitingService: RateLimitingService,
    private spintaxService: SpintaxService,
    private healthCheckCacheService: HealthCheckCacheService,
    private lineReputationService: LineReputationService,
    private phoneValidationService: PhoneValidationService,
    private lineAssignmentService: LineAssignmentService,
    private messageValidationService: MessageValidationService,
    private messageSendingService: MessageSendingService,
    private logger: AppLoggerService,
    private whatsappCloudService: WhatsappCloudService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        client.disconnect();
        return;
      }

      client.data.user = user;
      this.connectedUsers.set(user.id, client.id);

      // Atualizar status do usuário para Online
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'Online' },
      });

      // Log apenas para operadores (fluxo principal)
      if (user.role === 'operator') {
        console.log(`✅ Operador ${user.name} conectado`);
      }

      // Se for operador, verificar e sincronizar linha
      if (user.role === 'operator') {
        // Se já tem linha no campo legacy, verificar se está na tabela LineOperator
        if (user.line) {
          const existingLink = await (this.prisma as any).lineOperator.findFirst({
            where: {
              lineId: user.line,
              userId: user.id,
            },
          });

          if (!existingLink) {
            // Sincronizar: criar entrada na tabela LineOperator
            // Verificar se a linha ainda existe e está ativa
            const line = await this.prisma.linesStock.findUnique({
              where: { id: user.line },
            });

            if (line && line.lineStatus === 'active') {
              // Verificar quantos operadores já estão vinculados
              const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
                where: { lineId: user.line },
              });

              if (currentOperatorsCount < 2) {
                try {
                  await this.linesService.assignOperatorToLine(user.line, user.id); // ✅ COM LOCK
                } catch (error) {
                  console.error(`❌ [WebSocket] Erro ao sincronizar linha ${user.line} para ${user.name}:`, error.message);
                }
              }
            } else {
              // Remover linha inválida do operador
              await this.prisma.user.update({
                where: { id: user.id },
                data: { line: null },
              });
              user.line = null;
            }
          }
        }

        // Se for operador sem linha, verificar se há linha disponível para vincular
        if (!user.line) {
          let availableLine = null;

          // 1. Primeiro, tentar buscar linha do mesmo segmento do operador
          if (user.segment) {
            const segmentLines = await this.prisma.linesStock.findMany({
              where: {
                lineStatus: 'active',
                segment: user.segment,
              },
            });

            // Filtrar por evolutions ativas
            const filteredLines = await this.controlPanelService.filterLinesByActiveEvolutions(segmentLines, user.segment);
            // Usar LineAssignmentService (centralizado)
            const assignmentResult = await this.lineAssignmentService.findAvailableLineForOperator(user.id, user.segment);
            if (assignmentResult.success && assignmentResult.lineId) {
              availableLine = await this.prisma.linesStock.findUnique({ where: { id: assignmentResult.lineId } });
            }
          }

          // 2. Se não encontrou linha do segmento, buscar linha padrão (segmento "Padrão")
          if (!availableLine && user.segment) {
            // Buscar o segmento "Padrão" pelo nome
            const defaultSegment = await this.prisma.segment.findUnique({
              where: { name: 'Padrão' },
            });

            if (defaultSegment) {
              const defaultLines = await this.prisma.linesStock.findMany({
                where: {
                  lineStatus: 'active',
                  segment: defaultSegment.id, // Linhas padrão (segmento "Padrão")
                },
              });

              // Filtrar por evolutions ativas
              const filteredDefaultLines = await this.controlPanelService.filterLinesByActiveEvolutions(defaultLines, user.segment);
              availableLine = await this.findAvailableLineForOperator(filteredDefaultLines, user.id, user.segment);

              // Se encontrou linha padrão e operador tem segmento, atualizar o segmento da linha
              if (availableLine && user.segment) {
                await this.prisma.linesStock.update({
                  where: { id: availableLine.id },
                  data: { segment: user.segment },
                });

                availableLine.segment = user.segment; // Atualizar objeto local
              }
            }
          }

          if (availableLine) {
            // Verificar quantos operadores já estão vinculados
            const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
              where: { lineId: availableLine.id },
            });

            if (currentOperatorsCount < 2) {
              // IMPORTANTE: Verificar se a linha já tem operadores de outro segmento
              const existingOperators = await (this.prisma as any).lineOperator.findMany({
                where: { lineId: availableLine.id },
                include: { user: true },
              });

              // Se a linha já tem operadores, verificar se são do mesmo segmento
              if (existingOperators.length > 0) {
                const allSameSegment = existingOperators.every((lo: any) => 
                  lo.user.segment === user.segment
                );
                
                if (!allSameSegment) {
                  // Linha já tem operador de outro segmento, não pode atribuir
                  availableLine = null; // Forçar busca de outra linha
                }
              }

              // Só vincular se passou na validação de segmento
              if (availableLine) {
                // Vincular operador à linha usando método com transaction + lock
                try {
                  await this.linesService.assignOperatorToLine(availableLine.id, user.id);

              // Atualizar user object
              user.line = availableLine.id;
              
              // Notificação removida - operador não precisa saber
                } catch (error) {
                  console.error(`❌ [WebSocket] Erro ao vincular linha ${availableLine.id} ao operador ${user.id}:`, error.message);
                  // Continuar para tentar outra linha
                  availableLine = null;
                }
              }
            }
          }
          
          // Se ainda não tem linha, tentar busca mais ampla (qualquer linha ativa)
          if (!availableLine || !user.line) {
            // Buscar qualquer linha ativa (sem filtro de segmento)
            const anyActiveLines = await this.prisma.linesStock.findMany({
              where: {
                lineStatus: 'active',
              },
            });
            
            // Filtrar por evolutions ativas
            const filteredAnyLines = await this.controlPanelService.filterLinesByActiveEvolutions(anyActiveLines, user.segment);
            const fallbackLine = await this.findAvailableLineForOperator(filteredAnyLines, user.id, user.segment);
            
            if (fallbackLine) {
              const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
                where: { lineId: fallbackLine.id },
              });
              
              if (currentOperatorsCount < 2) {
                // Verificar se não tem operadores de outro segmento
                const existingOperators = await (this.prisma as any).lineOperator.findMany({
                  where: { lineId: fallbackLine.id },
                  include: { user: true },
                });
                
                const canAssign = existingOperators.length === 0 || 
                  existingOperators.every((lo: any) => lo.user.segment === user.segment);
                
                if (canAssign) {
                  // Vincular operador à linha usando método com transaction + lock
                  try {
                    await this.linesService.assignOperatorToLine(fallbackLine.id, user.id);
                    
                    // Atualizar segmento da linha se operador tem segmento
                    if (user.segment && fallbackLine.segment !== user.segment) {
                      await this.prisma.linesStock.update({
                        where: { id: fallbackLine.id },
                        data: { segment: user.segment },
                      });
                    }
                    
                    user.line = fallbackLine.id;
                    
                    // Notificação removida - operador não precisa saber
                  } catch (error) {
                    console.error(`❌ [WebSocket] Erro ao vincular linha ${fallbackLine.id} ao operador ${user.id}:`, error.message);
                    // Continuar para tentar outra linha
                  }
                }
            }
          } else {
              console.error(`❌ [WebSocket] Nenhuma linha disponível para o operador ${user.name} após todas as tentativas`);
              // Notificação removida - operador não precisa saber
              // Nota: Fila de espera será implementada futuramente se necessário
            }
          }
        }
      }

      // Enviar conversas ativas ao conectar (apenas para operators)
      // Buscar por userId mesmo se não tiver linha, pois as conversas estão vinculadas ao operador
      if (user.role === 'operator') {
        // Buscar conversas apenas por userId (não por userLine)
        // Isso permite que as conversas continuem aparecendo mesmo se a linha foi banida
        const activeConversations = await this.conversationsService.findActiveConversations(undefined, user.id);
        client.emit('active-conversations', activeConversations);

        // Processar mensagens pendentes na fila quando operador fica online
        if (user.line) {
          try {
            // Buscar mensagens pendentes do segmento do operador
            const whereClause: any = { status: 'pending' };
            if (user.segment) {
              whereClause.segment = user.segment;
            }

            // Remover limite de 10 - processar todas as mensagens pendentes
            const pendingMessages = await (this.prisma as any).messageQueue.findMany({
              where: whereClause,
              orderBy: { createdAt: 'asc' },
              // Processar em lotes de 50 para não sobrecarregar
              take: 50,
            });

            for (const queuedMessage of pendingMessages) {
              try {
                await (this.prisma as any).messageQueue.update({
                  where: { id: queuedMessage.id },
                  data: { status: 'processing', attempts: { increment: 1 } },
                });

                // Criar conversa
                await this.conversationsService.create({
                  contactPhone: queuedMessage.contactPhone,
                  contactName: queuedMessage.contactName || queuedMessage.contactPhone,
                  message: queuedMessage.message,
                  sender: 'contact',
                  messageType: queuedMessage.messageType,
                  mediaUrl: queuedMessage.mediaUrl,
                  segment: queuedMessage.segment,
                  userId: user.id,
                  userLine: user.line,
                });

                await (this.prisma as any).messageQueue.update({
                  where: { id: queuedMessage.id },
                  data: { status: 'sent', processedAt: new Date() },
                });

                this.emitToUser(user.id, 'queued-message-processed', {
                  messageId: queuedMessage.id,
                  contactPhone: queuedMessage.contactPhone,
                });
              } catch (error) {
                console.error(`❌ [WebSocket] Erro ao processar mensagem ${queuedMessage.id}:`, error);
                if (queuedMessage.attempts >= 3) {
                  await (this.prisma as any).messageQueue.update({
                    where: { id: queuedMessage.id },
                    data: { status: 'failed', errorMessage: error.message },
                  });
                } else {
                  await (this.prisma as any).messageQueue.update({
                    where: { id: queuedMessage.id },
                    data: { status: 'pending' },
                  });
                }
              }
            }

          } catch (error) {
            console.error('❌ [WebSocket] Erro ao processar fila de mensagens:', error);
          }
        }
      }
    } catch (error) {
      console.error('Erro na autenticação WebSocket:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (client.data.user) {
      const userId = client.data.user.id;
      
      try {
      // Atualizar status do usuário para Offline
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: 'Offline' },
      });
      
        // Registrar evento de desconexão
        if (client.data.user.role === 'operator') {
          await this.systemEventsService.logEvent(
            EventType.OPERATOR_DISCONNECTED,
            EventModule.WEBSOCKET,
            { userId: userId, userName: client.data.user.name, email: client.data.user.email },
            userId,
            EventSeverity.INFO,
          );
        }
        
        // Log apenas para operadores (fluxo principal)
        if (client.data.user.role === 'operator') {
          console.log(`❌ Operador ${client.data.user.name} desconectado`);
        }
      } catch (error) {
        console.error(`❌ [WebSocket] Erro ao atualizar status na desconexão:`, error);
      } finally {
        // SEMPRE remover do Map, mesmo com erro
        this.connectedUsers.delete(userId);
      }
    }
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contactPhone: string; message: string; messageType?: string; mediaUrl?: string; fileName?: string; isNewConversation?: boolean },
  ) {
    const startTime = Date.now(); // Para métricas de latência
    const user = client.data.user;

    if (!user) {
      console.error('❌ [WebSocket] Usuário não autenticado');
      return { error: 'Usuário não autenticado' };
    }

    // Buscar linha atual do operador (pode estar na tabela LineOperator ou no campo legacy)
    let currentLineId = user.line;
    if (!currentLineId) {
      const lineOperator = await (this.prisma as any).lineOperator.findFirst({
        where: { userId: user.id },
        select: { lineId: true },
      });
      currentLineId = lineOperator?.lineId || null;
    }

    // Se operador não tem linha, tentar atribuir automaticamente
    if (!currentLineId) {
      
      let availableLine = null;

      // 1. Primeiro, tentar buscar linha do mesmo segmento do operador
      if (user.segment) {
        const segmentLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
            segment: user.segment,
          },
        });

        // Filtrar apenas linhas ativas (Cloud API)
        const filteredLines = segmentLines.filter(l => l.lineStatus === 'active');
        availableLine = await this.findAvailableLineForOperator(filteredLines, user.id, user.segment);
      }

      // 2. Se não encontrou linha do segmento, buscar linha padrão (segmento "Padrão")
      if (!availableLine) {
        const defaultSegment = await this.prisma.segment.findUnique({
          where: { name: 'Padrão' },
        });

        if (defaultSegment) {
          const defaultLines = await this.prisma.linesStock.findMany({
            where: {
              lineStatus: 'active',
              segment: defaultSegment.id,
            },
          });

          // Filtrar apenas linhas ativas (Cloud API)
          const filteredDefaultLines = defaultLines.filter(l => l.lineStatus === 'active');
          availableLine = await this.findAvailableLineForOperator(filteredDefaultLines, user.id, user.segment);

          // Se encontrou linha padrão e operador tem segmento, atualizar o segmento da linha
          if (availableLine && user.segment) {
            await this.prisma.linesStock.update({
              where: { id: availableLine.id },
              data: { segment: user.segment },
            });
          }
        }
      }

      if (availableLine) {
        // Verificar quantos operadores já estão vinculados
        const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
          where: { lineId: availableLine.id },
        });

        if (currentOperatorsCount < 2) {
          // Verificar se a linha já tem operadores de outro segmento
          const existingOperators = await (this.prisma as any).lineOperator.findMany({
            where: { lineId: availableLine.id },
            include: { user: true },
          });

          // Se a linha já tem operadores, verificar se são do mesmo segmento
          if (existingOperators.length > 0) {
            const allSameSegment = existingOperators.every((lo: any) => 
              lo.user.segment === user.segment
            );
            
            if (!allSameSegment) {
              // Linha já tem operador de outro segmento, não pode atribuir
              availableLine = null;
            }
          }

          // Só vincular se passou na validação de segmento
          if (availableLine) {
            // Vincular operador à linha usando método com transaction + lock
            try {
              await this.linesService.assignOperatorToLine(availableLine.id, user.id);
              
              // Atualizar user object e currentLineId
              user.line = availableLine.id;
              currentLineId = availableLine.id;

              console.log(`✅ [WebSocket] Linha ${availableLine.phone} atribuída automaticamente ao operador ${user.name} (segmento ${availableLine.segment || 'sem segmento'})`);
              
              // Notificação removida - operador não precisa saber
            } catch (error) {
              console.error(`❌ [WebSocket] Erro ao vincular linha ${availableLine.id} ao operador ${user.id}:`, error.message);
              // Continuar para tentar outra linha
              availableLine = null;
            }
          }
        }
      }

      // Se ainda não tem linha após tentar atribuir, fazer busca ampla (qualquer linha ativa)
      if (!currentLineId) {
        
        // Buscar qualquer linha ativa (sem filtro de segmento)
        const anyActiveLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
          },
        });
        
        // Filtrar apenas linhas ativas (Cloud API)
        const filteredAnyLines = anyActiveLines.filter(l => l.lineStatus === 'active');
        const fallbackLine = await this.findAvailableLineForOperator(filteredAnyLines, user.id, user.segment);
        
        if (fallbackLine) {
          const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
            where: { lineId: fallbackLine.id },
          });
          
          if (currentOperatorsCount < 2) {
            // Verificar se não tem operadores de outro segmento
            const existingOperators = await (this.prisma as any).lineOperator.findMany({
              where: { lineId: fallbackLine.id },
              include: { user: true },
            });
            
            const canAssign = existingOperators.length === 0 || 
              existingOperators.every((lo: any) => lo.user.segment === user.segment);
            
            if (canAssign) {
              // Vincular operador à linha usando método com transaction + lock
              try {
                await this.linesService.assignOperatorToLine(fallbackLine.id, user.id);
                
                // Atualizar segmento da linha se operador tem segmento
                if (user.segment && fallbackLine.segment !== user.segment) {
                  await this.prisma.linesStock.update({
                    where: { id: fallbackLine.id },
                    data: { segment: user.segment },
                  });
                }
                
                user.line = fallbackLine.id;
                currentLineId = fallbackLine.id;
                client.emit('line-assigned', {
                  lineId: fallbackLine.id,
                  linePhone: fallbackLine.phone,
                  message: `Você foi vinculado à linha ${fallbackLine.phone} automaticamente.`,
                });
              } catch (error: any) {
                // Se o erro for "já está vinculado", apenas logar e continuar (não é erro crítico)
                if (error.message?.includes('já está vinculado')) {
                  // Atualizar user.line mesmo assim
                  user.line = fallbackLine.id;
                  currentLineId = fallbackLine.id;
                } else {
                  console.error(`❌ [WebSocket] Erro ao vincular linha ${fallbackLine.id} ao operador ${user.id}:`, error.message);
                  // Continuar para tentar outra linha
                }
              }
            }
          }
        }
        
        // Se ainda não tem linha após todas as tentativas
        if (!currentLineId) {
          console.error('❌ [WebSocket] Operador sem linha atribuída e nenhuma linha disponível após todas as tentativas');
          return { error: 'Você não possui uma linha atribuída' };
        }
      }
    }

    // Verificar se é uma nova conversa (1x1) e se o operador tem permissão
    if (data.isNewConversation) {
      const fullUser = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          oneToOneActive: true,
        },
      });


      if (!fullUser?.oneToOneActive) {
        console.error('❌ [WebSocket] Operador sem permissão para 1x1');
        return { error: 'Você não tem permissão para iniciar conversas 1x1' };
      }
    }

    try {
      // Verificar CPC
      const cpcCheck = await this.controlPanelService.canContactCPC(data.contactPhone, user.segment);
      if (!cpcCheck.allowed) {
        return { error: cpcCheck.reason };
      }

      // Verificar repescagem
      const repescagemCheck = await this.controlPanelService.checkRepescagem(
        data.contactPhone,
        user.id,
        user.segment
      );
      if (!repescagemCheck.allowed) {
        return { error: repescagemCheck.reason };
      }

      // Validação de número: Verificar se o número é válido antes de enviar
      const phoneValidation = this.phoneValidationService.isValidFormat(data.contactPhone);
      if (!phoneValidation) {
        return { error: 'Número de telefone inválido' };
      }

      // Buscar linha atual do operador (sempre usar a linha atual, não a linha antiga da conversa)
      let line = await this.prisma.linesStock.findUnique({
        where: { id: currentLineId },
      });

      if (!line || line.lineStatus !== 'active') {
        return { error: 'Linha não disponível' };
      }

      // Buscar o App para obter o accessToken
      let app = await this.prisma.app.findUnique({
        where: { id: line.appId },
      });

      if (!app) {
        return { error: `App com ID ${line.appId} não encontrado` };
      }

      // Validar credenciais Cloud API
      if (!app.accessToken || !line.numberId) {
        return { error: 'Linha não possui accessToken do app ou numberId configurados' };
      }

      // Rate Limiting: Verificar se a linha pode enviar mensagem
      const canSend = await this.rateLimitingService.canSendMessage(currentLineId);
      if (!canSend) {
        return { error: 'Limite de mensagens atingido' };
      }

      // Humanização: Simular comportamento humano antes de enviar
      const messageLength = data.message?.length || 0;
      const isResponse = !data.isNewConversation; // Se não é nova conversa, é resposta
      const humanizedDelay = await this.humanizationService.getHumanizedDelay(messageLength, isResponse);
      
      await this.humanizationService.sleep(humanizedDelay);

      // Health check: Validar credenciais Cloud API (com cache)
      try {
        const isValid = await this.whatsappCloudService.validateCredentials(
          app.accessToken,
          line.numberId,
        );
        
        if (!isValid) {
          console.warn(`⚠️ [WebSocket] Linha ${line.phone} com credenciais inválidas. Realocando para ${user.name}...`);
          const reallocationResult = await this.lineAssignmentService.reallocateLineForOperator(user.id, user.segment, currentLineId);
          
          if (reallocationResult.success && reallocationResult.lineId && reallocationResult.lineId !== currentLineId) {
            user.line = reallocationResult.lineId;
            currentLineId = reallocationResult.lineId;
            
            const newLine = await this.prisma.linesStock.findUnique({
              where: { id: reallocationResult.lineId },
            });
            
            if (newLine) {
              line = newLine;
              // Buscar o novo App
              const newApp = await this.prisma.app.findUnique({
                where: { id: newLine.appId },
              });
              if (newApp) {
                app = newApp;
              } else {
                return { error: 'Nova linha realocada, mas App não encontrado' };
              }
            } else {
              return { error: 'Linha com credenciais inválidas e realocada, mas nova linha não encontrada' };
            }
          } else {
            return { error: 'Linha com credenciais inválidas e não foi possível realocar' };
          }
        }
      } catch (healthError: any) {
        // Erro no health check não deve bloquear envio (pode ser problema temporário da API)
        console.warn('⚠️ [WebSocket] Erro ao validar credenciais:', healthError.message);
      }

      // Enviar mensagem via WhatsApp Cloud API
      let apiResponse;

      if (data.messageType === 'image' && data.mediaUrl) {
        // Upload mídia primeiro, depois enviar
        try {
          // Obter caminho do arquivo
          let filePath: string;
          if (data.mediaUrl.startsWith('/media/')) {
            const filename = data.mediaUrl.replace('/media/', '');
            filePath = await this.mediaService.getFilePath(filename);
          } else if (data.mediaUrl.startsWith('http')) {
            const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
            if (data.mediaUrl.startsWith(appUrl)) {
              const urlPath = new URL(data.mediaUrl).pathname;
              const filename = urlPath.replace('/media/', '');
              filePath = await this.mediaService.getFilePath(filename);
            } else {
              // Baixar arquivo externo temporariamente
              const response = await axios.get(data.mediaUrl, { responseType: 'arraybuffer' });
              filePath = path.join('./uploads', `temp-${Date.now()}-image.jpg`);
              await fs.mkdir('./uploads', { recursive: true });
              await fs.writeFile(filePath, response.data);
            }
          } else {
            filePath = path.join('./uploads', data.mediaUrl.replace(/^\/media\//, ''));
          }

          // Upload para Cloud API
          const uploadResult = await this.whatsappCloudService.uploadMedia({
            phoneNumberId: line.numberId,
            token: app.accessToken,
            mediaPath: filePath,
            mediaType: 'image',
          });

          // Enviar mídia usando mediaId
          apiResponse = await this.whatsappCloudService.sendMedia({
            phoneNumberId: line.numberId,
            token: app.accessToken,
            to: data.contactPhone,
            mediaType: 'image',
            mediaId: uploadResult.id,
            caption: data.message,
          });

          // Limpar arquivo temporário se necessário
          if (filePath.includes('temp-')) {
            await fs.unlink(filePath).catch(() => {});
          }
        } catch (error: any) {
          console.error('❌ [WebSocket] Erro ao enviar imagem:', error.message);
          throw error;
        }
      } else if ((data.messageType === 'document' || data.messageType === 'video' || data.messageType === 'audio') && data.mediaUrl) {
        // Upload mídia primeiro, depois enviar
        try {
          const fileName = data.fileName || data.mediaUrl.split('/').pop() || 'document.pdf';
          const cleanFileName = fileName.includes('-') && fileName.match(/^\d+-/) 
            ? fileName.replace(/^\d+-/, '').replace(/-\d+\./, '.')
            : fileName;

          // Determinar tipo de mídia baseado na extensão
          const getMediaType = (filename: string): 'document' | 'video' | 'audio' => {
            const ext = filename.split('.').pop()?.toLowerCase();
            if (['mp4', 'mpeg', 'avi', 'mov'].includes(ext || '')) {
              return 'video';
            }
            if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext || '')) {
              return 'audio';
            }
            return 'document';
          };

          const mediaType = getMediaType(cleanFileName);

          // Obter caminho do arquivo
          let filePath: string;
          if (data.mediaUrl.startsWith('/media/')) {
            const filename = data.mediaUrl.replace('/media/', '');
            filePath = await this.mediaService.getFilePath(filename);
          } else if (data.mediaUrl.startsWith('http')) {
            const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
            if (data.mediaUrl.startsWith(appUrl)) {
              const urlPath = new URL(data.mediaUrl).pathname;
              const filename = urlPath.replace('/media/', '');
              filePath = await this.mediaService.getFilePath(filename);
            } else {
              // Baixar arquivo externo temporariamente
              const response = await axios.get(data.mediaUrl, { 
                responseType: 'arraybuffer',
                timeout: 30000,
              });
              filePath = path.join('./uploads', `temp-${Date.now()}-${cleanFileName}`);
              await fs.mkdir('./uploads', { recursive: true });
              await fs.writeFile(filePath, response.data);
            }
          } else {
            filePath = path.join('./uploads', data.mediaUrl.replace(/^\/media\//, ''));
          }

          // Upload para Cloud API
          const uploadResult = await this.whatsappCloudService.uploadMedia({
            phoneNumberId: line.numberId,
            token: app.accessToken,
            mediaPath: filePath,
            mediaType,
          });

          // Enviar mídia usando mediaId
          apiResponse = await this.whatsappCloudService.sendMedia({
            phoneNumberId: line.numberId,
            token: app.accessToken,
            to: data.contactPhone,
            mediaType,
            mediaId: uploadResult.id,
            caption: data.message,
            filename: cleanFileName,
          });

          // Limpar arquivo temporário se necessário
          if (filePath.includes('temp-')) {
            await fs.unlink(filePath).catch(() => {});
          }
        } catch (error: any) {
          console.error('❌ [WebSocket] Erro ao enviar mídia:', error.message);
          throw error;
        }
      } else {
        // Enviar mensagem de texto
        apiResponse = await this.whatsappCloudService.sendTextMessage({
          phoneNumberId: line.numberId,
          token: app.accessToken,
          to: data.contactPhone,
          message: data.message,
        });
      }

      // Buscar contato
      const contact = await this.prisma.contact.findFirst({
        where: { phone: data.contactPhone },
      });

      // Salvar conversa usando a linha ATUAL do operador
      // Isso garante que mesmo se a linha foi trocada, a mensagem vai pela linha atual
      const conversation = await this.conversationsService.create({
        contactName: contact?.name || 'Desconhecido',
        contactPhone: data.contactPhone,
        segment: user.segment,
        userName: user.name,
        userLine: currentLineId, // Sempre usar a linha atual
        userId: user.id, // Operador específico que está enviando
        message: data.message,
        sender: 'operator',
        messageType: data.messageType || 'text',
        mediaUrl: data.mediaUrl,
      });

      // Log apenas para mensagens enviadas com sucesso (fluxo principal)
      console.log(`✅ Mensagem enviada: ${user.name} → ${data.contactPhone}`);
      
      // Registrar mensagem do operador para controle de repescagem
      await this.controlPanelService.registerOperatorMessage(
        data.contactPhone,
        user.id,
        user.segment
      );
      
      // Registrar evento de mensagem enviada
      await this.systemEventsService.logEvent(
        EventType.MESSAGE_SENT,
        EventModule.WEBSOCKET,
        {
          userId: user.id,
          userName: user.name,
          contactPhone: data.contactPhone,
          messageType: data.messageType || 'text',
          lineId: currentLineId,
          linePhone: line?.phone,
        },
        user.id,
        EventSeverity.INFO,
      );
      
      // Emitir mensagem para o usuário (usar mesmo formato que new_message)
      client.emit('message-sent', { message: conversation });

      // Se houver supervisores online do mesmo segmento, enviar para eles também
      this.emitToSupervisors(user.segment, 'new_message', { message: conversation });

      return { success: true, conversation };
    } catch (error: any) {
      console.error('❌ [WebSocket] Erro ao enviar mensagem:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: JSON.stringify(error.response?.data, null, 2),
        message: error.message,
        code: error.code,
        stack: error.stack,
      });
      
      // Registrar evento de erro
      await this.systemEventsService.logEvent(
        error.code === 'ECONNABORTED' || error.message?.includes('timeout')
          ? EventType.TIMEOUT_ERROR
          : EventType.API_ERROR,
        EventModule.WEBSOCKET,
        {
          userId: user.id,
          userName: user.name,
          contactPhone: data.contactPhone,
          errorCode: error.code,
          errorMessage: error.message,
          status: error.response?.status,
        },
        user.id,
        EventSeverity.ERROR,
      );

      // Tentar recuperar automaticamente: realocar linha e tentar novamente
      const recoveryResult = await this.recoverAndRetryMessage(client, user, data, error);
      
      if (recoveryResult.success) {
        // Sucesso após recuperação - não mostrar erro para o operador
        return { success: true, conversation: recoveryResult.conversation };
      } else {
        // Falhou após todas as tentativas - não notificar operador
        return { error: 'Não foi possível enviar a mensagem' };
      }
    }
  }

  /**
   * Tenta recuperar de erros e reenviar a mensagem automaticamente
   * Retorna sucesso se conseguiu enviar, ou falha após todas as tentativas
   */
  private async recoverAndRetryMessage(
    client: Socket,
    user: any,
    data: { contactPhone: string; message: string; messageType?: string; mediaUrl?: string; fileName?: string; isNewConversation?: boolean },
    originalError: any,
  ): Promise<{ success: boolean; conversation?: any; reason?: string }> {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 1. Realocar linha
        const reallocationResult = await this.reallocateLineForOperator(user.id, user.segment);
        
        if (!reallocationResult.success) {
          console.warn(`⚠️ [WebSocket] Falha ao realocar linha na tentativa ${attempt}:`, reallocationResult.reason);
          if (attempt < maxRetries) {
            // Aguardar um pouco antes de tentar novamente
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          console.error(`❌ [WebSocket] Não foi possível realocar linha após ${maxRetries} tentativas`);
          return { success: false, reason: 'Não foi possível realocar linha após múltiplas tentativas' };
        }
        
        // 2. Atualizar user object com nova linha
        user.line = reallocationResult.newLineId;
        
        // 3. Buscar dados da nova linha
        const newLine = await this.prisma.linesStock.findUnique({
          where: { id: reallocationResult.newLineId },
        });
        
        if (!newLine || newLine.lineStatus !== 'active') {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          return { success: false, reason: 'Nova linha não está ativa' };
        }
        
        // 4. Buscar o App da nova linha
        const newApp = await this.prisma.app.findUnique({
          where: { id: newLine.appId },
        });

        if (!newApp || !newApp.accessToken || !newLine.numberId) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          return { success: false, reason: 'Nova linha não possui app ou accessToken configurados' };
        }
        
        // 5. Validar credenciais da nova linha
        try {
          const isValid = await this.whatsappCloudService.validateCredentials(
            newApp.accessToken,
            newLine.numberId,
          );
          if (!isValid) {
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
              continue;
            }
            return { success: false, reason: 'Nova linha com credenciais inválidas' };
          }
        } catch (healthError) {
          // Continuar mesmo assim - tentar enviar
        }
      
        // 6. Tentar enviar mensagem novamente com a nova linha (Cloud API)
        try {
          let apiResponse: any;
          if (data.messageType === 'image' && data.mediaUrl) {
            // Upload e envio de imagem
            let filePath: string;
            if (data.mediaUrl.startsWith('/media/')) {
              const filename = data.mediaUrl.replace('/media/', '');
              filePath = await this.mediaService.getFilePath(filename);
            } else if (data.mediaUrl.startsWith('http')) {
              const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
              if (data.mediaUrl.startsWith(appUrl)) {
                const urlPath = new URL(data.mediaUrl).pathname;
                const filename = urlPath.replace('/media/', '');
                filePath = await this.mediaService.getFilePath(filename);
              } else {
                const response = await axios.get(data.mediaUrl, { responseType: 'arraybuffer' });
                filePath = path.join('./uploads', `temp-${Date.now()}-image.jpg`);
                await fs.mkdir('./uploads', { recursive: true });
                await fs.writeFile(filePath, response.data);
              }
            } else {
              filePath = path.join('./uploads', data.mediaUrl.replace(/^\/media\//, ''));
            }

            const uploadResult = await this.whatsappCloudService.uploadMedia({
              phoneNumberId: newLine.numberId,
              token: newApp.accessToken,
              mediaPath: filePath,
              mediaType: 'image',
            });

            apiResponse = await this.whatsappCloudService.sendMedia({
              phoneNumberId: newLine.numberId,
              token: newApp.accessToken,
              to: data.contactPhone,
              mediaType: 'image',
              mediaId: uploadResult.id,
              caption: data.message,
            });

            if (filePath.includes('temp-')) {
              await fs.unlink(filePath).catch(() => {});
            }
          } else if ((data.messageType === 'document' || data.messageType === 'video' || data.messageType === 'audio') && data.mediaUrl) {
            // Upload e envio de mídia
            const fileName = data.fileName || data.mediaUrl.split('/').pop() || 'document.pdf';
            const getMediaType = (filename: string): 'document' | 'video' | 'audio' => {
              const ext = filename.split('.').pop()?.toLowerCase();
              if (['mp4', 'mpeg', 'avi', 'mov'].includes(ext || '')) return 'video';
              if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext || '')) return 'audio';
              return 'document';
            };
            const mediaType = getMediaType(fileName);

            let filePath: string;
            if (data.mediaUrl.startsWith('/media/')) {
              const filename = data.mediaUrl.replace('/media/', '');
              filePath = await this.mediaService.getFilePath(filename);
            } else if (data.mediaUrl.startsWith('http')) {
              const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
              if (data.mediaUrl.startsWith(appUrl)) {
                const urlPath = new URL(data.mediaUrl).pathname;
                const filename = urlPath.replace('/media/', '');
                filePath = await this.mediaService.getFilePath(filename);
              } else {
                const response = await axios.get(data.mediaUrl, { responseType: 'arraybuffer' });
                filePath = path.join('./uploads', `temp-${Date.now()}-${fileName}`);
                await fs.mkdir('./uploads', { recursive: true });
                await fs.writeFile(filePath, response.data);
              }
            } else {
              filePath = path.join('./uploads', data.mediaUrl.replace(/^\/media\//, ''));
            }

            const uploadResult = await this.whatsappCloudService.uploadMedia({
              phoneNumberId: newLine.numberId,
              token: newApp.accessToken,
              mediaPath: filePath,
              mediaType,
            });

            apiResponse = await this.whatsappCloudService.sendMedia({
              phoneNumberId: newLine.numberId,
              token: newApp.accessToken,
              to: data.contactPhone,
              mediaType,
              mediaId: uploadResult.id,
              caption: data.message,
              filename: fileName,
            });

            if (filePath.includes('temp-')) {
              await fs.unlink(filePath).catch(() => {});
            }
          } else {
            // Enviar mensagem de texto
            apiResponse = await this.whatsappCloudService.sendTextMessage({
              phoneNumberId: newLine.numberId,
              token: newApp.accessToken,
              to: data.contactPhone,
              message: data.message,
            });
          }
        } catch (retryError: any) {
          console.error(`❌ [WebSocket] Erro ao enviar mensagem com nova linha:`, retryError.message);
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          return { success: false, reason: `Erro ao enviar: ${retryError.message}` };
        }
        
        // 7. Se chegou aqui, mensagem foi enviada com sucesso!
        console.log(`✅ Mensagem enviada após recuperação: ${user.name} → ${data.contactPhone} (tentativa ${attempt})`);
        
        // Buscar contato
        const contact = await this.prisma.contact.findFirst({
          where: { phone: data.contactPhone },
        });
        
        // Salvar conversa
        const conversation = await this.conversationsService.create({
          contactName: contact?.name || 'Desconhecido',
          contactPhone: data.contactPhone,
          segment: user.segment,
          userName: user.name,
          userLine: newLine.id,
          userId: user.id,
          message: data.message,
          sender: 'operator',
          messageType: data.messageType || 'text',
          mediaUrl: data.mediaUrl,
        });
        
        // Registrar mensagem do operador
        await this.controlPanelService.registerOperatorMessage(
          data.contactPhone,
          user.id,
          user.segment
        );
        
        // Emitir mensagem para o usuário
        client.emit('message-sent', { message: conversation });
        this.emitToSupervisors(user.segment, 'new_message', { message: conversation });
        
        return { success: true, conversation };
        
      } catch (retryError: any) {
        console.error(`❌ [WebSocket] Erro na tentativa ${attempt} de recuperação:`, {
          message: retryError.message,
          status: retryError.response?.status,
          data: retryError.response?.data,
        });
        
        // Se não for a última tentativa, continuar
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        
        // Última tentativa falhou
        console.error(`❌ [WebSocket] Falha após ${maxRetries} tentativas de recuperação`);
        return { success: false, reason: `Falha após ${maxRetries} tentativas: ${retryError.message}` };
      }
    }
    
    return { success: false, reason: 'Todas as tentativas de recuperação falharam' };
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contactPhone: string; typing: boolean },
  ) {
    // Emitir evento de digitação para outros usuários
    client.broadcast.emit('user-typing', {
      contactPhone: data.contactPhone,
      typing: data.typing,
    });
  }

  // Método auxiliar para encontrar linha disponível para o operador
  private async findAvailableLineForOperator(availableLines: any[], userId: number, userSegment: number | null) {
    for (const line of availableLines) {
      // IMPORTANTE: Verificar se a linha pertence ao mesmo segmento do operador
      // Se a linha tem segmento diferente e não é padrão (null), pular
      if (line.segment !== null && line.segment !== userSegment) {
        continue;
      }

      const operatorsCount = await (this.prisma as any).lineOperator.count({
        where: { lineId: line.id },
      });

      if (operatorsCount < 2) {
        // Verificar se o operador já está vinculado a esta linha
        const existing = await (this.prisma as any).lineOperator.findUnique({
          where: {
            lineId_userId: {
              lineId: line.id,
              userId,
            },
          },
        });

        if (!existing) {
          // Verificar se a linha já tem operadores de outro segmento
          const existingOperators = await (this.prisma as any).lineOperator.findMany({
            where: { lineId: line.id },
            include: { user: true },
          });

          // Se a linha já tem operadores, verificar se são do mesmo segmento
          if (existingOperators.length > 0) {
            const allSameSegment = existingOperators.every((lo: any) => 
              lo.user.segment === userSegment
            );
            
            if (!allSameSegment) {
              // Linha já tem operador de outro segmento, não pode atribuir
              continue;
            }
          }

          return line;
        }
      }
    }
    return null;
  }

  // Método para realocar linha quando houver problemas (timeout, etc)
  private async reallocateLineForOperator(userId: number, userSegment: number | null): Promise<{
    success: boolean;
    oldLinePhone?: string;
    newLinePhone?: string;
    newLineId?: number;
    reason?: string;
  }> {
    try {
      // Buscar operador atual
      const operator = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!operator || operator.role !== 'operator') {
        return { success: false, reason: 'Operador não encontrado' };
      }

      // Buscar linha atual
      let currentLineId = operator.line;
      if (!currentLineId) {
        // Tentar buscar na tabela LineOperator
        const lineOperator = await (this.prisma as any).lineOperator.findFirst({
          where: { userId },
        });
        currentLineId = lineOperator?.lineId || null;
      }

      let oldLinePhone = null;
      if (currentLineId) {
        const oldLine = await this.prisma.linesStock.findUnique({
          where: { id: currentLineId },
        });
        oldLinePhone = oldLine?.phone || null;

        // Remover operador da linha antiga
        await (this.prisma as any).lineOperator.deleteMany({
          where: { userId, lineId: currentLineId },
        });
      }

      // Buscar nova linha disponível
      let availableLine = null;

      // 1. Primeiro, tentar buscar linha do mesmo segmento do operador
      if (userSegment) {
        const segmentLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
            segment: userSegment,
          },
        });

        // Filtrar por evolutions ativas
        const filteredLines = await this.controlPanelService.filterLinesByActiveEvolutions(segmentLines, userSegment);
        availableLine = await this.findAvailableLineForOperator(filteredLines, userId, userSegment);
      }

      // 2. Se não encontrou linha do segmento, buscar linha padrão
      if (!availableLine) {
        const defaultSegment = await this.prisma.segment.findUnique({
          where: { name: 'Padrão' },
        });

        if (defaultSegment) {
          const defaultLines = await this.prisma.linesStock.findMany({
            where: {
              lineStatus: 'active',
              segment: defaultSegment.id,
            },
          });

          // Filtrar por evolutions ativas
          const filteredDefaultLines = await this.controlPanelService.filterLinesByActiveEvolutions(defaultLines, userSegment);
          availableLine = await this.findAvailableLineForOperator(filteredDefaultLines, userId, userSegment);

          // Se encontrou linha padrão e operador tem segmento, atualizar o segmento da linha
          if (availableLine && userSegment) {
            await this.prisma.linesStock.update({
              where: { id: availableLine.id },
              data: { segment: userSegment },
            });
          }
        }
      }

      if (!availableLine) {
        return { success: false, reason: 'Nenhuma linha disponível' };
      }

      // Verificar quantos operadores já estão vinculados
      const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
        where: { lineId: availableLine.id },
      });

      // Vincular operador à nova linha usando método com transaction + lock
      try {
        await this.linesService.assignOperatorToLine(availableLine.id, userId); // ✅ COM LOCK


        // Registrar evento de realocação
        await this.systemEventsService.logEvent(
          EventType.LINE_REALLOCATED,
          EventModule.WEBSOCKET,
          {
            userId: userId,
            userName: operator.name,
            oldLinePhone: oldLinePhone || null,
            newLinePhone: availableLine.phone,
            newLineId: availableLine.id,
          },
          userId,
          EventSeverity.WARNING,
        );

        return {
          success: true,
          oldLinePhone: oldLinePhone || undefined,
          newLinePhone: availableLine.phone,
          newLineId: availableLine.id,
        };
      } catch (error: any) {
        console.error(`❌ [WebSocket] Erro ao vincular nova linha:`, error.message);
        return { success: false, reason: error.message };
      }
    } catch (error: any) {
      console.error('❌ [WebSocket] Erro ao realocar linha:', error);
      return { success: false, reason: error.message || 'Erro desconhecido' };
    }
  }

  // Método para emitir mensagens recebidas via webhook
  async emitNewMessage(conversation: any) {
    console.log(`📤 Emitindo new_message para contactPhone: ${conversation.contactPhone}`, {
      userId: conversation.userId,
      userLine: conversation.userLine,
    });
    
    // Emitir para o operador específico que está atendendo (userId)
    if (conversation.userId) {
      const socketId = this.connectedUsers.get(conversation.userId);
      if (socketId) {
        const user = await this.prisma.user.findUnique({
          where: { id: conversation.userId },
        });
        if (user) {
          console.log(`  → Enviando para ${user.name} (${user.role}) - operador específico (userId: ${conversation.userId})`);
          // Usar underscore para corresponder ao frontend: new_message
          this.server.to(socketId).emit('new_message', { message: conversation });
        } else {
          console.warn(`  ⚠️ Operador ${conversation.userId} não encontrado no banco`);
        }
      } else {
        console.warn(`  ⚠️ Operador ${conversation.userId} não está conectado via WebSocket`);
      }
    }
    
    // Se não tiver userId OU se o userId não estiver conectado, enviar para todos os operadores online da linha
    if (!conversation.userId || !this.connectedUsers.has(conversation.userId)) {
      if (conversation.userLine) {
        console.log(`  → Fallback: Enviando para todos os operadores online da linha ${conversation.userLine}`);
        const lineOperators = await (this.prisma as any).lineOperator.findMany({
          where: { lineId: conversation.userLine },
          include: { user: true },
        });

        const onlineLineOperators = lineOperators.filter(lo => 
          lo.user.status === 'Online' && lo.user.role === 'operator'
        );

        console.log(`  → Encontrados ${onlineLineOperators.length} operador(es) online na linha ${conversation.userLine}`);

        onlineLineOperators.forEach(lo => {
          const socketId = this.connectedUsers.get(lo.userId);
          if (socketId) {
            console.log(`  → Enviando para ${lo.user.name} (${lo.user.role}) - operador da linha`);
            this.server.to(socketId).emit('new_message', { message: conversation });
          } else {
            console.warn(`  ⚠️ Operador ${lo.user.name} (${lo.userId}) não está conectado via WebSocket`);
          }
        });

        // Se não encontrou nenhum operador online na linha, logar para debug
        if (onlineLineOperators.length === 0) {
          console.warn(`  ⚠️ Nenhum operador online encontrado na linha ${conversation.userLine} para receber a mensagem`);
          console.log(`  → Operadores vinculados à linha:`, lineOperators.map(lo => ({
            userId: lo.userId,
            name: lo.user.name,
            status: lo.user.status,
            role: lo.user.role,
            connected: this.connectedUsers.has(lo.userId),
          })));
        }
      } else {
        console.warn(`  ⚠️ Conversa sem userId e sem userLine - não é possível enviar`);
      }
    }

    // Emitir para supervisores do segmento
    if (conversation.segment) {
      this.emitToSupervisors(conversation.segment, 'new_message', { message: conversation });
    }
  }

  emitToUser(userId: number, event: string, data: any) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      const client = this.server.sockets.sockets.get(socketId);
      if (client) {
        client.emit(event, data);
      }
    }
  }

  private async emitToSupervisors(segment: number, event: string, data: any) {
    const supervisors = await this.prisma.user.findMany({
      where: {
        role: 'supervisor',
        segment,
      },
    });

    supervisors.forEach(supervisor => {
      const socketId = this.connectedUsers.get(supervisor.id);
      if (socketId) {
        this.server.to(socketId).emit(event, data);
      }
    });
  }

  // Emitir atualização de conversa tabulada
  async emitConversationTabulated(contactPhone: string, tabulationId: number) {
    this.server.emit('conversation-tabulated', { contactPhone, tabulationId });
  }

  /**
   * Método público para enviar mensagem via WhatsApp Cloud API
   * Usado por serviços externos (ex: AutoMessageService)
   */
  async sendMessageToCloudApi(
    phoneNumberId: string,
    token: string,
    contactPhone: string,
    message: string,
  ): Promise<void> {
    try {
      await this.whatsappCloudService.sendTextMessage({
        phoneNumberId,
        token,
        to: contactPhone,
        message,
      });
    } catch (error: any) {
      console.error(`❌ [WebSocket] Erro ao enviar mensagem via Cloud API:`, error.message);
      throw error;
    }
  }
}
