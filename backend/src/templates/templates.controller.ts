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
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { SendTemplateDto, SendTemplateMassiveDto } from './dto/send-template.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

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

  // Mantido para compatibilidade
  @Get('line/:lineId')
  @Roles('admin', 'supervisor', 'operator')
  findByLine(@Param('lineId', ParseIntPipe) lineId: number) {
    return this.templatesService.findByLine(lineId);
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
  sendTemplate(@Body() sendTemplateDto: SendTemplateDto) {
    return this.templatesService.sendTemplate(sendTemplateDto);
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
}

