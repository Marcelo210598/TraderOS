# BUG a corrigir amanhã — P&L negativo vira $0,00 no import CSV NinjaTrader PT-BR

**Achado em:** 22/09/2026 (noite), testando import de um CSV real do NT8 com trades de
avaliação da LucidFlex 50K (2 vitórias + 1 trade com 2 fills de stop). Diagnosticado, **NÃO
corrigido ainda** — Marcelo pediu pra deixar anotado e resolver amanhã.

## Sintoma
No preview de "Importar Trades" (NinjaTrader PT-BR), trades **vencedores** importam o P&L
certo (+$235,50, +$104,50, +$71,50), mas os dois fills do trade que **saiu no stop**
aparecem como **P&L $0,00** em vez de -$117,00 e -$58,50. Se importado assim, o resultado
do dia fica artificialmente mais positivo do que o real (some o prejuízo inteiro).

## Causa raiz (confirmada lendo o código, não só suposição)
Arquivo: `src/components/journal/importar-client.tsx`

`parseNinjaTraderGridPtBr` (linha ~250) lê o P&L com:
```ts
const pnl = parseBRNumber(get("profit") || "0")
```
e `parseBRNumber` (linha ~99):
```ts
function parseBRNumber(raw: string): number {
  const cleaned = raw.replace(/[$R]/g, "").trim().replace(/\./g, "").replace(",", ".")
  return parseFloat(cleaned)
}
```

O export do NT8 formata valor negativo como **`-$ 117,00`** (hífen colado, espaço depois do
`$`, antes do número). `parseBRNumber` remove só o caractere `$`/`R`, sem remover o espaço
que sobra entre o `-` e o número:

```
"-$ 117,00"  → remove $/R →  "- 117,00"  (espaço entre "-" e "117" continua lá)
                → .trim() não mexe (não é espaço nas pontas, é no meio)
                → troca "," por "." →  "- 117.00"
```

`parseFloat("- 117.00")` retorna **NaN** — o padrão `StrDecimalLiteral` do JS exige que o
sinal venha **colado** no dígito, sem espaço no meio. Como o código final faz
`isNaN(pnl) ? 0 : pnl`, o NaN vira silenciosamente **0**.

Valores positivos (`"$ 235,50"`, sem sinal de menos) não têm esse espaço "solto" atrapalhando
o sinal, por isso passam batido e só os **negativos** quebram.

## Fix proposto (não aplicado ainda)
Remover **todo espaço em branco**, não só o símbolo de moeda, antes de trocar a vírgula
decimal — e fazer isso ANTES de qualquer outra limpeza, pra não sobrar espaço entre sinal e
dígito em nenhum formato:

```ts
function parseBRNumber(raw: string): number {
  const cleaned = raw
    .replace(/[$R]/g, "")
    .replace(/\s+/g, "")      // <- remove TODO espaço (inclusive entre "-" e o número)
    .replace(/\./g, "")
    .replace(",", ".")
  return parseFloat(cleaned)
}
```

Testar com pelo menos estes casos antes de considerar corrigido:
- `"-$ 117,00"` → `-117`
- `"$ 235,50"` → `235.5`
- `"-$ 1.234,56"` → `-1234.56`
- `"$ 0,00"` → `0`

## Onde isso também pode estar quebrado (checar quando for corrigir)
- `parseNinjaTrader` (EN) e o parser `tradovate` (mesmo arquivo) usam `parseFloat` direto
  em vez de `parseBRNumber` — confirmar se o formato de export deles também usa `$ -123.45`
  com espaço (padrão US normalmente não separa sinal do número, mas vale conferir com um
  CSV real antes de assumir que só o PT-BR tem o problema).
- MAE/MFE em dólar (`maeDollar`, `mfeDollar`, linhas ~278-279) usam o mesmo `parseBRNumber`
  — se algum desses vier negativo no export, tem o mesmo bug.

## Plano pra amanhã
1. Aplicar o fix no `parseBRNumber`.
2. Rodar os 4 casos de teste acima (unit test se o projeto já tiver suite pra isso, senão
   teste manual rápido no console).
3. Reimportar o CSV real de 22/09 (`NinjaTrader Grid 2026-09-22 10-50.csv`, já enviado no
   WhatsApp) e conferir que os 2 fills do stop aparecem como -$117,00 e -$58,50, não $0,00.
4. Confirmar se `parseNinjaTrader` (EN) e `tradovate` têm o mesmo problema (item acima).
5. Rodar `tsc`/lint antes de considerar fechado.
6. Só depois disso o Marcelo vai importar o CSV de verdade na conta EVAL.
