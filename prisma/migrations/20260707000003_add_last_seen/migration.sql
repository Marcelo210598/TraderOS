-- Ultima atividade do usuario (base de online/ativos no painel de uso).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
