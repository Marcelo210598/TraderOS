-- Registra quando o usuario aceitou Termos/Privacidade no cadastro (LGPD, Art. 5 XII)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
