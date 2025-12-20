#!/bin/sh
set -e

# Executar migrações do Prisma se DATABASE_URL estiver definida
if [ -n "$DATABASE_URL" ]; then
  echo "🔄 Executando migrações do Prisma..."
  echo "📋 DATABASE_URL está definida"
  if npx prisma migrate deploy; then
    echo "✅ Migrações concluídas"

    # Executar seed apenas se não houver usuários no banco
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

