import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ReportFilterDto } from './dto/report-filter.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Response } from 'express';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * RELATÓRIOS FUNDAMENTAIS
   */

  @Get('op-sintetico')
  @Roles('admin', 'supervisor')
  async getOpSinteticoReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getOpSinteticoReport(filters);
  }

  @Get('kpi')
  @Roles('admin', 'supervisor')
  async getKpiReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getKpiReport(filters);
  }

  @Get('hsm')
  @Roles('admin', 'supervisor')
  async getHsmReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getHsmReport(filters);
  }

  @Get('line-status')
  @Roles('admin', 'supervisor')
  async getLineStatusReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getLineStatusReport(filters);
  }

  /**
   * RELATÓRIOS BANCO DE DADOS
   */

  @Get('envios')
  @Roles('admin', 'supervisor')
  async getEnviosReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getEnviosReport(filters);
  }

  @Get('indicadores')
  @Roles('admin', 'supervisor')
  async getIndicadoresReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getIndicadoresReport(filters);
  }

  @Get('tempos')
  @Roles('admin', 'supervisor')
  async getTemposReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getTemposReport(filters);
  }

  /**
   * NOVOS RELATÓRIOS - TEMPLATES
   */

  @Get('templates')
  @Roles('admin', 'supervisor')
  async getTemplatesReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getTemplatesReport(filters);
  }

  @Get('completo-csv')
  @Roles('admin', 'supervisor')
  async getCompletoCsvReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getCompletoCsvReport(filters);
  }

  @Get('equipe')
  @Roles('admin', 'supervisor')
  async getEquipeReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getEquipeReport(filters);
  }

  @Get('dados-transacionados')
  @Roles('admin', 'supervisor')
  async getDadosTransacionadosReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getDadosTransacionadosReport(filters);
  }

  @Get('detalhado-conversas')
  @Roles('admin', 'supervisor')
  async getDetalhadoConversasReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getDetalhadoConversasReport(filters);
  }

  @Get('linhas')
  @Roles('admin', 'supervisor')
  async getLinhasReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getLinhasReport(filters);
  }

  @Get('resumo-atendimentos')
  @Roles('admin', 'supervisor')
  async getResumoAtendimentosReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getResumoAtendimentosReport(filters);
  }

  @Get('usuarios')
  @Roles('admin', 'supervisor')
  async getUsuariosReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getUsuariosReport(filters);
  }

  @Get('hiper-personalizado')
  @Roles('admin', 'supervisor')
  async getHiperPersonalizadoReport(@Query() filters: ReportFilterDto) {
    return this.reportsService.getHiperPersonalizadoReport(filters);
  }

  /**
   * RELATÓRIO CONSOLIDADO
   * Retorna todos os relatórios de uma vez
   */
  @Get('consolidado')
  @Roles('admin', 'supervisor')
  async getConsolidatedReport(@Query() filters: ReportFilterDto) {
    const [
      opSintetico,
      kpi,
      hsm,
      lineStatus,
      envios,
      indicadores,
      tempos,
      templates,
      completoCsv,
      equipe,
      dadosTransacionados,
      detalhadoConversas,
      linhas,
      resumoAtendimentos,
      usuarios,
      hiperPersonalizado,
    ] = await Promise.all([
      this.reportsService.getOpSinteticoReport(filters),
      this.reportsService.getKpiReport(filters),
      this.reportsService.getHsmReport(filters),
      this.reportsService.getLineStatusReport(filters),
      this.reportsService.getEnviosReport(filters),
      this.reportsService.getIndicadoresReport(filters),
      this.reportsService.getTemposReport(filters),
      this.reportsService.getTemplatesReport(filters),
      this.reportsService.getCompletoCsvReport(filters),
      this.reportsService.getEquipeReport(filters),
      this.reportsService.getDadosTransacionadosReport(filters),
      this.reportsService.getDetalhadoConversasReport(filters),
      this.reportsService.getLinhasReport(filters),
      this.reportsService.getResumoAtendimentosReport(filters),
      this.reportsService.getUsuariosReport(filters),
      this.reportsService.getHiperPersonalizadoReport(filters),
    ]);

    return {
      periodo: {
        inicio: filters.startDate || 'Início',
        fim: filters.endDate || 'Atual',
      },
      segmento: filters.segment || 'Todos',
      relatorios: {
        opSintetico,
        kpi,
        hsm,
        lineStatus,
        envios,
        indicadores,
        tempos,
        templates,
        completoCsv,
        equipe,
        dadosTransacionados,
        detalhadoConversas,
        linhas,
        resumoAtendimentos,
        usuarios,
        hiperPersonalizado,
      },
    };
  }
}

