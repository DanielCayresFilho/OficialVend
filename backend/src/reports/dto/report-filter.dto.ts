import { IsOptional, IsDateString, IsNumber } from 'class-validator';
import { Transform } from 'class-transformer';

export class ReportFilterDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  })
  @IsOptional()
  @IsNumber()
  segment?: number;
}

