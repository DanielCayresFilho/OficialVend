#!/bin/bash

# Script para inicializar o banco de dados com Prisma 7
# Executa migrations e seed

set -e  # Para se houver erro

echo "🚀 Iniciando configuração do banco de dados..."
echo ""

# 1. Gerar Prisma Client
echo "📦 Gerando Prisma Client..."
npx prisma generate
echo "✅ Prisma Client gerado!"
echo ""

# 2. Aplicar migrations
echo "🔄 Aplicando migrations..."
npx prisma migrate deploy
echo "✅ Migrations aplicadas!"
echo ""

# 3. Executar seed
echo "🌱 Executando seed..."
npx tsx prisma/seed.ts
echo "✅ Seed concluído!"
echo ""

echo "🎉 Banco de dados configurado com sucesso!"
echo ""
echo "📋 Credenciais criadas:"
echo "   Admin:      admin@vend.com"
echo "   Supervisor: supervisor@vend.com"
echo "   Operator:   operator@vend.com"
echo ""
echo "💡 Para ver os dados, use: npx prisma studio"
