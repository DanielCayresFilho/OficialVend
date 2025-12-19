import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import FormData from 'form-data';
import * as fs from 'fs';

export interface SendTextMessageOptions {
  phoneNumberId: string;
  token: string;
  to: string;
  message: string;
  previewUrl?: boolean;
  replyTo?: string; // ID da mensagem para responder
}

export interface SendTemplateOptions {
  phoneNumberId: string;
  token: string;
  to: string;
  templateName: string;
  language: string;
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters?: Array<{
      type: 'text' | 'image' | 'document' | 'video';
      text?: string;
      image?: { link: string };
      document?: { link: string; filename?: string };
      video?: { link: string };
    }>;
    sub_type?: 'url' | 'quick_reply';
    index?: number;
  }>;
}

export interface SendMediaOptions {
  phoneNumberId: string;
  token: string;
  to: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
  mediaUrl?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
}

export interface UploadMediaOptions {
  phoneNumberId: string;
  token: string;
  mediaPath: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
}

export interface MediaUploadResponse {
  id: string;
}

export interface SendMessageResponse {
  messaging_product: string;
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

@Injectable()
export class WhatsappCloudService {
  private readonly logger = new Logger(WhatsappCloudService.name);
  private readonly apiVersion = 'v21.0';
  private readonly baseUrl = 'https://graph.facebook.com';

  /**
   * Envia mensagem de texto via WhatsApp Cloud API
   */
  async sendTextMessage(options: SendTextMessageOptions): Promise<SendMessageResponse> {
    try {
      const cleanPhone = this.cleanPhoneNumber(options.to);
      
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: {
          preview_url: options.previewUrl || false,
          body: options.message,
        },
      };

      // Adicionar contexto de resposta se fornecido
      if (options.replyTo) {
        payload.context = {
          message_id: options.replyTo,
        };
      }
      
      const response = await axios.post<SendMessageResponse>(
        `${this.baseUrl}/${this.apiVersion}/${options.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${options.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Mensagem de texto enviada para ${cleanPhone}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Erro ao enviar mensagem de texto: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao enviar mensagem: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Envia template via WhatsApp Cloud API
   */
  async sendTemplate(options: SendTemplateOptions): Promise<SendMessageResponse> {
    try {
      const cleanPhone = this.cleanPhoneNumber(options.to);

      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'template',
        template: {
          name: options.templateName,
          language: {
            code: options.language,
          },
        },
      };

      if (options.components && options.components.length > 0) {
        payload.template.components = options.components;
      }

      const response = await axios.post<SendMessageResponse>(
        `${this.baseUrl}/${this.apiVersion}/${options.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${options.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Template ${options.templateName} enviado para ${cleanPhone}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Erro ao enviar template: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao enviar template: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Faz upload de mídia para WhatsApp Cloud API
   */
  async uploadMedia(options: UploadMediaOptions): Promise<MediaUploadResponse> {
    try {
      // Validação de tamanho de arquivo antes de upload
      const stats = fs.statSync(options.mediaPath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      
      // Limites do WhatsApp Cloud API (em MB)
      const maxSizes: Record<string, number> = {
        image: 5,
        video: 16,
        audio: 16,
        document: 100,
      };
      
      const maxSize = maxSizes[options.mediaType] || 16;
      if (fileSizeInMB > maxSize) {
        throw new BadRequestException(
          `Arquivo muito grande. Tamanho máximo para ${options.mediaType}: ${maxSize}MB. Arquivo atual: ${fileSizeInMB.toFixed(2)}MB`
        );
      }

      const formData = new FormData();
      
      // Ler arquivo do sistema de arquivos
      const fileStream = fs.createReadStream(options.mediaPath);
      const filename = options.mediaPath.split('/').pop() || 'file';

      formData.append('messaging_product', 'whatsapp');
      formData.append('type', this.getMediaMimeType(options.mediaType));
      formData.append('file', fileStream, {
        filename,
        contentType: this.getMediaMimeType(options.mediaType),
        knownLength: stats.size,
      });

      const response = await axios.post<MediaUploadResponse>(
        `${this.baseUrl}/${this.apiVersion}/${options.phoneNumberId}/media`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${options.token}`,
            ...formData.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      this.logger.log(`Mídia enviada com sucesso: ${response.data.id}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Erro ao fazer upload de mídia: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao fazer upload de mídia: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Envia mídia via WhatsApp Cloud API
   */
  async sendMedia(options: SendMediaOptions): Promise<SendMessageResponse> {
    try {
      const cleanPhone = this.cleanPhoneNumber(options.to);

      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
      };

      if (options.mediaId) {
        // Usar media ID (após upload)
        payload.type = options.mediaType;
        payload[options.mediaType] = {
          id: options.mediaId,
        };
        if (options.caption && (options.mediaType === 'image' || options.mediaType === 'video' || options.mediaType === 'document')) {
          payload[options.mediaType].caption = options.caption;
        }
        if (options.filename && options.mediaType === 'document') {
          payload[options.mediaType].filename = options.filename;
        }
      } else if (options.mediaUrl) {
        // Usar URL direta
        payload.type = options.mediaType;
        payload[options.mediaType] = {
          link: options.mediaUrl,
        };
        if (options.caption && (options.mediaType === 'image' || options.mediaType === 'video' || options.mediaType === 'document')) {
          payload[options.mediaType].caption = options.caption;
        }
        if (options.filename && options.mediaType === 'document') {
          payload[options.mediaType].filename = options.filename;
        }
      } else {
        throw new BadRequestException('mediaId ou mediaUrl deve ser fornecido');
      }

      const response = await axios.post<SendMessageResponse>(
        `${this.baseUrl}/${this.apiVersion}/${options.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${options.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Mídia ${options.mediaType} enviada para ${cleanPhone}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Erro ao enviar mídia: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao enviar mídia: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Baixa mídia do WhatsApp Cloud API
   */
  async downloadMedia(mediaId: string, token: string): Promise<Buffer> {
    try {
      // Primeiro, obter URL da mídia
      const urlResponse = await axios.get<{ url: string; mime_type: string; sha256: string; file_size: number }>(
        `${this.baseUrl}/${this.apiVersion}/${mediaId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      // Depois, baixar a mídia
      const mediaResponse = await axios.get(urlResponse.data.url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        responseType: 'arraybuffer',
      });

      return Buffer.from(mediaResponse.data);
    } catch (error: any) {
      this.logger.error(`Erro ao baixar mídia: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao baixar mídia: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Valida credenciais do WhatsApp Cloud API
   */
  async validateCredentials(token: string, phoneNumberId: string): Promise<boolean> {
    try {
      await axios.get(
        `${this.baseUrl}/${this.apiVersion}/${phoneNumberId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      return true;
    } catch (error: any) {
      this.logger.error(`Erro ao validar credenciais: ${error.response?.data || error.message}`);
      return false;
    }
  }

  /**
   * Verifica assinatura do webhook (X-Hub-Signature-256)
   */
  verifyWebhookSignature(payload: string, signature: string, appSecret: string): boolean {
    try {
      const hash = crypto
        .createHmac('sha256', appSecret)
        .update(payload)
        .digest('hex');
      
      const expectedSignature = `sha256=${hash}`;
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      this.logger.error(`Erro ao verificar assinatura: ${error.message}`);
      return false;
    }
  }

  /**
   * Limpa número de telefone (remove caracteres não numéricos)
   */
  private cleanPhoneNumber(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  /**
   * Retorna MIME type baseado no tipo de mídia
   */
  private getMediaMimeType(mediaType: string): string {
    const mimeTypes: Record<string, string> = {
      image: 'image/jpeg',
      video: 'video/mp4',
      audio: 'audio/ogg',
      document: 'application/pdf',
    };
    return mimeTypes[mediaType] || 'application/octet-stream';
  }

  /**
   * Envia mensagem interativa com botões
   */
  async sendInteractiveButtons(options: {
    phoneNumberId: string;
    token: string;
    to: string;
    body: string;
    footer?: string;
    buttons: Array<{ id: string; title: string }>;
  }): Promise<SendMessageResponse> {
    try {
      const cleanPhone = this.cleanPhoneNumber(options.to);

      if (options.buttons.length < 1 || options.buttons.length > 3) {
        throw new BadRequestException('Deve ter entre 1 e 3 botões');
      }

      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: options.body,
          },
          action: {
            buttons: options.buttons.map((btn) => ({
              type: 'reply',
              reply: {
                id: btn.id,
                title: btn.title.length > 20 ? btn.title.substring(0, 20) : btn.title,
              },
            })),
          },
        },
      };

      if (options.footer) {
        payload.interactive.footer = {
          text: options.footer.length > 60 ? options.footer.substring(0, 60) : options.footer,
        };
      }

      const response = await axios.post<SendMessageResponse>(
        `${this.baseUrl}/${this.apiVersion}/${options.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${options.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Mensagem interativa com botões enviada para ${cleanPhone}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Erro ao enviar mensagem interativa: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao enviar mensagem interativa: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Envia mensagem interativa com lista
   */
  async sendInteractiveList(options: {
    phoneNumberId: string;
    token: string;
    to: string;
    body: string;
    footer?: string;
    buttonText: string;
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  }): Promise<SendMessageResponse> {
    try {
      const cleanPhone = this.cleanPhoneNumber(options.to);

      if (options.sections.length === 0 || options.sections.length > 10) {
        throw new BadRequestException('Deve ter entre 1 e 10 seções');
      }

      const totalRows = options.sections.reduce((sum, section) => sum + section.rows.length, 0);
      if (totalRows === 0 || totalRows > 10) {
        throw new BadRequestException('Deve ter entre 1 e 10 itens no total');
      }

      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: options.body,
          },
          action: {
            button: options.buttonText.length > 20 ? options.buttonText.substring(0, 20) : options.buttonText,
            sections: options.sections.map((section) => ({
              title: section.title.length > 24 ? section.title.substring(0, 24) : section.title,
              rows: section.rows.map((row) => ({
                id: row.id,
                title: row.title.length > 24 ? row.title.substring(0, 24) : row.title,
                description: row.description
                  ? (row.description.length > 72 ? row.description.substring(0, 72) : row.description)
                  : undefined,
              })),
            })),
          },
        },
      };

      if (options.footer) {
        payload.interactive.footer = {
          text: options.footer.length > 60 ? options.footer.substring(0, 60) : options.footer,
        };
      }

      const response = await axios.post<SendMessageResponse>(
        `${this.baseUrl}/${this.apiVersion}/${options.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${options.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Mensagem interativa com lista enviada para ${cleanPhone}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Erro ao enviar mensagem interativa: ${error.response?.data || error.message}`);
      throw new BadRequestException(
        `Erro ao enviar mensagem interativa: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }
}

