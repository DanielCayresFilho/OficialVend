import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';

@Injectable()
export class ContactsService {
  constructor(
    private prisma: PrismaService,
    private phoneValidationService: PhoneValidationService,
  ) {}

  async create(createContactDto: CreateContactDto) {
    // Normalizar telefone (adicionar 55, remover caracteres especiais)
    const normalizedPhone = this.phoneValidationService.normalizePhone(createContactDto.phone);
    
    // Usar upsert para evitar duplicados - se já existir, atualiza; se não, cria
    return this.prisma.contact.upsert({
      where: { phone: normalizedPhone },
      update: {
        // Atualizar apenas se novos dados forem fornecidos
        name: createContactDto.name,
        ...(createContactDto.cpf && { cpf: createContactDto.cpf }),
        ...(createContactDto.contract && { contract: createContactDto.contract }),
        ...(createContactDto.segment !== undefined && { segment: createContactDto.segment }),
        ...(createContactDto.isCPC !== undefined && { isCPC: createContactDto.isCPC }),
      },
      create: {
        ...createContactDto,
        phone: normalizedPhone,
      },
    });
  }

  async findAll(search?: string, segment?: number) {
    return this.prisma.contact.findMany({
      where: {
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { cpf: { contains: search } },
          ],
        }),
        ...(segment && { segment }),
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      throw new NotFoundException(`Contato com ID ${id} não encontrado`);
    }

    return contact;
  }

  async findByPhone(phone: string) {
    return this.prisma.contact.findFirst({
      where: { phone },
    });
  }

  async update(id: number, updateContactDto: UpdateContactDto) {
    await this.findOne(id);

    return this.prisma.contact.update({
      where: { id },
      data: updateContactDto,
    });
  }

  // Atualizar contato por telefone (útil para atualizar durante atendimento)
  async updateByPhone(phone: string, updateContactDto: UpdateContactDto) {
    const contact = await this.findByPhone(phone);
    
    if (!contact) {
      throw new NotFoundException(`Contato com telefone ${phone} não encontrado`);
    }

    // Se marcando como CPC, atualizar lastCPCAt
    if (updateContactDto.isCPC === true) {
      (updateContactDto as any).lastCPCAt = new Date();
    } else if (updateContactDto.isCPC === false) {
      (updateContactDto as any).lastCPCAt = null;
    }

    return this.prisma.contact.update({
      where: { id: contact.id },
      data: updateContactDto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.contact.delete({
      where: { id },
    });
  }
}
