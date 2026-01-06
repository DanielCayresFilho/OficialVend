import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { TabulateConversationDto } from './dto/tabulate-conversation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma.service';

@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Roles(Role.admin, Role.supervisor, Role.operator)
  create(@Body() createConversationDto: CreateConversationDto) {
    console.log('📝 [POST /conversations] Criando conversa:', JSON.stringify(createConversationDto, null, 2));
    return this.conversationsService.create(createConversationDto);
  }

  @Get()
  @Roles(Role.admin, Role.supervisor, Role.operator)
  findAll(@Query() filters: any, @CurrentUser() user: any) {
    const where: any = { ...filters };

    // Aplicar filtros baseados no papel do usuário
    if (user.role === Role.operator && user.line) {
      // Operador só vê conversas da sua linha E do seu userId específico
      where.userLine = user.line;
      where.userId = user.id; // Filtrar apenas conversas atribuídas a ele
    } else if (user.role === Role.supervisor && user.segment) {
      // Supervisor só vê conversas do seu segmento
      where.segment = user.segment;
    }
    // Admin e digital não têm filtro - veem todas as conversas

    return this.conversationsService.findAll(where);
  }

  @Get('active')
  @Roles(Role.admin, Role.supervisor, Role.operator)
  getActiveConversations(@CurrentUser() user: any, @Query('days') days?: string) {
    const daysToFilter = days ? parseInt(days) : 3; // Padrão: 3 dias
    console.log(`📋 [GET /conversations/active] Usuário: ${user.name} (${user.role}), line: ${user.line}, segment: ${user.segment}, days: ${daysToFilter}`);

    // Admin e digital veem TODAS as conversas ativas (sem filtro de tempo por padrão)
    if (user.role === Role.admin || user.role === Role.digital) {
      // Para admin/digital, aplicar filtro de tempo apenas se especificado
      const where: any = { tabulation: null };
      if (days) {
        const dateLimitMs = Date.now() - (daysToFilter * 24 * 60 * 60 * 1000);
        const dateLimit = new Date(dateLimitMs);
        where.datetime = { gte: dateLimit };
      }
      return this.conversationsService.findAll(where);
    }
    // Supervisor vê apenas conversas ativas do seu segmento (com filtro de tempo)
    if (user.role === Role.supervisor) {
      const dateLimitMs = Date.now() - (daysToFilter * 24 * 60 * 60 * 1000);
      const dateLimit = new Date(dateLimitMs);
      return this.conversationsService.findAll({
        segment: user.segment,
        tabulation: null,
        datetime: { gte: dateLimit }
      });
    }
    // Operador: buscar conversas apenas por userId (não por userLine)
    // Isso permite que as conversas continuem aparecendo mesmo se a linha foi banida
    return this.conversationsService.findActiveConversations(undefined, user.id, daysToFilter);
  }

  @Get('tabulated')
  @Roles(Role.admin, Role.supervisor, Role.operator)
  getTabulatedConversations(@CurrentUser() user: any, @Query('days') days?: string) {
    const daysToFilter = days ? parseInt(days) : 3; // Padrão: 3 dias
    console.log(`📋 [GET /conversations/tabulated] Usuário: ${user.name} (${user.role}), line: ${user.line}, segment: ${user.segment}, days: ${daysToFilter}`);

    // Admin e digital veem TODAS as conversas tabuladas (sem filtro de tempo por padrão)
    if (user.role === Role.admin || user.role === Role.digital) {
      const where: any = { tabulation: { not: null } };
      if (days) {
        const dateLimitMs = Date.now() - (daysToFilter * 24 * 60 * 60 * 1000);
        const dateLimit = new Date(dateLimitMs);
        where.datetime = { gte: dateLimit };
      }
      return this.conversationsService.findAll(where);
    }
    // Supervisor vê apenas conversas tabuladas do seu segmento (com filtro de tempo)
    if (user.role === Role.supervisor) {
      const dateLimitMs = Date.now() - (daysToFilter * 24 * 60 * 60 * 1000);
      const dateLimit = new Date(dateLimitMs);
      return this.conversationsService.findAll({
        segment: user.segment,
        tabulation: { not: null },
        datetime: { gte: dateLimit }
      });
    }
    // Operador: buscar conversas tabuladas apenas por userId (não por userLine)
    // Isso permite que as conversas tabuladas continuem aparecendo mesmo se a linha foi banida
    return this.conversationsService.findTabulatedConversations(undefined, user.id, daysToFilter);
  }

  @Get('segment/:segment')
  @Roles(Role.supervisor, Role.admin, Role.digital)
  getBySegment(
    @Param('segment') segment: string,
    @Query('tabulated') tabulated?: string,
  ) {
    return this.conversationsService.getConversationsBySegment(
      +segment,
      tabulated === 'true',
    );
  }

  @Get('contact/:phone')
  @Roles(Role.admin, Role.supervisor, Role.operator)
  getByContactPhone(
    @Param('phone') phone: string,
    @Query('tabulated') tabulated?: string,
    @CurrentUser() user?: any,
  ) {
    // Admin, digital e Supervisor podem ver qualquer contato
    // Operador só pode ver contatos da sua linha
    if (user?.role === Role.operator && user?.line) {
      // Verificar se o contato tem conversas na linha do operador
      return this.conversationsService.findByContactPhone(
        phone,
        tabulated === 'true',
        user.line, // Passar a linha como filtro adicional
      );
    }
    return this.conversationsService.findByContactPhone(
      phone,
      tabulated === 'true',
    );
  }

  @Get(':id')
  @Roles(Role.admin, Role.supervisor, Role.operator)
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(+id);
  }

  @Patch(':id')
  @Roles(Role.admin, Role.supervisor, Role.operator)
  update(@Param('id') id: string, @Body() updateConversationDto: UpdateConversationDto) {
    return this.conversationsService.update(+id, updateConversationDto);
  }

  @Post('tabulate/:phone')
  @Roles(Role.operator)
  tabulate(
    @Param('phone') phone: string,
    @Body() tabulateDto: TabulateConversationDto,
  ) {
    return this.conversationsService.tabulateConversation(phone, tabulateDto.tabulationId);
  }

  @Post('recall/:phone')
  @Roles(Role.operator)
  async recallContact(
    @Param('phone') phone: string,
    @CurrentUser() user: any,
  ) {
    console.log(`📞 [POST /conversations/recall/:phone] Operador ${user.name} rechamando contato ${phone}`);
    
    // Buscar linha atual do operador (pode estar na tabela LineOperator ou no campo legacy)
    let userLine = user.line;
    
    // Se não tiver no campo legacy, buscar na tabela LineOperator
    if (!userLine) {
      const lineOperator = await this.prisma.lineOperator.findFirst({
        where: { userId: user.id },
        select: { lineId: true },
      });
      userLine = lineOperator?.lineId || null;
    }
    
    return this.conversationsService.recallContact(phone, user.id, userLine);
  }

  @Post(':id/transfer')
  @Roles(Role.supervisor, Role.admin)
  @ApiOperation({ summary: 'Transferir conversa para outro operador' })
  async transferConversation(
    @Param('id') id: string,
    @Body() body: { targetOperatorId: number },
    @CurrentUser() user: any,
  ) {
    // Buscar a conversa para obter o contactPhone
    const conversation = await this.conversationsService.findOne(+id);
    if (!conversation) {
      throw new Error('Conversa não encontrada');
    }

    return this.conversationsService.transferConversation(
      conversation.contactPhone,
      body.targetOperatorId,
      user,
    );
  }

  @Delete(':id')
  @Roles(Role.admin, Role.supervisor, Role.digital)
  remove(@Param('id') id: string) {
    return this.conversationsService.remove(+id);
  }
}
