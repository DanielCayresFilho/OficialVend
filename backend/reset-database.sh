#!/bin/bash

# Script para resetar o banco de dados (CUIDADO: apaga todos os dados!)
# Útil para desenvolvimento

set -e  # Para se houver erro

echo "⚠️  ATENÇÃO: Este script vai APAGAR TODOS OS DADOS do banco!"
echo ""
read -p "Tem certeza que deseja continuar? (digite 'sim' para confirmar): " confirmacao

if [ "$confirmacao" != "sim" ]; then
    echo "❌ Operação cancelada."
    exit 0
fi

echo ""
echo "🔄 Resetando banco de dados..."
echo ""

# 1. Reset do banco
echo "🗑️  Removendo dados antigos..."
npx prisma migrate reset --force
echo "✅ Banco resetado!"
echo ""

echo "🎉 Banco de dados resetado e reconfigurado com sucesso!"
echo ""
echo "📋 Credenciais criadas:"
echo "   Admin:      admin@vend.com"
echo "   Supervisor: supervisor@vend.com"
echo "   Operator:   operator@vend.com"
