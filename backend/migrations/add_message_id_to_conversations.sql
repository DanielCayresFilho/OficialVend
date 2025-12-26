-- Adicionar coluna messageId à tabela Conversation para armazenar o wamid do WhatsApp
-- Isso permite evitar processar mensagens duplicadas baseado no ID único do WhatsApp

ALTER TABLE "Conversation" 
ADD COLUMN IF NOT EXISTS "messageId" TEXT;

-- Criar índice para melhorar performance na busca por messageId
CREATE INDEX IF NOT EXISTS "Conversation_messageId_idx" ON "Conversation"("messageId");

-- Comentário: O messageId armazena o wamid (WhatsApp Message ID) que é único para cada mensagem
-- Isso permite detectar duplicatas de forma precisa, ao invés de usar apenas timestamp e telefone

