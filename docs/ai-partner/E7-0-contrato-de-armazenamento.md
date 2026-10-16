# E7-0 — Decisões e contrato de armazenamento (16/10/2026)

> **Só documento.** Nenhum código de persistência, nenhuma migração, nenhuma conta contratada. As decisões D-E7-1 a D-E7-6 foram respondidas pelo Marcelo em 16/10/2026 (com a recomendação do Gemini); o que eu **acrescentei** está marcado **[PROPOSTA MINHA]** e depende de confirmação. Fontes: **[código]**, **[medido]** (Mac 10 núcleos, Node 24.11.1, fixture sintética), **[oficial]** (página do fornecedor, consultada em 16/10/2026), **[doc]**. O que não foi verificado está marcado **NÃO VERIFICADO**. Base: `E7-levantamento.md`.

## 1. Decisões fechadas

| # | Decisão |
|---|---|
| **D-E7-1** | **Guardar o arquivo bruto de cada usuário.** O artefato guardado é o **texto UTF-8 EXATO** que a pipeline recebeu (BOM e quebras de linha preservados), pois `fileSha256` é o SHA-256 desse texto (`hashBasis: UTF8_TEXT`). Sem o arquivo, `source` fica `NOT_RUN` e tudo `NOT_VERIFIED`. |
| **D-E7-2** | **Storage:** interface agnóstica (§2); implementação de memória/disco nos testes; produção em **object storage S3-compatível PRIVADO** (R2, Supabase Storage ou S3: **a escolha do provedor é do Marcelo**). **UploadThing NÃO** para estes arquivos. Acesso só pelo backend (sem URL pública). |
| **D-E7-3** | **Sal:** chaveiro persistido **cifrado** com chave mestra `SALT_MASTER_KEY` (256 bits) em variável de ambiente da plataforma, com **backup do segredo em cofre** (nunca no Git). **Perda da chave = sais e verificações históricas irrecuperáveis** (documentado). |
| **D-E7-4** | **Exclusão em cascata** ao apagar a conta: arquivos, sais, conversas/ledger. Com o sal apagado, nenhum ref antigo é reproduzível. |
| **D-E7-5** | **Não mexer na tabela `trades` legada** (a fundação conta ≈ 34 consumidores dela [doc]). Modelos **novos e dedicados** para a pipeline nova. |
| **D-E7-6** | **Bundles NÃO são persistidos:** o `Ledger` guarda handle + view (≈ 71 KB por entrada); o `bundleOf` **regenera** o bundle (spec + arquivo + época) sob demanda, com cache temporário e/ou execução assíncrona (E7-4). |

## 2. Contrato `RawFileStorage` (esboço; implementado no E7-1)

```ts
interface RawFileStorage {
  /** Idempotente por conteúdo. RECUSA se sha256(bytes) ≠ fileSha256. */
  put(userId: string, fileSha256: string, bytes: Uint8Array): Promise<void>
  /** null se ausente. RECUSA (erro) se o que está guardado não bate com o SHA-256 (corrupção/adulteração). */
  get(userId: string, fileSha256: string): Promise<Uint8Array | null>
  delete(userId: string, fileSha256: string): Promise<void>
  /** Apaga TUDO do usuário; devolve quantos objetos. Idempotente (retomável após falha parcial). */
  deleteAllForUser(userId: string): Promise<number>
}
```

- **A chave NUNCA vem do chamador:** a implementação a monta como `users/{userId}/imports/{fileSha256}.csv`, depois de validar `userId` (formato do id do banco) e `fileSha256` (`/^[0-9a-f]{64}$/`) — fail-closed, sem eco do valor recusado (evita path traversal e vazamento de caminho). [diverge do esboço do parecer, que recebia `key` livre]
- **Integridade verificável em dois pontos:** `put` e `get` recalculam o SHA-256. Fato [medido]: `sha256(bytes UTF-8 do texto) == ImportRecord.fileSha256`, inclusive com BOM.
- **Mesmo texto duas vezes = mesma chave** (deduplicação natural, `put` idempotente).
- **Quem decodifica os bytes do upload?** A pipeline recebe **texto já decodificado** (`describeText(text: string)`); **não existe decodificador de bytes na biblioteca** [código]. A rota de upload define a regra. **[PROPOSTA MINHA]** UTF-8 estrito com BOM preservado; outra codificação ⇒ recusa com mensagem clara (nunca "adivinhar"); o que se guarda é sempre `Buffer.from(texto, "utf8")`.
- **Testes de contrato** (rodam contra QUALQUER implementação): ida e volta (com BOM e CRLF), hash divergente recusado em `put`, objeto corrompido recusado em `get`, isolamento entre usuários, ids inválidos recusados sem eco, `delete`/`deleteAllForUser` idempotentes, nada lança com mensagem que revele caminho.

## 3. Sal cifrado (D-E7-3) — detalhes que o parecer não cobriu **[PROPOSTA MINHA]**

- **AES-256-GCM**, nonce de 96 bits **aleatório e único por cifragem**; **AAD = `userId:saltId`** (impede mover o blob de um usuário/época para outro); autenticação falhou ⇒ erro fechado, nunca devolve sal.
- **`keyVersion` por registro:** sem isso, trocar a `SALT_MASTER_KEY` exigiria recifrar tudo de uma vez e sem como saber qual chave cifrou o quê. Rotação da mestra = recifrar em lote, uma versão por vez.
- O `SaltProvider` persistente implementa a **interface que já existe** (`get/current/known`, `ingest/salt.ts`); o resto do código não muda. Sal **aposentado** continua `RETIRED` (sem valor) conforme a política de sal.
- **Backup da chave mestra:** responsabilidade operacional do Marcelo (cofre/gerenciador de senhas). Perder a chave não é recuperável por desenho.

## 4. Exclusão em cascata (D-E7-4): o banco não apaga o storage

O `onDelete: Cascade` do Prisma apaga **linhas**, **não** objetos no bucket. Por isso a exclusão precisa de um **job explícito, idempotente e retomável**, com ordem: (1) bloquear novos acessos/escritas do usuário; (2) `deleteAllForUser` no storage; (3) apagar os sais; (4) apagar as linhas (conversas, ledger, `ImportSource`). Falha no meio ⇒ estado `DELETING` e nova tentativa (as operações são idempotentes).

**Limitação declarada (NÃO VERIFICADA):** backups e janelas de recuperação do **banco (Neon)** e do **storage** podem reter dados apagados pelo período de retenção de cada plano; "resíduo zero" só vale depois dessa janela. Confirmar nos painéis e refletir na política de privacidade (texto legal fora do código).

## 5. Modelos novos no Prisma — RASCUNHO (não migrar antes da aprovação do E7-1)

| Modelo | Campos principais | Observações |
|---|---|---|
| `ImportSource` | `id`, `userId`, `fileSha256`, `importId`, `fileName`, `fileBytes`, `hasBom`, `lineEnding`, `hashBasis`, `settings Json`, `createdAt`; **`@@unique([userId, fileSha256])`**; `onDelete: Cascade` | metadados; o conteúdo está no storage (chave derivada, não guardada) |
| `UserSalt` | `id`, `userId`, `saltId`, `ciphertext Bytes`, `nonce Bytes`, `keyVersion Int`, `status` (ACTIVE/RETIRED), `createdAt`, `retiredAt?`; `@@unique([userId, saltId])` | RETIRED pode apagar o valor (política de sal) |
| `Conversation` | `id`, `userId`, `epoch`, `createdAt` | `onDelete: Cascade` |
| `LedgerRow` | `conversationId`, `evidenceRef`, `capability`, `handle Json`, `view Json`, `createdAt` | uma linha por entrada (≈ 71 KB no `groups` 50×10), não um JSON gigante por conversa |
| `QuerySpec` | `conversationId`, `evidenceRef`, `capability`, `args Json` | o que o `specOf` devolve; **nunca** `acc_/str_/lbl_/pat_` |
| `AliasState` | `conversationId`, `epoch`, `table Json`, `version Int` | a tabela de alias da conversa, com **`version` para concorrência otimista** |

**Concorrência na conversa [PROPOSTA MINHA]:** gravar ledger, specs e tabela de alias **na mesma transação**, com `version` otimista; conflito (duas abas) ⇒ refazer a leitura e reexecutar ou recusar com erro claro. Quem aloca alias é só `metrics.groups` e `rank.groups`; o servidor guarda a tabela que eles devolvem.

## 6. Pergunta aberta: o trade canônico — derivar ou guardar? (D-E7-7, **a confirmar**)

- **Derivar do arquivo a cada uso:** ≈ 1,7 s a 5.000 trades [medido]; sem armazenamento extra.
- **Guardar comprimido:** o JSON canônico de 5.000 trades tem 18,4 MB e **comprime a 3,4%** (0,62 MB em gzip; 0,41 MB em brotli) [medido]; CSV do mesmo conjunto: 967 KB (75 KB em gzip). É cache derivado, **não** fonte de verdade.
- **[PROPOSTA MINHA]** não guardar no E7-1 (derivar + cache em processo); guardar um cache comprimido **no storage, ao lado do arquivo**, só se a medição no E7-5 mostrar necessidade, com chave `(fileSha256, versão da pipeline)` para invalidar quando as versões de identidade/pipeline mudarem. Os 18 MB **nunca** em coluna do Postgres.

## 7. Custo [oficial: Cloudflare R2, atualizada em 1/out/2026]

R2 Standard: **US$ 0,015/GB-mês**; **10 GB-mês grátis**; operações Classe A US$ 4,50/milhão (1 milhão grátis/mês), Classe B US$ 0,36/milhão (10 milhões grátis/mês); **egress grátis**; `DeleteObject` grátis. Conta de padaria [com os tamanhos medidos]: 1.000 usuários × 5 arquivos de ≈ 1 MB ≈ 5 GB, **dentro da cota grátis**. **NÃO VERIFICADO:** preços de Supabase Storage e S3 (não consultados) e o plano do Neon/Vercel em uso. **Nenhuma conta será criada sem o OK do Marcelo** (custo e credenciais).

## 8. Fatiamento ajustado (cada passo: expectativa antes do código e aprovação)

- **E7-1** `RawFileStorage` + testes de contrato + implementações de memória e disco + modelo `ImportSource` (rascunho do schema; **migração só com aprovação**). Sem provedor real.
- **E7-2** `SaltProvider` persistente (AES-256-GCM, `keyVersion`, AAD) com chave de teste e testes de adulteração/rotação.
- **E7-3** estado da conversa: `Conversation`, `LedgerRow`, `QuerySpec`, `AliasState` + concorrência otimista.
- **E7-4** `bundleOf` por regeneração (+ cache/assíncrono) e o `regenerated` do refresh.
- **E7-5** montador do `ctx` (arquivo → pipeline → capacidade) e orçamento de latência.
- **Depois:** o job de exclusão em cascata (§4), a escolha do provedor e qualquer UI/LLM.

## 9. A confirmar com o Marcelo antes do E7-1

1. **Provedor** do storage (R2/Supabase/S3) e quando criar a conta (custo/credenciais).
2. As adições **[PROPOSTA MINHA]**: `keyVersion` + AAD no sal; regra de decodificação de upload (UTF-8 estrito, outras ⇒ recusa); chave do storage montada pela implementação; concorrência otimista na conversa.
3. **D-E7-7:** derivar o trade canônico (padrão) ou cachear comprimido no storage depois.
4. Retenção de backups (Neon/storage): confirmar nos painéis e refletir na política de privacidade.
