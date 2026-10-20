-- CreateTable
CREATE TABLE "ai_user_salts" (
    "user_id" TEXT NOT NULL,
    "salt_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "salt_check" TEXT NOT NULL,
    "ciphertext" BYTEA,
    "nonce" BYTEA,
    "key_version" INTEGER,
    "created_at" TEXT NOT NULL,
    "retired_at" TEXT,

    CONSTRAINT "ai_user_salts_pkey" PRIMARY KEY ("user_id","salt_id")
);

-- CreateTable
CREATE TABLE "ai_import_sources" (
    "user_id" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "file_name" TEXT,
    "file_bytes" INTEGER NOT NULL,
    "has_bom" BOOLEAN NOT NULL,
    "line_ending" TEXT NOT NULL,
    "hash_basis" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "ai_import_sources_pkey" PRIMARY KEY ("user_id","file_sha256")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "epoch" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("user_id","conversation_id")
);

-- CreateTable
CREATE TABLE "ai_conversation_deltas" (
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "ai_conversation_deltas_pkey" PRIMARY KEY ("user_id","conversation_id","version")
);

-- AddForeignKey
ALTER TABLE "ai_conversation_deltas" ADD CONSTRAINT "ai_conversation_deltas_user_id_conversation_id_fkey" FOREIGN KEY ("user_id", "conversation_id") REFERENCES "ai_conversations"("user_id", "conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

