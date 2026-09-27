-- Adiciona coluna de regras de drawdown/mesa (JSONB, validada com Zod na aplicacao)
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "drawdownRules" JSONB;
