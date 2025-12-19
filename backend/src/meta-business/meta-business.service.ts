import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface BusinessAccount {
  id: string;
  name: string;
  primary_page_id?: string;
}

export interface PhoneNumber {
  id: string;
  verified_name: string;
  display_phone_number: string;
  quality_rating: string;
  code_verification_status: string;
}

export interface WebhookConfig {
  url: string;
  verify_token: string;
  fields: string[];
}

@Injectable()
export class MetaBusinessService {
  private readonly logger = new Logger(MetaBusinessService.name);
  private readonly apiVersion = 'v21.0';
  private readonly baseUrl = 'https://graph.facebook.com';

  /**
   * Lista contas de negócio do Meta
   */
  async getBusinessAccounts(accessToken: string): Promise<BusinessAccount[]> {
    try {
      const response = await axios.get<{ data: BusinessAccount[] }>(
        `${this.baseUrl}/${this.apiVersion}/me/businesses`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      return response.data.data || [];
    } catch (error: any) {
      this.logger.error(`Erro ao listar contas de negócio: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao listar contas de negócio: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Lista números de telefone de uma conta de negócio
   */
  async getPhoneNumbers(businessId: string, accessToken: string): Promise<PhoneNumber[]> {
    try {
      const response = await axios.get<{ data: PhoneNumber[] }>(
        `${this.baseUrl}/${this.apiVersion}/${businessId}/phone_numbers`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      return response.data.data || [];
    } catch (error: any) {
      this.logger.error(`Erro ao listar números: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao listar números: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Configura webhook para um número de telefone
   */
  async configureWebhook(
    phoneNumberId: string,
    accessToken: string,
    webhookUrl: string,
    verifyToken: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      // Configurar webhook via API do Meta
      const response = await axios.post(
        `${this.baseUrl}/${this.apiVersion}/${phoneNumberId}/subscribed_apps`,
        {
          subscribed_fields: [
            'messages',
            'message_status',
            'message_template_status_update',
          ],
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Webhook configurado para phoneNumberId: ${phoneNumberId}`);
      
      // Nota: A URL do webhook e verify_token são configurados no Meta Business Manager
      // Este método apenas ativa os campos de inscrição
      
      return {
        success: true,
        message: 'Webhook configurado com sucesso. Configure a URL e verify_token no Meta Business Manager.',
      };
    } catch (error: any) {
      this.logger.error(`Erro ao configurar webhook: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao configurar webhook: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Valida credenciais (token e businessId)
   */
  async verifyCredentials(accessToken: string, businessId?: string): Promise<boolean> {
    try {
      if (businessId) {
        // Validar businessId
        await axios.get(
          `${this.baseUrl}/${this.apiVersion}/${businessId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          }
        );
      } else {
        // Validar apenas token
        await axios.get(
          `${this.baseUrl}/${this.apiVersion}/me`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          }
        );
      }

      return true;
    } catch (error: any) {
      this.logger.error(`Erro ao validar credenciais: ${error.response?.data || error.message}`);
      return false;
    }
  }

  /**
   * Obtém informações de um número de telefone
   */
  async getPhoneNumberInfo(phoneNumberId: string, accessToken: string): Promise<PhoneNumber> {
    try {
      const response = await axios.get<PhoneNumber>(
        `${this.baseUrl}/${this.apiVersion}/${phoneNumberId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
          params: {
            fields: 'id,verified_name,display_phone_number,quality_rating,code_verification_status',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Erro ao obter informações do número: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao obter informações do número: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }
}

