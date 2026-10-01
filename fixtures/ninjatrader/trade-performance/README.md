# fixtures/ninjatrader/trade-performance

Exports **reais** do NT8 (grade Trade Performance) + `<nome>.context.json` e `<nome>.expected.json`. Tudo isto é **local e ignorado pelo git**
(repositório público); só este README e o `.gitkeep` são versionados. Regras gerais em `fixtures/README.md`.

| Fixture | Idioma | Linhas → ciclos | `sourceTz` |
|---|---|---|---|
| `nt8-grid-ptbr-2026-09-21` | PT-BR | 7 → 2 | informado (assumido, não confirmado) |
| `nt8-grid-ptbr-2026-10-01` | PT-BR | 27 → 15 | ausente ⇒ `DEFAULT` + `W_SOURCE_TZ_DEFAULTED` |

- **NT8 em inglês: NÃO VALIDADO** — não existe export real; o parser `ninjatrader-en` é assumido e **não reconstrói ciclos**. Não alterar sem fixture real.
- O `.expected.json` descreve **ciclos** (não linhas), conferidos por um oráculo independente (`scripts/oracle-nt8-cycles.py`).
- Testes: `scripts/test-ingest-fixtures-real.mts` (varre todos) e `scripts/test-real-nt8-metrics.mts` (cruza métricas com o próprio CSV, para todos os fixtures).
