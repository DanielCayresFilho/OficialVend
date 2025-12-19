#!/bin/sh
set -e

# Executar migrações do Prisma se DATABASE_URL estiver definida
if [ -n "$DATABASE_URL" ]; then
  echo "🔄 Executando migrações do Prisma..."
  npx prisma migrate deploy
  echo "✅ Migrações concluídas"
else
  echo "⚠️  DATABASE_URL não definida, pulando migrações"
fi

# Executar comando passado como argumento (geralmente "node dist/main")
exec "$@"

