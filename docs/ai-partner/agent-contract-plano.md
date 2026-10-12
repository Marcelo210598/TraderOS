# E6.5 — Contrato de capacidades para o agente: plano (E6.5-0)

> Status: **E6.5-0 feito (plano + expectativas)** — 12/10/2026. **Nada implementado.** O E6.5 é só desenho, documento e tipos; **sem integração com a Vega IA/LLM**, sem persistência, sem UI de produto. Decisões D1–D10 aprovadas pelo Marcelo com três ajustes (A1–A3).
> Expectativas executáveis: `scripts/expectations/agent-contract.expected.json` (escritas **antes** de qualquer tipo; mudar exige `_meta.history`).
> Tudo local: sem push, deploy, banco, Prisma, produção; sem dado real no repo.

## 1. Princípio
O agente **nunca calcula**: chama capacidades determinísticas e cita `evidenceRef`. Sem `evidenceRef`, ou com veredito combinado fora de `VERIFIED`/`VERIFIED_PARTIAL`, declara a limitação em vez de afirmar. Única exceção, rotulada: `NOT_VERIFIED` com `verify = VALID` (D3).

## 2. Decisões (aprovadas em 12/10/2026)
| # | Decisão |
|---|---|
| D1 | `evidenceRef = "ev_" + 32 hex do evidenceHash` (endereçado por conteúdo; não inventável). Só vale ref que o **ledger** da conversa emitiu. |
| D2 | **Números só por slots exatos** (`{{ev_x.pnl.net}}`) renderizados no servidor, com formato fixo; o modelo não digita número. Validador pós-modelo como defesa em profundidade. **Substitui** a "tolerância de arredondamento" do `technical-foundation` H.4. |
| D3 | `NOT_VERIFIED` com `verify = VALID`: mostrar o valor do motor **rotulado**, sem uso em comparação/conclusão/recomendação. `verify ≠ VALID` ⇒ nenhum número. **Ajuste A1:** dois textos canônicos distintos (abaixo). |
| D4 | `source` "não executado" ⇒ `NOT_VERIFIED`, nunca `VERIFIED`. |
| D5 | `verify`/`verifySource` **não** são ferramentas do agente; rodam dentro de cada capacidade (ler `SOURCE_VERIFIED` isolado é proibido pelo §6.1). |
| D6 | Memória guarda **especificações de consulta**, nunca refs. `refEpoch` (= `saltId`) em todo resultado; ref antigo vira `STALE` após rotação; `evidence.refresh` regera sob o sal atual; sal aposentado ⇒ `NOT_VERIFIED` (`S_SALT_RETIRED`). |
| D7 | Nomes reais só por **binding tardio na UI**, depois do validador, fora do modelo. |
| D8 | O combinado sai de **uma função pura única** (E6.6), com teste próprio. O E6.5 só declara o tipo. |
| D9 | Frases de limitação são **canônicas pt-BR geradas no servidor**, nunca pelo modelo. |
| D10 | `evidence.explain`: no máximo **K trades** por chamada, sem `rowNo`/`rowHash`/ids de linha. **Ajuste A2** (abaixo). |

## 3. Ajustes de 12/10/2026
- **A1 — dois textos de `NOT_VERIFIED`.** *ESTRUTURAL* (a infraestrutura de verificação — armazenamento do arquivo original — ainda não existe; cobrirá quase tudo até lá) e *ESPECÍFICO* (motivo do caso: `saltId` não resolvido, dimensão sem referência, mapa do usuário ausente, versão incompatível…). Risco tratado: um aviso genérico único ensina o usuário a ignorá-lo. Regras propostas: o estrutural é **um texto fixo na mesma posição** de toda resposta; o específico tem **uma frase própria por código**, inline no claim afetado e visualmente distinta; nunca fundidos (se os dois se aplicam, os dois aparecem, o específico primeiro); **sem frase de reserva** — código sem frase no catálogo faz o build falhar; o catálogo é conferido contra os códigos `S_*` que `verify.ts`/`verify-source.ts` realmente emitem.
- **A2 — `evidence.explain` pela mesma projeção.** Passa pela **mesma função** de projeção de rótulo da PromptView (vocabulário v1 / alias de token). Teste dedicado: o drill-down nunca expõe `sourceLabel`/`entryLabel`/`exitLabel` bruto (inclui rótulo adversarial tipo instrução de prompt) e há uma só implementação do projetor (teste estático).
- **A3 — N definido já no E6.5-1.** Proposta: **N = 2 regerações** (3 tentativas no total) com o motivo da rejeição como feedback; depois, resposta canônica "não consigo afirmar isso com evidência", listando as capacidades tentadas e o motivo da última rejeição, **sem número do modelo**. Fixado como constante tipada no contrato (E6.5-2) e no documento (E6.5-1).

## 4. O que o agente pode e não pode por veredito
| Combinado | Números | Obrigatório | Proibido |
|---|---|---|---|
| `VERIFIED` | sim | dizer a **população declarada** (n) | "histórico inteiro"; chamar de conclusivo se `conclusive=false`/`sampleFlag` LOW\|TINY |
| `VERIFIED_PARTIAL` | sim, com a frase | frase canônica da razão parcial (HASH_ONLY, `L_SALT_CHECK_DIVERGENT`, `L_SALT_ID_NOT_RESOLVED`, população parcial); "indicativo" | generalizar além da população coberta |
| `NOT_VERIFIED`, `verify = VALID` | **rotulados** (A1) | texto ESTRUTURAL e/ou ESPECÍFICO | usar em comparação, conclusão ou recomendação |
| `NOT_VERIFIED`, `verify ≠ VALID` | **não** | limitação específica | qualquer número |
| `TAMPERED_OR_MISMATCH`, `INVALID_FORMAT` | **não** | "o bundle não confere com o selo/arquivo" (o que falhou); regeração feita pelo servidor; auditoria | número "da memória", especular causa, acusar o usuário |
Resposta mista: cada claim com o próprio veredito; o banner é o **pior**. O agente não faz aritmética.

## 5. Superfície de privacidade
- **T0 (nunca perto do prompt, nem no `explain`):** CSV/bytes, `fileName`, nomes de conta e estratégia, texto bruto de rótulo, regex do usuário, valor do sal, `saltCheck`, `fileSha256`, `rowNo`, `rowHash`, `sourceRows`, `issues`, `fieldProvenance`, `userId`, `importedAt`.
- **T1 (PromptView, lista branca por capacidade):** valor/unidade/base, amostra/cobertura/`sampleFlag`/confiança, limitações (código + texto), período, chaves de grupo como **alias**, palavra do vocabulário v1 ou alias de token, bucket de `exitReason`, `refEpoch`.
- **T2 (`evidence.explain`, ≤ K trades):** hora local, preços, quantidade, P&L, motivo e pernas, sem identificadores de linha; **mesma projeção** (A2).
- O **bundle nunca entra no prompt**. Texto livre do usuário (rótulos) vira token/alias antes de chegar ao modelo: não há canal de injeção de prompt por rótulo de CSV (testado com rótulos adversariais).

## 6. Passos (expectativa antes do código; 1 commit local por passo; paro a cada um)
| Passo | Conteúdo | Código? |
|---|---|---|
| **E6.5-0** | Este plano + `agent-contract.expected.json` (**este commit**) | não |
| **E6.5-1** | `docs/ai-partner/agent-capabilities.md`: o contrato em texto (capacidades, envelope, ledger, slots, matriz de vereditos, A1 com o catálogo de frases, A3 com **N = 2** e **K** fixados, rotação, privacidade) | não |
| **E6.5-2** | **Só tipos e schemas zod** em `src/lib/agent/contract.ts` (`CapabilityResult`, `EvidenceHandle`, `AgentAnswer`, `PromptView`, constantes N e K). Nenhuma capacidade, nada ligado | tipos |
| **E6.5-3** | Testes estáticos do contrato (SG1–SG5) e extensão do `test-evidence-no-solo-verdict`; catálogo de frases conferido contra os códigos emitidos; teste dedicado da A2 **sobre a especificação** (a varredura real do drill-down é E6.6, quando houver projetor) | testes |

**Fora do E6.5, precisa de aprovação própria (E6.6):** `combineVerdict`, o validador de respostas (AV1–AV21), as PromptViews e o projetor de rótulo como código. **Fora das duas fases:** integração com a Vega IA/LLM, armazenamento de arquivo, armazenamento real do chaveiro, UI de produto.

## 7. Dependências e riscos
- **Armazenamento do arquivo original** (fase de persistência): sem ele o `source` é "não executado" ⇒ tudo `NOT_VERIFIED` com o texto ESTRUTURAL. É o estado esperado do produto até lá, não falha do contrato.
- **Armazenamento real do chaveiro de sal:** `evidence.refresh` e a verificação de bundles antigos dependem dele.
- **Catálogo de formatos de slot** (moeda, R, %, quantidade) também é contrato e precisa de decisão no E6.5-1.
- **Binding tardio de nomes** cria uma segunda superfície de privacidade (a UI), a revisar quando houver UI.

## 8. Pontos em aberto (propostas minhas, para o E6.5-1)
- **O-A:** número que o usuário digitou na pergunta e o modelo repete — só entre aspas, como citação (AV21).
- **O-B:** alias por conversa, estável dentro dela e recalculado após rotação (PV6).
- **O-C:** valor de K do `evidence.explain` — proposta **K = 20**.
- **O-D:** posição visual do banner estrutural é da UI; o contrato só exige texto único e posição fixa.
