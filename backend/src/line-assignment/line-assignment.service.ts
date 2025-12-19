import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LinesService } from '../lines/lines.service';
import { ControlPanelService } from '../control-panel/control-panel.service';
import { AppLoggerService } from '../logger/logger.service';

interface LineAssignmentResult {
  success: boolean;
  lineId?: number;
  linePhone?: string;
  reason?: string;
}

@Injectable()
export class LineAssignmentService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => LinesService))
    private linesService: LinesService,
    private controlPanelService: ControlPanelService,
    private logger: AppLoggerService,
  ) {}

  /**
   * Encontra uma linha disponível para um operador
   * Centraliza toda a lógica de atribuição de linha (elimina duplicação)
   */
  async findAvailableLineForOperator(
    userId: number,
    userSegment: number | null,
    traceId?: string,
  ): Promise<LineAssignmentResult> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          lineOperators: {
            include: {
              line: true,
            },
          },
        },
      });

      if (!user) {
        return { success: false, reason: 'Usuário não encontrado' };
      }

      // Se já tem linha ativa, retornar
      if (user.line) {
        const existingLine = await this.prisma.linesStock.findUnique({
          where: { id: user.line },
        });

        if (existingLine && existingLine.lineStatus === 'active') {
          this.logger.log(
            `Operador ${user.name} já possui linha ativa: ${existingLine.phone}`,
            'LineAssignment',
            { userId, lineId: existingLine.id, traceId },
          );
          return {
            success: true,
            lineId: existingLine.id,
            linePhone: existingLine.phone,
          };
        }
      }

      // Buscar linhas disponíveis seguindo prioridade:
      // 1. Linhas do segmento do operador
      // 2. Linhas com segmento null
      // 3. Qualquer linha ativa

      const availableLines = await this.prisma.linesStock.findMany({
        where: {
          lineStatus: 'active',
        },
        include: {
          operators: {
            include: {
              user: true,
            },
          },
        },
      });

      // Prioridade 1: Linhas do segmento do operador
      let candidateLine = availableLines.find((line) => {
        if (line.segment !== userSegment) return false;
        if (line.operators.length >= 2) return false;
        // Verificar se não mistura segmentos
        const hasDifferentSegment = line.operators.some(
          (op) => op.user.segment !== userSegment,
        );
        return !hasDifferentSegment;
      });

      // Prioridade 2: Linhas com segmento null
      if (!candidateLine) {
        candidateLine = availableLines.find((line) => {
          if (line.segment !== null) return false;
          if (line.operators.length >= 2) return false;
          return true;
        });
      }

      // Prioridade 3: Qualquer linha ativa com espaço
      if (!candidateLine) {
        candidateLine = availableLines.find((line) => line.operators.length < 2);
      }

      if (!candidateLine) {
        this.logger.warn(
          `Nenhuma linha disponível para operador ${user.name}`,
          'LineAssignment',
          { userId, userSegment, traceId },
        );
        return { success: false, reason: 'Nenhuma linha disponível' };
      }

      // Atribuir linha usando método com transaction e lock
      try {
        await this.linesService.assignOperatorToLine(candidateLine.id, userId);
        
        // Se a linha tinha segmento null, atualizar para o segmento do operador
        if (candidateLine.segment === null && userSegment !== null) {
          await this.prisma.linesStock.update({
            where: { id: candidateLine.id },
            data: { segment: userSegment },
          });
        }

        this.logger.log(
          `Linha ${candidateLine.phone} atribuída ao operador ${user.name}`,
          'LineAssignment',
          { userId, lineId: candidateLine.id, linePhone: candidateLine.phone, traceId },
        );

        return {
          success: true,
          lineId: candidateLine.id,
          linePhone: candidateLine.phone,
        };
      } catch (error: any) {
        this.logger.error(
          `Erro ao atribuir linha ${candidateLine.phone} ao operador ${user.name}`,
          error.stack,
          'LineAssignment',
          { userId, lineId: candidateLine.id, error: error.message, traceId },
        );
        return { success: false, reason: error.message };
      }
    } catch (error: any) {
      this.logger.error(
        `Erro ao buscar linha disponível para operador ${userId}`,
        error.stack,
        'LineAssignment',
        { userId, error: error.message, traceId },
      );
      return { success: false, reason: error.message };
    }
  }

  /**
   * Realoca uma linha para um operador (quando linha atual foi banida)
   */
  async reallocateLineForOperator(
    userId: number,
    userSegment: number | null,
    oldLineId?: number,
    traceId?: string,
  ): Promise<LineAssignmentResult> {
    try {
      // Remover operador da linha antiga
      if (oldLineId) {
        await this.prisma.lineOperator.deleteMany({
          where: {
            userId,
            lineId: oldLineId,
          },
        });

        await this.prisma.user.update({
          where: { id: userId },
          data: { line: null },
        });
      }

      // Buscar nova linha disponível
      return await this.findAvailableLineForOperator(userId, userSegment, traceId);
    } catch (error: any) {
      this.logger.error(
        `Erro ao realocar linha para operador ${userId}`,
        error.stack,
        'LineAssignment',
        { userId, oldLineId, error: error.message, traceId },
      );
      return { success: false, reason: error.message };
    }
  }
}

