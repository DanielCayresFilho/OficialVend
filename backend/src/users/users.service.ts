import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as argon2 from 'argon2';
import csv from 'csv-parser';
import { Readable } from 'stream';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email já está em uso');
    }

    const hashedPassword = await argon2.hash(createUserDto.password);

    return this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
      },
    });
  }

  async findAll(filters?: any) {
    // Remover campos inválidos que não existem no schema
    const { search, ...validFilters } = filters || {};
    
    // Se houver busca por texto, aplicar filtros
    const where = search 
      ? {
          ...validFilters,
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : validFilters;

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        segment: true,
        line: true,
        status: true,
        oneToOneActive: true,
        createdAt: true,
        updatedAt: true,
        // Não retornar password
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Buscar usuários filtrando por domínio de email
   * Usado por admin e supervisor para ver apenas usuários do mesmo domínio
   */
  async findAllByEmailDomain(filters: any, emailDomain: string) {
    const { search, ...validFilters } = filters || {};

    const baseWhere = {
      email: {
        endsWith: `@${emailDomain}`,
      },
    };

    const where = search
      ? {
          ...validFilters,
          ...baseWhere,
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {
          ...validFilters,
          ...baseWhere,
        };

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        segment: true,
        line: true,
        status: true,
        oneToOneActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`Usuário com ID ${id} não encontrado`);
    }

    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    await this.findOne(id);

    // Limpar campos vazios
    const cleanData: any = { ...updateUserDto };
    
    // Remover password se estiver vazio/undefined
    if (!cleanData.password || cleanData.password === '') {
      delete cleanData.password;
    } else {
      // Hash da senha apenas se foi fornecida
      cleanData.password = await argon2.hash(cleanData.password);
    }

    // Converter strings vazias para null nos campos numéricos opcionais
    if (cleanData.segment === '' || cleanData.segment === undefined) {
      cleanData.segment = null;
    }
    if (cleanData.line === '' || cleanData.line === undefined) {
      cleanData.line = null;
    }

    // Garantir que oneToOneActive seja boolean (não undefined se não foi enviado)
    if (cleanData.oneToOneActive === undefined) {
      // Se não foi enviado, não alterar (manter valor atual)
      delete cleanData.oneToOneActive;
    } else {
      // Garantir que seja boolean
      cleanData.oneToOneActive = Boolean(cleanData.oneToOneActive);
    }

    console.log('💾 Dados limpos para atualizar:', cleanData);

    return this.prisma.user.update({
      where: { id },
      data: cleanData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        segment: true,
        line: true,
        status: true,
        oneToOneActive: true,
        createdAt: true,
        updatedAt: true,
        // Não retornar password
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.user.delete({
      where: { id },
    });
  }

  async getOnlineOperators(segment?: number) {
    return this.prisma.user.findMany({
      where: {
        role: 'operator',
        status: 'Online',
        ...(segment && { segment }),
      },
    });
  }

  /**
   * Buscar operadores online filtrando por domínio de email
   */
  async getOnlineOperatorsByEmailDomain(segment: number | undefined, emailDomain: string) {
    return this.prisma.user.findMany({
      where: {
        role: 'operator',
        status: 'Online',
        email: {
          endsWith: `@${emailDomain}`,
        },
        ...(segment && { segment }),
      },
    });
  }

  async importFromCSV(file: Express.Multer.File): Promise<{ success: number; errors: string[] }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('Arquivo CSV não fornecido');
    }

    const results: any[] = [];
    const errors: string[] = [];
    let successCount = 0;

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
          console.log(`📊 Processando ${results.length} linhas do CSV`);

          for (const row of results) {
            try {
              const name = row['Nome']?.trim();
              const email = row['E-mail']?.trim() || row['Email']?.trim();
              const segmentName = row['Segmento']?.trim();

              if (!name || !email) {
                errors.push(`Linha ignorada: Nome ou E-mail vazio (${name || 'sem nome'}, ${email || 'sem email'})`);
                continue;
              }

              // Verificar se usuário já existe
              const existingUser = await this.prisma.user.findUnique({
                where: { email },
              });

              if (existingUser) {
                errors.push(`Usuário já existe: ${email}`);
                continue;
              }

              // Buscar segmento pelo nome
              let segmentId: number | null = null;
              if (segmentName) {
                const segment = await this.prisma.segment.findFirst({
                  where: {
                    name: {
                      contains: segmentName,
                      mode: 'insensitive',
                    },
                  },
                });

                if (segment) {
                  segmentId = segment.id;
                } else {
                  errors.push(`Segmento não encontrado: ${segmentName} (usuário: ${email})`);
                  // Continuar criando o usuário sem segmento
                }
              }

              // Criar usuário (padrão: operador, senha inicial = #Pasch@20.25)
              const defaultPassword = '@Pasc2025';
              const hashedPassword = await argon2.hash(defaultPassword);

              await this.prisma.user.create({
                data: {
                  name,
                  email,
                  password: hashedPassword,
                  role: 'operator',
                  segment: segmentId,
                },
              });

              successCount++;
              console.log(`✅ Usuário criado: ${name} (${email})`);
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
