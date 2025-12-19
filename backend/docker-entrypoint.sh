#!/bin/sh
set -e

# Executar migrações do Prisma se DATABASE_URL estiver definida
if [ -n "$DATABASE_URL" ]; then
  echo "🔄 Executando migrações do Prisma..."
  echo "📋 DATABASE_URL está definida"
  if npx prisma migrate deploy; then
    echo "✅ Migrações concluídas"
  else
    echo "❌ Erro ao executar migrações, mas continuando..."
    # Não fazer exit aqui para permitir que a aplicação inicie mesmo se migrações falharem
  fi
else
  echo "⚠️  DATABASE_URL não definida, pulando migrações"
  echo "ℹ️  Variáveis de ambiente disponíveis:"
  env | grep -i database || echo "   Nenhuma variável DATABASE encontrada"
  echo "ℹ️  Continuando sem executar migrações..."
fi

# Executar comando passado como argumento (geralmente "node dist/main")
exec "$@"

