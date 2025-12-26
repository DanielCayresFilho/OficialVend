#!/bin/sh
set -e

# Regenerar Prisma Client para garantir que está sincronizado com o schema
if [ -n "$DATABASE_URL" ]; then
  echo "🔄 Regenerando Prisma Client..."
  npx prisma generate
fi

# Executar seed apenas se não houver usuários no banco (se DATABASE_URL estiver definida)
if [ -n "$DATABASE_URL" ]; then
  echo "🌱 Verificando se precisa executar seed..."
  USER_COUNT=$(npx prisma db execute --stdin <<EOF
SELECT COUNT(*) as count FROM "User";
EOF
2>/dev/null | tail -n 1 | grep -o '[0-9]\+' || echo "0")

  if [ "$USER_COUNT" = "0" ]; then
    echo "📦 Banco vazio, executando seed..."
    if npx tsx prisma/seed.ts; then
      echo "✅ Seed concluído com sucesso!"
    else
      echo "⚠️  Erro ao executar seed, mas continuando..."
    fi
  else
    echo "ℹ️  Banco já possui dados ($USER_COUNT usuários), pulando seed"
  fi
else
  echo "⚠️  DATABASE_URL não definida, pulando seed"
fi

# Executar comando passado como argumento (geralmente "node dist/main")
exec "$@"

