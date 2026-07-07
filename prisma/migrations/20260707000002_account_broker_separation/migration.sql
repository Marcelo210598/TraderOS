-- Separa contas pela identidade real (brokerName). Ex: "APEX-245678-01".
ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "brokerName" TEXT;

-- Troca o unique de (userId, source, label) -> (userId, source, brokerName).
-- Contas legadas (brokerName NULL) coexistem: NULLs nao colidem em unique no Postgres.
ALTER TABLE "trading_accounts" DROP CONSTRAINT IF EXISTS "trading_accounts_userId_source_label_key";
DROP INDEX IF EXISTS "trading_accounts_userId_source_label_key";
CREATE UNIQUE INDEX IF NOT EXISTS "trading_accounts_userId_source_brokerName_key" ON "trading_accounts"("userId", "source", "brokerName");
CREATE INDEX IF NOT EXISTS "trading_accounts_userId_source_label_idx" ON "trading_accounts"("userId", "source", "label");
