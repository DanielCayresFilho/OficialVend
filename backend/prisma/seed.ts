import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config();

// Prisma 7 requer adapter
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Iniciando seed...');

  // Criar segmento padrão
  const segment = await prisma.segment.upsert({
    where: { name: 'Padrão' },
    update: {},
    create: {
      name: 'Padrão',
    },
  });

  console.log('✅ Segmento criado:', segment.name);

  // Criar usuário admin
  const adminPassword = await argon2.hash('<@P0d3ro50ço#a$S@@');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@vend.com' },
    update: {},
    create: {
      name: 'Admin',
      email: 'admin@vend.com',
      password: adminPassword,
      role: 'admin',
      status: 'Offline',
    },
  });

  console.log('✅ Admin criado:', admin.email);

  // Criar usuário supervisor
  const supervisorPassword = await argon2.hash('..?SuP3RV15o4)(ALt');
  const supervisor = await prisma.user.upsert({
    where: { email: 'supervisor@vend.com' },
    update: {},
    create: {
      name: 'Supervisor',
      email: 'supervisor@vend.com',
      password: supervisorPassword,
      role: 'supervisor',
      segment: segment.id,
      status: 'Offline',
    },
  });

  console.log('✅ Supervisor criado:', supervisor.email);

  // Criar usuário operator
  const operatorPassword = await argon2.hash('ç~^OpeR4t0R=3}}ooo');
  const operator = await prisma.user.upsert({
    where: { email: 'operator@vend.com' },
    update: {},
    create: {
      name: 'Operador',
      email: 'operator@vend.com',
      password: operatorPassword,
      role: 'operator',
      segment: segment.id,
      status: 'Offline',
    },
  });

  console.log('✅ Operator criado:', operator.email, '| senha: operator123');

  // Criar Tags de exemplo
  const tags = await Promise.all([
    prisma.tag.upsert({
      where: { name: 'emp1' },
      update: {},
      create: {
        name: 'emp1',
        description: 'Tag de exemplo para carteira 1',
        segment: segment.id,
      },
    }),
    prisma.tag.upsert({
      where: { name: 'emp2' },
      update: {},
      create: {
        name: 'emp2',
        description: 'Tag de exemplo para carteira 2',
        segment: segment.id,
      },
    }),
  ]);

  console.log('✅ Tags criadas:', tags.length);

  console.log('✅ Seed concluído com sucesso!');
  console.log('\n📋 Dados criados:');
  console.log('👥 Usuários:');
  console.log('   Admin:      admin@vend.com | <@P0d3ro50ço#a$S@@');
  console.log('   Supervisor: supervisor@vend.com | ..?SuP3RV15o4)(ALt');
  console.log('   Operator:   operator@vend.com | ç~^OpeR4t0R=3}}ooo');
  console.log('\n🏷️  Tags:');
  console.log('   emp1, emp2');
  console.log('\n💡 Dica: Use o upload CSV para importar tabulações!');
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
