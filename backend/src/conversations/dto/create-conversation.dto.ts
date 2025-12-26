import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Sender } from '@prisma/client';

export class CreateConversationDto {
  @IsString()
  @IsNotEmpty()
  contactName: string;

  @IsString()
  @IsNotEmpty()
  contactPhone: string;

  @IsNumber()
  @IsOptional()
  segment?: number;

  @IsString()
  @IsOptional()
  userName?: string;

  @IsNumber()
  @IsOptional()
  userLine?: number;

  @IsNumber()
  @IsOptional()
  userId?: number; // ID do operador específico que está atendendo

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsEnum(Sender)
  @IsNotEmpty()
  sender: Sender;

  @IsNumber()
  @IsOptional()
  tabulation?: number;

  @IsString()
  @IsOptional()
  messageType?: string;

  @IsString()
  @IsOptional()
  mediaUrl?: string;

  @IsString()
  @IsOptional()
  messageId?: string; // WhatsApp Message ID (wamid) - usado para evitar duplicatas
}
