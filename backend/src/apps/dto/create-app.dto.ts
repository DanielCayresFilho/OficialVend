import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateAppDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return null;
    return value;
  })
  @IsString()
  @IsOptional()
  appSecret?: string;

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return null;
    return value;
  })
  @IsString()
  @IsOptional()
  webhookVerifyToken?: string;

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return null;
    return value;
  })
  @IsString()
  @IsOptional()
  wabaId?: string;
}

