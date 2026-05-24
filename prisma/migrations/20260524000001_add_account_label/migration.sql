-- AlterTable: add accountLabel to trades
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "accountLabel" TEXT NOT NULL DEFAULT 'PA';
