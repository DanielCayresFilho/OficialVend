import { IsBoolean, IsEmail, IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { Role, Status } from '@prisma/client';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @Transform(({ value }) => {
    if (!value || value === '' || value === null) return undefined;
    return value;
  })
  @IsString()
  @MinLength(6, { message: 'Senha deve ter no mínimo 6 caracteres' })
  @IsOptional()
  password?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @Transform(({ value }) => {
    console.log('🔄 Transformando segment:', value, 'tipo:', typeof value);
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    const result = isNaN(num) ? null : num;
    console.log('✅ Segment transformado para:', result);
    return result;
  })
  @IsNumber()
  @IsOptional()
  segment?: number | null;

  @Transform(({ value }) => {
    console.log('🔄 Transformando line:', value, 'tipo:', typeof value);
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    const result = isNaN(num) ? null : num;
    console.log('✅ Line transformado para:', result);
    return result;
  })
  @IsNumber()
  @IsOptional()
  line?: number | null;

  @IsEnum(Status)
  @IsOptional()
  status?: Status;

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return false;
    return Boolean(value);
  })
  @IsBoolean()
  @IsOptional()
  oneToOneActive?: boolean; // Se true, operador pode chamar clientes no 1x1
}
