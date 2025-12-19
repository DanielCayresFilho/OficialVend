import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MetaBusinessService } from './meta-business.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('meta-business')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags('Meta Business API')
@ApiBearerAuth()
export class MetaBusinessController {
  constructor(private readonly metaBusinessService: MetaBusinessService) {}

  @Get('accounts')
  @Roles(Role.admin, Role.ativador)
  @ApiOperation({ summary: 'Lista contas de negócio do Meta' })
  @ApiResponse({ status: 200, description: 'Lista de contas de negócio' })
  async getBusinessAccounts(@Query('token') token: string) {
    if (!token) {
      throw new Error('Token de acesso é obrigatório');
    }
    return this.metaBusinessService.getBusinessAccounts(token);
  }

  @Get('phone-numbers/:businessId')
  @Roles(Role.admin, Role.ativador)
  @ApiOperation({ summary: 'Lista números de telefone de uma conta de negócio' })
  @ApiResponse({ status: 200, description: 'Lista de números de telefone' })
  async getPhoneNumbers(
    @Param('businessId') businessId: string,
    @Query('token') token: string,
  ) {
    if (!token) {
      throw new Error('Token de acesso é obrigatório');
    }
    return this.metaBusinessService.getPhoneNumbers(businessId, token);
  }

  @Post('configure-webhook')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Configura webhook para um número de telefone' })
  @ApiResponse({ status: 200, description: 'Webhook configurado com sucesso' })
  async configureWebhook(
    @Body() body: {
      phoneNumberId: string;
      token: string;
      webhookUrl: string;
      verifyToken: string;
    },
  ) {
    return this.metaBusinessService.configureWebhook(
      body.phoneNumberId,
      body.token,
      body.webhookUrl,
      body.verifyToken,
    );
  }

  @Post('verify-credentials')
  @Roles(Role.admin, Role.ativador)
  @ApiOperation({ summary: 'Valida credenciais do Meta' })
  @ApiResponse({ status: 200, description: 'Credenciais válidas ou inválidas' })
  async verifyCredentials(
    @Body() body: { token: string; businessId?: string },
  ) {
    const isValid = await this.metaBusinessService.verifyCredentials(
      body.token,
      body.businessId,
    );
    return { valid: isValid };
  }

  @Get('phone-number/:phoneNumberId')
  @Roles(Role.admin, Role.ativador)
  @ApiOperation({ summary: 'Obtém informações de um número de telefone' })
  @ApiResponse({ status: 200, description: 'Informações do número de telefone' })
  async getPhoneNumberInfo(
    @Param('phoneNumberId') phoneNumberId: string,
    @Query('token') token: string,
  ) {
    if (!token) {
      throw new Error('Token de acesso é obrigatório');
    }
    return this.metaBusinessService.getPhoneNumberInfo(phoneNumberId, token);
  }
}

