-- CreateTable
CREATE TABLE "ai_chat_usage" (
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "lease_id" TEXT,
    "lease_until" TEXT,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ai_chat_usage_pkey" PRIMARY KEY ("user_id","month")
);
