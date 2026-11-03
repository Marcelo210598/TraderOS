# AddOns de diagnóstico (só imprimem — NÃO enviam nada, NÃO alteram nada)
Usados em 03/11/2026 na VM para medir o NT8 antes de escrever o AddOn v10.
- `MeuTradeDiag.cs` — fills (`[D6-FILL]`), posições (`[D6-POS]`), inventário de `Account.Executions` com comissão (`[D6-INV]`).
- `MeuTradeBarsDiag.cs` — extremos de uma janela via `BarsRequest` de ticks (horários fixos de trades do dia: ajustar as constantes antes de usar).
Instalar: colar no editor NinjaScript (Novo → AddOn, mesmo nome da classe) e F5. Não substituem o AddOn de produção.
