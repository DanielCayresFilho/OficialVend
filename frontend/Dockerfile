FROM node:20-alpine

WORKDIR /app

# Criar .npmrc para usar legacy-peer-deps
RUN echo "legacy-peer-deps=true" > .npmrc

# Copiar dependências
COPY package*.json ./

# Instalar dependências
RUN npm ci

# Copiar código fonte
COPY . .

# Build da aplicação
RUN npm run build && \
    echo "✅ Build completed" && \
    ls -la dist/

# Instalar serve para servir arquivos estáticos
RUN npm install -g serve

EXPOSE 3015

# Servir aplicação buildada
CMD ["serve", "-s", "dist", "-l", "3015"]