-- Guarda o nome bruto da conta na corretora (ex: "APEX-245678-01").
-- Base da deteccao automatica de tipo de conta (TEST/EVAL/PA).
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "accountName" TEXT;
