ALTER TABLE "Conversation" ADD COLUMN "messageId" TEXT;
CREATE INDEX "Conversation_messageId_idx" ON "Conversation"("messageId");

