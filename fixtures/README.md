# fixtures/

Arquivos usados para validar os parsers de importação (`src/lib/ingest/`).

```
fixtures/
  tradovate/{orders,fills}/            ← exports REAIS (você fornece)
  ninjatrader/trade-performance/       ← exports REAIS
  rithmic/                             ← exports REAIS
  _synthetic/                          ← NÃO são exports reais (ver abaixo)
```

## Regra de ouro: não inventamos formato de export
- Um parser definitivo só é escrito/ajustado **a partir de um arquivo real** dessa plataforma.
- **Tradovate e Rithmic ainda não têm parser** — esperam os arquivos reais.
- `_synthetic/` contém arquivos **montados à mão** a partir dos cabeçalhos que o importador atual do app já suporta
  (NT8 EN, NT8 PT-BR, template do MeuTrade). Servem para exercitar o código (horários, custos, bases de P&L…),
  **não** provam que o formato real é igual. Quando houver um export real do NT8, ele tem prioridade e os parsers NT8
  devem ser corrigidos por ele.

## Fixtures reais NÃO são versionadas
O repositório é **público**: `.gitignore` ignora `fixtures/**/*.{csv,tsv,txt,xlsx,pdf,json}` (exceto `_synthetic/`). Os arquivos reais, o
`.context.json` e o `.expected.json` ficam **só na sua máquina**; os testes pulam sozinhos quando não existem. Prefira testes que usem
o **próprio arquivo como oráculo** (ex.: coluna de acumulado do NT8) a embutir valores no código.

## Como adicionar um arquivo real
1. Exporte **sem editar** (não abra e salve no Excel — isso muda separadores/formatos/encoding).
2. Anonimize **só** o que identifica (nº de conta/nome). **Não** altere horários, preços, quantidades, comissões ou colunas.
   Troque nº de conta por algo como `ACCOUNT-A` e `ACCOUNT-B` (consistente no arquivo todo).
3. Salve em `fixtures/<plataforma>/<tipo>/<nome>.csv`.
4. Crie ao lado `<nome>.context.json` com o que **só você sabe**:
   ```json
   {
     "sourceTz": "America/Sao_Paulo",
     "dateOrder": "DMY",
     "numberLocale": "BR",
     "excursionUnit": "USD_TOTAL",
     "notes": "NT8 no PC com horário de Brasília; export da aba Trades; contas Sim101 e ACCOUNT-A"
   }
   ```
   - `sourceTz`: fuso do computador/plataforma que gerou o arquivo (o horário do arquivo é desse fuso).
   - `excursionUnit` (NT8): unidade escolhida em *Trade Performance → Display units* (moeda/pontos…). Se não souber, omita.
5. (Opcional, recomendado) `<nome>.expected.json` com 2–5 trades conferidos **à mão** (entrada/saída, preços, P&L) — vira teste de regressão.
6. Rode `npm run test:domain`.

### Tradovate: o que preciso saber ao receber o arquivo
Qual relatório é (Orders ou Fills), o fuso da conta/plataforma, e se a comissão aparece no arquivo. Se alguma informação
for indispensável para o parser, eu peço naquele momento.

> **Fuso padrão registrado:** sem `sourceTz` explícito o import usa `DEFAULT_SOURCE_TIME_ZONE` (hoje `America/Sao_Paulo`, valor de compatibilidade) e emite `W_SOURCE_TZ_DEFAULTED`, com `sourceTzOrigin = DEFAULT`. Informe `sourceTz` no `.context.json` só quando o fuso do Windows for **confirmado** (origem `USER`); **não** infira o fuso pelos horários dos trades.
>
> **Dados reais:** CSV/JSON reais são **locais e ignorados pelo git**; o **original** fica fora de qualquer repositório (ex.: `/Users/Shared/MeuTrade-dados-reais/`, que não está dentro do repo da home). Não usar `.gitignore` como única proteção. O oráculo independente é `python3 scripts/oracle-nt8-cycles.py <csv> --expected <expected.json>`. O NT8 em inglês segue **NÃO VALIDADO** (não há fixture real). O parser NT8 PT-BR agora reconstrói ciclos; o `expected.json` descreve **ciclos**, não linhas.
