# E7-16 emenda — o modelo conhece o período dos dados (21/10/2026)

Só documento. Achado na medição ao vivo (T5): "primeira quinzena de março" virou março de **2025** (os dados são de 2026-03); o motor devolveu tudo "indisponível". O modelo não sabe o período importado e chuta o ano.

## Fato medido
- O período só existe depois de carregar o dataset (`makeContext`, já memoizado por turno): `calculateMetrics(trades, {filters:{}})` → `period.fromLocalDate/toLocalDate`.

## Decisões (D-P*)
- **D-P1:** `TurnSession.dataPeriod()` ⇒ `{from,to}` (AAAA-MM-DD) ou `null`. Reaproveita o contexto memoizado (a 1ª ferramenta do turno usaria o mesmo). NÃO cria evidência, NÃO conta chamada, NÃO muda estado/ledger. Qualquer falha ⇒ `null` (o turno segue; se o arquivo sumiu, a ferramenta falha como hoje).
- **D-P2:** `systemPromptFor(period)` (em `agent/system-prompt.ts`) = `SYSTEM_PROMPT` + 1 parágrafo fixo: "PERÍODO DOS DADOS IMPORTADOS: <from> a <to>. Se o usuário citar datas sem o ano (por exemplo "em março"), use o ano dos dados; datas relativas valem em relação ao fim desse período." Só aceita datas no formato `^\d{4}-\d{2}-\d{2}$` (qualquer outra coisa ⇒ sem parágrafo, nunca texto livre no prompt).
- **D-P3:** o laço usa `systemPromptFor(await session.dataPeriod())` como mensagem de sistema. Sem período ⇒ exatamente `SYSTEM_PROMPT`.
- **Custo:** ~60 tokens por chamada (medir ao vivo); 1 carga do dataset adiantada (turno fora de escopo paga a carga sem usar; aceito).

## Testes (antes do código)
- P1 o pedido ao modelo leva `SYSTEM_PROMPT` + o período real do dataset (24 trades em 2026-03-01…2026-03-24).
- P2 `systemPromptFor`: formato válido ⇒ parágrafo; `null`, datas inválidas, com quebra de linha/injeção, `from > to` ⇒ exatamente `SYSTEM_PROMPT`; determinístico; parágrafo ≤ 400 caracteres.
- P3 período indisponível (arquivo ausente) ⇒ mensagem de sistema = `SYSTEM_PROMPT`; o turno ainda chama o modelo.
- P4 `dataPeriod()` não altera ledger, `state().calls` nem mensagens; 2 chamadas seguidas iguais; `null` com turno cujo arquivo falha.
- P5 o parágrafo não contém o hash do arquivo, o nome do arquivo nem o sal (varredura).
- Mutações: parágrafo sem checagem de formato; período trocado (to/from); `dataPeriod` que conta chamada; falha que derruba o turno.

## Medição ao vivo (depois)
Repetir as 6 perguntas (≈ 9K tokens): T5 deve usar 2026.
