import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateTabulationDto } from './dto/create-tabulation.dto';
import { UpdateTabulationDto } from './dto/update-tabulation.dto';
import { Readable } from 'stream';
import csv from 'csv-parser';

@Injectable()
export class TabulationsService {
  constructor(private prisma: PrismaService) {}

  async create(createTabulationDto: CreateTabulationDto) {
    return this.prisma.tabulation.create({
      data: createTabulationDto,
    });
  }

  async findAll(search?: string) {
    return this.prisma.tabulation.findMany({
      where: search ? {
        name: {
          contains: search,
          mode: 'insensitive',
        },
      } : undefined,
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(id: number) {
    const tabulation = await this.prisma.tabulation.findUnique({
      where: { id },
    });

    if (!tabulation) {
      throw new NotFoundException(`Tabulação com ID ${id} não encontrada`);
    }

    return tabulation;
  }

  async update(id: number, updateTabulationDto: UpdateTabulationDto) {
    await this.findOne(id);

    return this.prisma.tabulation.update({
      where: { id },
      data: updateTabulationDto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.tabulation.delete({
      where: { id },
    });
  }

  async importFromCSV(file: Express.Multer.File): Promise<{ success: number; errors: string[] }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('Arquivo CSV não fornecido');
    }

    const results: any[] = [];
    const errors: string[] = [];
    let successCount = 0;
    const processedNames = new Set<string>();

    return new Promise((resolve, reject) => {
      const stream = Readable.from(file.buffer.toString('utf-8'));
      
      stream
        .pipe(csv({ separator: ';' }))
        .on('data', (data) => {
          // Filtrar linhas vazias manualmente
          const hasData = Object.values(data).some(value => value && String(value).trim() !== '');
          if (hasData) {
            results.push(data);
          }
        })
        .on('end', async () => {
          console.log(`📊 Processando ${results.length} linhas do CSV de tabulações`);

          for (const row of results) {
            try {
              // Tentar diferentes nomes de coluna
              const name = row['Nome']?.trim() || row['Name']?.trim() || row['Tabulação']?.trim() || row['Tabulation']?.trim();
              const isCPCStr = row['CPC']?.trim() || row['isCPC']?.trim() || row['Is CPC']?.trim();
              
              // Converter isCPC para boolean
              const isCPC = isCPCStr 
                ? (isCPCStr.toLowerCase() === 'true' || isCPCStr.toLowerCase() === 'sim' || isCPCStr.toLowerCase() === 'yes' || isCPCStr === '1')
                : false;

              if (!name) {
                errors.push(`Linha ignorada: Nome vazio`);
                continue;
              }

              // Normalizar nome (lowercase para comparação)
              const normalizedName = name.toLowerCase();

              // Verificar se já processamos este nome nesta importação
              if (processedNames.has(normalizedName)) {
                continue; // Pular duplicatas no mesmo CSV
              }

              processedNames.add(normalizedName);

              // Verificar se tabulação já existe
              const existing = await this.prisma.tabulation.findFirst({
                where: {
                  name: {
                    equals: name,
                    mode: 'insensitive',
                  },
                },
              });

              if (existing) {
                errors.push(`Tabulação já existe: ${name}`);
                continue;
              }

              // Criar tabulação
              await this.prisma.tabulation.create({
                data: { name, isCPC },
              });

              successCount++;
              console.log(`✅ Tabulação criada: ${name} (CPC: ${isCPC})`);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
              errors.push(`Erro ao processar linha: ${errorMsg}`);
              console.error('❌ Erro ao processar linha do CSV:', error);
            }
          }

          resolve({ success: successCount, errors });
        })
        .on('error', (error) => {
          reject(new BadRequestException(`Erro ao processar CSV: ${error.message}`));
        });
    });
  }
}
