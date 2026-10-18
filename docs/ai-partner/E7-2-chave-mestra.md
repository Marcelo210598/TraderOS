# E7-2 — Chave mestra dos sais (`SALT_MASTER_KEY`)

Cifra os sais por usuário em repouso (AES-256-GCM, AAD `userId:saltId`). Implementação: `src/lib/infra/cipher.ts` e `src/lib/infra/salt-store.ts`.

## Variáveis
| Variável | Valor | Obrigatória |
|---|---|---|
| `SALT_MASTER_KEY=` | EXATAMENTE 32 bytes em hex (64 chars) ou base64 (44 chars). Recusadas: vazia, tamanho errado, toda zero. | sim |
| `SALT_MASTER_KEY_VERSION=` | inteiro ≥ 1 (padrão 1): a versão da chave acima | só ao rotacionar |
| `SALT_MASTER_KEY_PREV_<n>=` | chaves anteriores (n < versão atual), só durante a rotação | só ao rotacionar |

Gerar: `openssl rand -hex 32`. **Nunca no Git.** Para a Vercel/Railway, usar o arquivo `KEY=VALUE` + "Import .env".

## ⚠️ Perda da chave
Perder `SALT_MASTER_KEY` (e não ter cópia em cofre) torna **irrecuperáveis** os sais e, com eles, a verificação dos bundles antigos. Guarde uma cópia fora do projeto antes de ligar em produção.

## Rotação
1. Gere a chave nova. Defina `SALT_MASTER_KEY_VERSION=<n+1>`, `SALT_MASTER_KEY=<nova>` e `SALT_MASTER_KEY_PREV_<n>=<antiga>`.
2. Rode `recipherAll()` (recifra todas as linhas para a versão atual; idempotente; se cair no meio, rode de novo — as duas chaves seguem válidas).
3. Só depois de `skipped: []` e `alreadyCurrent` = total, apague `SALT_MASTER_KEY_PREV_<n>`.

## Nota
`.env.example` é ignorado pelo Git neste repositório (`.env*` no `.gitignore`); por isso a documentação oficial das variáveis fica aqui.
