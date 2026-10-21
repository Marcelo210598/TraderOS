# E7-15d — Teste AO VIVO na Groq: o que medir e o que decide (21/10/2026)

Só documento + script de medição (`scripts/test-groq-live.mts`, gated por `GROQ_LIVE=1`, fora do `test:domain`). Nenhum deploy; nenhum dado de produção; dataset sintético em memória.

## 1. O que NÃO sabemos (e este passo responde)
1. A Groq aceita o corpo exato do cliente (ferramentas compactas, `tool_choice`, `reasoning_effort:"none"`, `reasoning_format:"hidden"`, `max_tokens`, `temperature`) para o `qwen/qwen3.8-27b`?
2. Os limites VIVOS da conta (cabeçalhos `x-ratelimit-*`): batem com o print (8K tokens/min, 200K/dia, 30 req/min, 1K req/dia)?
3. Há **cache de prompt** neste modelo (`usage.prompt_tokens_details.cached_tokens` na 2ª chamada com o mesmo prefixo)? Se sim, o peso fixo por chamada deixa de contar nos limites.
4. `tool_choice:"none"` com `tools` presentes é aceito? E SEM `tools` (histórico com mensagens `tool`) é aceito? (se aceitar, dá para omitir o esquema na chamada final e economizar ~700 tokens)
5. Qualidade: o modelo devolve JSON válido (`segments`/`claims`) sem fenda de formato? Quantas rejeições do validador por turno e quais códigos? Usa os `metricIds` certos? Recusa pedido operacional?
6. Custo e tempo reais por turno: tokens de entrada/saída, número de chamadas, latência, R$ (estimado: US$0,80/M entrada, US$4,00/M saída, R$5,50/US$).

## 2. Plano (poucas chamadas, orçamento fixo)
- **Sondas cruas (P1–P4):** ~5 requisições curtas lendo cabeçalhos/uso (sem imprimir texto do modelo além do necessário).
- **6 turnos reais** com `runChatTurn` + cliente Groq: (1) resultado líquido e taxa de acerto; (2) melhor conta; (3) saídas por motivo; (4) pedido operacional ("Compre agora?"); (5) comparação de duas quinzenas; (6) trades por hora.
- **Ritmo:** 62 s entre turnos (TPM de 8K); **aborta** em qualquer 429, ou se o total passar de **70.000 tokens** (35% do limite diário), sem retry.
- **Saída:** tabela por turno (resultado, chamadas, tokens entrada/saída, ms, ferramentas, códigos de rejeição, R$) + totais + respostas às perguntas 1–4. NUNCA imprime a chave, cabeçalho de autorização nem corpo bruto.
- Estimativa de gasto de limite: ~35–55K tokens (≈ 20–28% do dia). **Custo em dinheiro: zero** (nível base, sem cartão).

## 3. O que cada resultado decide
- Corpo recusado (400) ⇒ ajustar o cliente (E7-15c) antes de seguir.
- Há cache ⇒ guarda global pode subir; custo cai.
- `tools` omitidas na chamada final aceitas ⇒ implementar a economia.
- Muitas rejeições/`ARGS_INVALID` ⇒ iterar o prompt/ferramentas (com teste).
- Custo real por turno ⇒ fixa os limites mensais finais (Trader 100/Pro 300 hoje provisórios) e o teto do Free.
