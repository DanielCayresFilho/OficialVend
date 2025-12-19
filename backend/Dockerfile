# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
COPY tsconfig*.json ./

# Instalar dependências
RUN npm ci

# Copiar código fonte
COPY prisma ./prisma/
COPY src ./src/

# Gerar Prisma Client
RUN npx prisma generate

# Build da aplicação NestJS
RUN npm run build

# Compilar seed separadamente
RUN npx tsc prisma/seed.ts --outDir dist/prisma --esModuleInterop --skipLibCheck --module commonjs --target ES2021

# Debug: mostrar estrutura do dist
RUN ls -la dist/

# Verificar se o build foi criado
RUN test -f dist/main.js

# Production stage
FROM node:20-alpine

# Instalar wget para healthcheck
RUN apk add --no-cache wget

WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar apenas dependências de produção
RUN npm ci --only=production

# Copiar Prisma schema e migrations (necessário para migrate deploy)
COPY prisma ./prisma/

# Copiar build da aplicação do stage anterior
COPY --from=builder /app/dist ./dist

# Copiar Prisma Client gerado do builder (contém código gerado)
# O @prisma/client já será instalado via npm ci --only=production acima
# Mas precisamos copiar os arquivos gerados (.prisma)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Verificar novamente se os arquivos estão corretos
RUN ls -la dist/ && test -f dist/main.js

# Copiar script de entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

# Criar diretório para uploads
RUN mkdir -p /app/uploads

# Usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Dar permissão de execução ao entrypoint
RUN chmod +x /app/docker-entrypoint.sh

# Garantir que o usuário nodejs tenha permissão em todos os arquivos
RUN chown -R nodejs:nodejs /app

# Usar usuário nodejs (prisma migrate deploy funcionará com este usuário)
USER nodejs

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Usar entrypoint para executar migrações antes de iniciar
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/main"]
