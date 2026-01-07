import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return null;
      }

      // Verificar se a senha está no formato correto (hash do argon2)
      // Se não for um hash válido, pode ser que a senha esteja em texto plano (desenvolvimento)
      let isPasswordValid = false;
      try {
        isPasswordValid = await argon2.verify(user.password, password);
      } catch (error) {
        // Se der erro na verificação, pode ser que a senha não seja um hash válido
        // Em desenvolvimento, pode estar em texto plano
        if (process.env.NODE_ENV === 'development' && user.password === password) {
          isPasswordValid = true;
        } else {
          this.logger?.error?.('Erro ao verificar senha:', error);
          return null;
        }
      }

      if (!isPasswordValid) {
        return null;
      }

      const { password: _, ...result } = user;
      return result;
    } catch (error) {
      console.error('Erro no validateUser:', error);
      throw error;
    }
  }

  async login(user: any) {
    // Se o usuário for operator, atualizar status para Online
    if (user.role === 'operator') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'Online' },
      });
    }

    const payload = { email: user.email, sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        segment: user.segment,
        line: user.line,
        status: user.role === 'operator' ? 'Online' : user.status,
        oneToOneActive: user.oneToOneActive,
      },
    };
  }

  async logout(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    // Se o usuário for operator, atualizar status para Offline
    if (user && user.role === 'operator') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: 'Offline' },
      });
    }

    return { message: 'Logout realizado com sucesso' };
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
