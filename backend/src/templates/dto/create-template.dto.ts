import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';

export class TemplateButtonDto {
  @IsString()
  @IsNotEmpty()
  type: string; // QUICK_REPLY, URL, PHONE_NUMBER

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;
}

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  })
  @IsNumber()
  @IsOptional()
  segmentId?: number;  // null = global (todos os segmentos)

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  })
  @IsNumber()
  @IsOptional()
  lineId?: number;  // Mantido para compatibilidade

  @IsString()
  @IsOptional()
  namespace?: string;

  @IsString()
  @IsOptional()
  headerType?: string; // TEXT, IMAGE, VIDEO, DOCUMENT

  @IsString()
  @IsOptional()
  headerContent?: string;

  @IsString()
  @IsNotEmpty()
  bodyText: string;

  @IsString()
  @IsOptional()
  footerText?: string;

  @IsArray()
  @IsOptional()
  buttons?: TemplateButtonDto[];

  @IsArray()
  @IsOptional()
  variables?: string[];
}

