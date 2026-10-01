# Revisão do AddOn NinjaTrader (`ninjatrader/TraderOSSync.cs`) — 01/10/2026

**Status:** integração **pausada** (`NT8_ENABLED = false`) e **continua pausada**. Esta é só uma revisão; **nenhum arquivo `.cs` ou rota foi alterado**
(não há como compilar/testar C# aqui, e o AddOn já está instalado em máquinas de testers).

## Resposta curta à pergunta "o AddOn descarta `entryTime`?"
**O AddOn não descarta — ele ENVIA `entryTime`. Quem descarta é a rota** (`/api/sync/ninjatrader/route.ts` valida `entryTime`, mas só usa `exitTime`
para `Trade.date`; não há coluna de entrada no banco). O problema real é **mais grave**: os horários chegam **sem fuso**.

## Achados
| # | Achado | Impacto | Correção sugerida (não aplicada) |
|---|---|---|---|
| 1 | `entryTime`/`exitTime` são `DateTime.ToString("o")` de `ex.Time` (hora **local do PC**, `Kind` não especificado) ⇒ **sem offset** | a rota faz `new Date(exitTime)` ⇒ interpreta como **UTC** ⇒ horário deslocado pelo fuso do PC (ex.: BRT −3 h) e `detectSession` (ET) errado | enviar **UTC** (`ex.Time.ToUniversalTime()`) **e** o offset/IANA do PC; no servidor, usar `parseLocalDateTime` com `explicitOffset` |
| 2 | `entryTime` é enviado mas **a rota não o guarda** | sem hora de entrada: duração, horário de entrada, análise por hora impossíveis | guardar em `entryAt` (coluna nova — **Incremento 2**) |
| 3 | `pv = MasterInstrument != null ? PointValue : 20.0` | instrumento sem master ⇒ trata como NQ (**mesmo defeito do `pointValueFor`**) | enviar `pointValue = null`/omitir; o servidor usa o catálogo (`null` se desconhecido) |
| 4 | `pnl = pts × pv × qty − Commission` ⇒ **líquido só de comissão** (o que o NT8 inclui em `ex.Commission` depende do template de comissão do usuário) | semântica misturada com o CSV (bruto/desconhecido) | enviar `grossPnl` (por preços) **e** `commission` **separados**; deixar `fees` explícito (ou `null`); declarar `pnlBasis` |
| 5 | `pnlPoints = pts` por contrato (4 casas) | diverge do CSV (`Δ × quantidade`) | contrato canônico: por contrato com sinal |
| 6 | `externalId = "NT_" + ExecutionId` **do fill de fechamento** | ok para dedupe, mas **perde os fills de entrada** | enviar a lista de fills (legs) ou 1 evento por fill (Order≠Fill≠Trade) |
| 7 | flip (inversão): o resto abre posição com `Commission = 0` | comissão do fill do flip não é repartida | repartir proporcionalmente (como `aggregateExecutions`) |
| 8 | `qty = ExitQty` (total fechado) | igual à convenção canônica ✔ | manter |
| 9 | MAE/MFE **não** são enviados | `mfe/mae` nulos para trades de sync | NT8 não os expõe em `OnExecution`; vêm do export Trade Performance (CSV) |

## Plano
1. **Agora:** nada muda no AddOn. O caminho confiável é **CSV → parser → CanonicalTrade** (Incrementos 0–1, feitos).
2. **Quando retomarmos o AddOn** (após Incremento 2): payload v2 com `entryTimeUtc`/`exitTimeUtc` (+ offset), `commission` e `fees` separados, `pnlBasis`, sem `pointValue` de fallback, fills individuais — e a rota passando pelo **mesmo pipeline** (`ImportJob` + `normalizeRecord`), com o contrato de `data-contract.md`.
3. Até lá, `NT8_ENABLED` permanece `false`.
