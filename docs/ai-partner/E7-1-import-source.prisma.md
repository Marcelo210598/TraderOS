# E7-1 — Rascunho do modelo `ImportSource` (NÃO migrado)

> **Rascunho em documento.** `prisma/schema.prisma` **não foi tocado** (o projeto usa `prisma migrate`; editar o schema sem migração gera deriva) e há um teste (S1 do `test-raw-file-storage.mts`) que falha se um `model ImportSource` aparecer no schema antes da aprovação da migração. Decisões em `E7-0-contrato-de-armazenamento.md`.

```prisma
// Metadados de um arquivo importado. O CONTEÚDO está no RawFileStorage (chave users/{userId}/imports/{fileSha256}.csv, montada pela
// implementação; não é guardada aqui). Não substitui nem altera a tabela `trades` legada.
model ImportSource {
  id          String   @id @default(cuid())
  userId      String
  /// SHA-256 do TEXTO UTF-8 (hashBasis UTF8_TEXT), 64 hex minúsculos. É a chave do objeto no storage.
  fileSha256  String
  /// ImportRecord.importId (determinístico: o mesmo arquivo e as mesmas opções dão o mesmo id).
  importId    String
  fileName    String?
  /// Tamanho em bytes do texto UTF-8 (ImportRecord.fileBytes); ≤ MAX_RAW_FILE_BYTES (25 MiB).
  fileBytes   Int
  hasBom      Boolean
  lineEnding  String   // "LF" | "CRLF" | "CR" | "MIXED" | "NONE"
  hashBasis   String   @default("UTF8_TEXT")
  /// Opções da importação que entram no importId (fuso de origem, política de dobra, mapa de motivos…), sem segredo e sem o sal.
  settings    Json
  createdAt   DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, fileSha256])
  @@index([userId, createdAt])
  @@map("import_sources")
}
```

**Notas**
- `@@unique([userId, fileSha256])` faz o mesmo arquivo importado duas vezes virar UM registro (o `put` do storage já é idempotente por conteúdo).
- `onDelete: Cascade` apaga a linha; **o objeto no storage é apagado pelo job de exclusão** (`deleteAllForUser`), não pelo banco (E7-0 §4).
- O `ImportRecord` completo é pequeno (≈ 1 KB, medido); guardar só os campos acima mais `settings` basta: o resto se regera do arquivo.
- Falta definir (E7-3): como o `ImportSource` se liga a `Conversation`/`QuerySpec`, e a relação com o `User` no schema (`importSources ImportSource[]`).
- **Migração só com aprovação** (próximo passo: pedido explícito, com a migração revisada).
