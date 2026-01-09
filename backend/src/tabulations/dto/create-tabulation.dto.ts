import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTabulationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsBoolean()
  @IsOptional()
  isCPC?: boolean;

  @IsBoolean()
  @IsOptional()
  isEnvio?: boolean;

  @IsBoolean()
  @IsOptional()
  isEntregue?: boolean;

  @IsBoolean()
  @IsOptional()
  isLido?: boolean;

  @IsBoolean()
  @IsOptional()
  isRetorno?: boolean;

  @IsBoolean()
  @IsOptional()
  isCPCProd?: boolean;

  @IsBoolean()
  @IsOptional()
  isBoleto?: boolean;
}

