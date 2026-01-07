import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { SendTemplateDto, SendTemplateMassiveDto } from './dto/send-template.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  /**
   * CRUD de Templates
   */

  @Post()
  @Roles('admin', 'supervisor')
  create(@Body() createTemplateDto: CreateTemplateDto) {
    return this.templatesService.create(createTemplateDto);
  }

  @Get()
  @Roles('admin', 'supervisor', 'operator')
  findAll(@Query() filters?: any) {
    return this.templatesService.findAll(filters);
  }

  @Get(':id')
  @Roles('admin', 'supervisor', 'operator')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.templatesService.findOne(id);
  }

  @Get('segment/:segmentId')
  @Roles('admin', 'supervisor', 'operator')
  findBySegment(@Param('segmentId', ParseIntPipe) segmentId: number) {
    return this.templatesService.findBySegment(segmentId);
  }

  // Buscar templates por linha (retorna templates do segmento da linha + globais)
  @Get('line/:lineId')
  @Roles('admin', 'supervisor', 'operator')
  findByLine(@Param('lineId', ParseIntPipe) lineId: number) {
    return this.templatesService.findByLineAndSegment(lineId);
  }

  @Patch(':id')
  @Roles('admin', 'supervisor')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTemplateDto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(id, updateTemplateDto);
  }

  @Delete(':id')
  @Roles('admin', 'supervisor')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.templatesService.remove(id);
  }

  /**
   * Sincronização com WhatsApp Cloud API
   */

  @Post(':id/sync')
  @Roles('admin')
  syncWithCloudApi(@Param('id', ParseIntPipe) id: number) {
    return this.templatesService.syncWithCloudApi(id);
  }

  /**
   * Envio de Templates (1x1)
   */

  @Post('send')
  @Roles('admin', 'supervisor', 'operator')
  sendTemplate(@Body() sendTemplateDto: SendTemplateDto, @CurrentUser() user: any) {
    return this.templatesService.sendTemplate(sendTemplateDto, user);
  }

  /**
   * Envio de Templates (Massivo)
   */

  @Post('send/massive')
  @Roles('admin', 'supervisor')
  sendTemplateMassive(@Body() sendTemplateMassiveDto: SendTemplateMassiveDto) {
    return this.templatesService.sendTemplateMassive(sendTemplateMassiveDto);
  }

  /**
   * Histórico e Estatísticas
   */

  @Get(':id/history')
  @Roles('admin', 'supervisor')
  getHistory(
    @Param('id', ParseIntPipe) id: number,
    @Query() filters?: any,
  ) {
    return this.templatesService.getTemplateHistory(id, filters);
  }

  @Get(':id/stats')
  @Roles('admin', 'supervisor')
  getStats(@Param('id', ParseIntPipe) id: number) {
    return this.templatesService.getTemplateStats(id);
  }

  /**
   * Exportação de Templates em CSV
   */
  @Get('export/csv')
  @Roles(Role.admin, Role.supervisor, Role.digital)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="templates.csv"')
  async exportToCsv(@Query() filters?: any, @Res() res?: Response) {
    const csv = await this.templatesService.exportToCsv(filters);
    
    // Adicionar BOM (Byte Order Mark) para UTF-8 para garantir encoding correto no Excel
    const csvWithBom = '\ufeff' + csv;
    
    if (res) {
      res.send(csvWithBom);
    } else {
      return csvWithBom;
    }
  }
}

