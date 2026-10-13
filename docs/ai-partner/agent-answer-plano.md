# E6.6 (parte 2) — Resposta do agente, validador e capacidades: plano (E6.6-P)

> Status: **PLANO (E6.6-P) — só documento e expectativas, nenhuma linha de código.** Pré-requisito do E6.6 (0a–0e) **fechado** em 13/10/2026 (commit `69805ba`; `agent-contract-plano.md` §6.1).
> Aprovado em princípio pelo Marcelo em 13/10/2026: Q7, Q9, Q10, Q12, Q13, Q14 como recomendado; Q8 e Q11 com ajustes (abaixo). **Cada passo para e espera aprovação.**
> Expectativas executáveis: `scripts/expectations/agent-answer.expected.json` (tabelas derivadas **à mão**, antes do código; mudar uma célula exige `_meta.history`).
> Tudo local: sem push ao público, deploy, banco, Prisma, produção; **sem integração com a Vega IA/LLM**, sem persistência, sem UI.

## 1. Escopo
**Dentro** (funções puras): projetor de rótulo A2 e tabela de alias; formatador de slots e resolvedor de `path`; ledger; validador AV1–AV23; política de parada/regeração e renderização; o pipeline das 8 capacidades.
**Fora:** LLM/Vega IA; armazenamento do arquivo original (o `source` segue `NOT_RUN`, então tudo sai `NOT_VERIFIED` estrutural — estado esperado, não falha); armazenamento do chaveiro de sal; Prisma; UI.

## 2. Decisões
| # | Decisão | Estado |
|---|---|---|
| Q7 | `src/lib/agent/` continua puro (só `zod` e `./`). Capacidades em `src/lib/agent-capabilities/`, o único que importa `evidence/` e `metrics/`. Guardas: `agent/` nunca importa `agent-capabilities/` nem `evidence/`; SG1 inalterada | aprovado |
| Q8 | Validador de texto lexical, versionado; o **léxico completo está no arquivo de expectativas** (`lexicon`, 10 categorias, 325 termos, 1 padrão) e **o E6.6-2b só começa depois que o Marcelo aprovar a lista concreta** | aprovado em princípio; **lista aguarda revisão** |
| Q9 | AV1–AV23 | aprovado |
| Q10 | só a máquina de estados (N = 2), o fallback e a resposta de parada; sem laço com o modelo | aprovado |
| Q11 | sem arquivo ⇒ `source = NOT_RUN` + `VERIFICATION_INFRA_MISSING` (não chama `verifyEvidenceSource`); `source` `INVALID_FORMAT` ⇒ `UNVERIFIABLE`, **exigindo** que o `verify` do mesmo bundle também seja `INVALID_FORMAT`; se divergirem ⇒ `ENGINE_REFUSED` (fail-closed) | aprovado |
| Q12 | capacidades recebem `trades` e `importRecords` em memória; sem DB; `userId` nunca é argumento | aprovado |
| Q13 | fatia vertical `metrics.query` primeiro; uma capacidade por passo; `evidence.explain` só após o projetor A2; `evidence.refresh` só com `FILE_NOT_AVAILABLE` e `STALE` | aprovado |
| Q14 | resposta renderizada = `RenderedSegment[]` + banner | aprovado |

### 2.1 `ENGINE_REFUSED` não é uma 5ª categoria de parada
É um dos 5 **códigos de erro de capacidade** (`CapabilityErrorCode`, §2 do `agent-capabilities.md`) e o §5.5 já o põe em `CAPABILITY_FAILED`. O mapeamento é **total** (um teste no E6.6-3 prova isso):
| Código de erro da capacidade | Motivo de parada (§5.5) |
|---|---|
| `ARGS_INVALID`, `NOT_FOUND`, `ENGINE_REFUSED` | `CAPABILITY_FAILED` |
| `BUDGET_EXCEEDED` | `BUDGET_CALLS` |
| `FILE_NOT_AVAILABLE` | `FILE_NOT_AVAILABLE` |
| (não é erro de capacidade) 2 rejeições do validador | `REGEN_EXHAUSTED` |
Nada novo no §5.5; este quadro só torna a correspondência explícita (e o §5.5 do `agent-capabilities.md` continua válido sem mudança).

### 2.2 Achados da leitura que viraram decisões **novas** (pendentes)
| # | Achado | Recomendação | Bloqueia |
|---|---|---|---|
| **Q15** | O §4.4 **proíbe recomendação operacional**, mas `REJECTION_REASONS` **não tem motivo** para ela | acrescentar `OPERATIONAL_ADVICE` (bump do contrato, `history`, §5.1). Pior: reaproveitar `SCOPE_OVERCLAIM` | categoria ADVICE do léxico (E6.6-2b) |
| **Q16** | O motor devolve **frações** (`share`, `contribution*`, `coverage.ratio`: 0,25 = 25 %, 4 casas) que nenhuma das 6 unidades cobre | unidade **de exibição** `fraction`: desloca a vírgula (0,2556 → `25,56%`), exato, sem arredondar nem tocar o valor do motor (F1/F2). Alternativa: mostrar como `ratio` (0,2556) | E6.6-1 |
| **Q17** | `ENGINE_REFUSED` passaria a cobrir também **violações de invariante interna** que falham fechadas: verify×source divergentes (Q11), rótulo que não é saída da projeção, valor com mais casas que a unidade | reaproveitar `ENGINE_REFUSED` (sem bump); o modelo só vê a frase `CAPABILITY_FAILED`, o detalhe vai só para o log do servidor. Alternativa: novo código `INTERNAL_INVARIANT` (bump) | E6.6-1, E6.6-4 |
| **Q18** | **Preço** (`entryPrice`, `exitPrice`, `legs[].price`) não tem unidade: não é `usd` nem `points` | unidade de exibição `price`: casas do instrumento, sem sufixo, mín. 2 e máx. 6, zeros aparados até 2 | só o E6.6-11 |

## 3. Ajustes de realidade que o plano já embute
1. **Projeção do E5b mantém a caixa original** do rótulo (`ENTRY`); o `LabelViewSchema` exige `Entry`. O projetor **canoniza**.
2. **O formatador nunca arredonda:** valor com mais casas que a unidade permite é **erro** (fail-closed), não arredondamento (F2).
3. **`path`** usa a gramática que já existe (`SLOT_PATH_RE`, ex.: `metrics[0].value`); o resolvedor só anda por propriedades próprias (`Object.hasOwn`), nunca lança, e **cada folha numérica tem unidade numa tabela** (nunca adivinhada pelo nome do campo).
4. **Motivos de indisponibilidade** (`DENOMINATOR_ZERO`…) precisam de texto pt-BR; o catálogo é **derivado do código do motor por teste** (código emitido sem texto ⇒ build falha), como o SG3 faz com os `S_*`.

## 4. Léxico do validador (Q8) — o que o Marcelo revisa
Arquivo: `agent-answer.expected.json` → `lexicon`, `lexicon_must_reject`, `lexicon_must_accept`.
- **Normalização N:** NFKC, remoção de invisíveis (zero-width etc.), minúsculas, sem acentos; dígito = qualquer `Nd` Unicode (full-width, árabe-índico). Termos casam como **palavra/frase inteira** (`considerando` ≠ `considere`).
- **Regra de dígitos:** qualquer dígito em texto livre é rejeitado, **exceto** a citação do número do usuário (AV21): entre aspas duplas, ≤ 24 caracteres, conteúdo = só o número e igual a um número da pergunta.
- **Símbolos rejeitados:** `% + = × ÷ − ≈ ~ $ ±` (`*`, `-`, `/` ficam livres).
- **Categorias e motivo:** `NUM_WORDS` + `APPROX` → `NUMBER_OUTSIDE_SLOT` · `ARITH` → `MODEL_ARITHMETIC` · `CAUSAL` → `CAUSAL_CLAIM` · `SCOPE` → `SCOPE_OVERCLAIM` · `INCONCLUSIVE` (com exceção de negação; só se `conclusive=false` ou `LOW/TINY`) → `INCONCLUSIVE_AS_CONCLUSIVE` · `EXIT_OVERCLAIM` → `EXIT_REASON_OVERCLAIM` · `TIE` (só se nenhuma linha citada tem `tiedWithPrevious=true`) → `TIE_OVERCLAIM` · `COMPARISON_CONCLUSION` (só com claim `LABELED`) → `UNVERIFIED_USED_FOR_CONCLUSION` · `ADVICE` → `OPERATIONAL_ADVICE` (**inativa até a Q15**).
- **Escolhas deliberadas que você deve rever:** *não* listei `um/uma` (artigos), `meio`, `quarto` e ordinais. **Listei `dois…dez`**, então **"os dois grupos" e "as duas contas" são rejeitados** (falso-positivo aceito; o modelo diz "os grupos" ou cita por slot). Se quiser afrouxar contagens estruturais pequenas, a decisão é sua.
- **As 4 exclusões questionadas (revisão de 13/10/2026, testadas com frases):**
  | Termo | Veredito | Motivo específico |
  |---|---|---|
  | `diferença entre` | **exclusão mantida** | A subtração do modelo **sempre** sai como número escrito (dígito ou numeral), que `RULE_DIGITS`/`NUM_WORDS` já rejeitam ("a diferença entre A e B é de 300" cai; "...de trezentos" cai). Sem número, a frase é qualitativa e legítima ("há diferença entre os grupos"). Listá-la só geraria falso-positivo, sem pegar nada novo. |
  | `vezes` solto | **mantida, com a lacuna fechada** | "às vezes"/"muitas vezes" são frequência. "três vezes mais" e "3 vezes maior" **já caem** por `tres`/dígito. A lacuna real era "**várias** vezes mais" (multiplicativo vago sem numeral): agora `vezes mais/menos/maior/menor/o` e `vez e meia` estão em ARITH, **com exceção** quando a palavra anterior é `as/muitas/algumas/poucas/outras/certas` (frequência). |
  | `motivo` solto | **mantida a exclusão da palavra solta, lacuna fechada com frases** | "motivo de saída" é o nome de um dado legítimo (`exitReason`; "o motivo de saída é desconhecido"). Mas **era lacuna real**: "o motivo da perda foi a entrada tardia" passava. Entram 8 frases estreitas em CAUSAL (`o motivo disso`, `o motivo pelo qual`, `motivo pelo qual`, `esse/este é o motivo`, `o motivo da perda/do prejuízo/da queda`). |
  | `logo` | **lacuna real; fechada por padrão pontuado** | Faltou justificativa escrita no arquivo (falha minha). A palavra solta é temporal ("logo após a abertura") e geraria falso-positivo constante. O sentido causal vem **com vírgula** ("..., logo, perdeu"; "Logo, ..."): padrão `LOGO_CAUSAL` (`\blogo\s*,`) sobre o texto antes do FLAT. |
  Resultado: `diferença entre` fica de fora por razão específica; as outras três tinham **uma lacuna real cada** (`motivo` causal, `logo,` causal, `vezes` multiplicativo vago), fechadas **sem** listar a palavra solta. Corpus ampliado (+5 rejeições, +6 frases boas).
- **Conferência feita:** os 37 casos de rejeição e as 18 frases boas foram rodados contra as listas, o padrão e a exceção, com um script descartável (fora do repo): todos se comportam como o arquivo diz. **Achei 3 erros meus na primeira versão do corpus e corrigi** (registrados no `history`).
- **Falsos-negativos conhecidos (não corrigidos):** paráfrases com palavras no meio (ex.: "o alvo foi atingido de verdade"), "melhor desempenho que" (não casa com "melhor que"), homóglifos, erros de digitação. **O validador lexical é rede de proteção secundária; a defesa primária é o slot.**

## 5. Passos (expectativa antes do código; 1 commit local por passo; paro a cada um)
| Passo | Conteúdo | Bloqueado por |
|---|---|---|
| **E6.6-P** | **este commit** (doc + expectativas, sem código) | — |
| **E6.6-1** | **FEITO (13/10/2026, aguardando aprovação)** — formatador de slots (+ catálogo de 29 motivos), resolvedor de `path` e tabela de folhas, projetor A2 e alias; oráculo do formatador em BigInt, matriz de rótulos literal; 35 mutações (14 previstas). Ver §7 | aprovação do plano, **Q16**, **Q17** |
| **E6.6-V** | **bump das PromptViews (PD-2, opção (a) aprovada em 13/10/2026):** `reason` irmão em `buckets[].pnlNet`/`share` (E6.6-7), `deltas[]` (E6.6-8), `rows[].contribution` (E6.6-9) e `comparison` (E6.6-10); expectativa + `history` + CHANGELOG antes do código; passo próprio, **antes do E6.6-7**; não bloqueia o 2a | aprovação do Marcelo para abrir o passo |
| **E6.6-2a** | **EXPECTATIVA escrita, PARADO nas células C1–C10 (ver `agent-answer.expected.json` → `e66_2a.open_cells`)** — ledger puro e validador estrutural (§5.2 passos 1–4 e 6): AV2, 3, 4, 7, 8, 10, 11, 15, 16, 17, 20 (aceite), 22 + partes estruturais de AV9 e AV18 | E6.6-1 |
| **E6.6-2b** | validador de texto livre: AV1, 5, 6, 12, 13, 14, 21, 23 + partes lexicais de AV9 e AV18; reporta placar de falso-positivo e falsos-negativos | **aprovação do léxico**, **Q15** |
| **E6.6-3** | máquina de parada (N=2), respostas canônicas, mapeamento total (§2.1), render (`RenderedSegment[]`, banner = pior veredito); AV19, AV20 | E6.6-2 |
| **E6.6-4** | `agent-capabilities/`: pipeline comum bundle → `verify` → source(`NOT_RUN`) → `buildVerdict` → handle e limits; projeção por lista branca; os 9 bundles pinados inalterados | E6.6-3, Q17 |
| **E6.6-5** | `metrics.query@1` (fatia vertical, fim a fim com o validador; oráculo = `calculateMetrics` direto) | E6.6-4 |
| **E6.6-6 a 10** | `metrics.groups`, `exit.breakdown`, `metrics.compare`, `rank.groups`, `exit.analysis` (um por passo) | E6.6-5 |
| **E6.6-11** | `evidence.explain@1` + teste dedicado da A2 (rótulo adversarial nunca sai bruto, K = 20, sem `rowNo`/`rowHash`) | E6.6-10, **Q18** |
| **E6.6-12** | `evidence.refresh@1` (só `FILE_NOT_AVAILABLE` e `STALE`) + fechamento (guardas estáticos globais, docs, CHANGELOG) | E6.6-11 |

**Em todos os passos:** nada muda em `evidence/`, `metrics/`, `ingest/`, `domain/`; as 771 linhas da suíte atual permanecem idênticas (só se acrescentam novas); hashes e ids dos 9 bundles pinados inalterados; `tsc` e ESLint limpos; mutações com prova; **qualquer célula ambígua das tabelas à mão ⇒ eu paro e trago para você** (já fiz isso nas Q15–Q18).

## 6. Riscos declarados
- O validador lexical tem falso-negativo por natureza e falso-positivo aceito (§4).
- Guardas estáticos provam **texto**, não fluxo de dados.
- Até existir o armazenamento do arquivo original, todo resultado é `NOT_VERIFIED` estrutural.
- Prosa pt-BR das palavras de enum (`exitReason`, `sampleFlag`…) e dos motivos é proposta minha (revisão de redação, como o O-G); os **códigos** são o contrato.

## 7. Resultado do E6.6-1 (13/10/2026)
**Código novo** (só `src/lib/agent/`, só `zod`/`./`): `format.ts` (formatador exato em texto, nunca arredonda, 8 unidades de exibição incl. `fraction` e `price`; catálogo de 29 motivos; datas; palavras de enum), `slot-path.ts` (resolvedor só por propriedades próprias + tabela de folhas por capacidade + `renderSlot` que valida a view no schema antes de ler), `label.ts` (o ÚNICO projetor de rótulo + tabela de alias imutável por época). **Nada** em `evidence/`, `metrics/`, `ingest/`, `domain/` mudou; `views.ts` e `contract.ts` também não.
**Testes:** 771 → **814** ✓ (+43), nenhuma linha do baseline alterada. 35 mutações: todas pegas, exceto 1 **equivalente** declarada (limite de 200 caracteres do path: o path só vale se casar com um padrão curto da tabela, então o limite não muda nenhum resultado).
**Testes existentes que tive de ajustar** (só asserções; títulos e linhas de saída idênticos): G0 (lista exata de arquivos de `agent/`: 4 → 7), SG5 (vocabulário de rótulo: `label.ts` + `views.ts`, como o SG5 já previa), SG1 (regex de import com lookbehind para não ler a chave `"period.from"` como import).
**Decisões minhas, para você rever:** (1) `metrics[].basis` **não** é folha de slot (o motor devolve também `R_NET`/`R_POINTS`, fora da tabela); (2) folha numérica `null` **sem** campo `reason` irmão ⇒ `FORMAT_INVALID` (nunca zero, nunca em branco). **Achado:** a PromptView de `metrics.compare` não carrega o `reason` do delta, então citar um delta `null` falha fechado (`CAPABILITY_FAILED`) em vez de dizer "indisponível"; a correção (acrescentar `reason` na view, com bump registrado) fica para o E6.6-8; (3) `entryLocal`/`exitLocal`/`instrument`/`metricId` fora dos slots (YAGNI); (4) a folha `reason` renderiza o texto cru do catálogo, e a folha `value` null renderiza `indisponível (…)`.
**Limitações:** a varredura estática do catálogo usa prefixos (heurística) e a de execução só cobre os cenários montados; o catálogo de motivos tem prosa proposta por mim (os códigos são o contrato).

## 8. Pendências explícitas abertas pelo E6.6-1 (registradas em 13/10/2026 a pedido do Marcelo)
| # | Pendência | Quando aparece | Opções |
|---|---|---|---|
| **PD-1** | `metrics[].basis` não é folha de slot. Correção de termo: `R_NET`/`R_POINTS` **não são unidades** (as 6 unidades estão cobertas); são valores de `basis` (`NET`, `GROSS`, `R_NET`, `R_POINTS`, `null`). **Toda** capacidade que devolve métrica (E6.6-5, 6, 9) emite `basis` na view; nenhuma precisa citá-lo por slot. | Não quebra nada. Risco: o modelo escrever "líquido"/"bruto" em texto livre sem o servidor conferir (afirmação sem número, fora do alcance dos slots e do léxico). | (a) aceitar: `basis` só informativo; (b) folha `enum basis` com 4 palavras (líquido, bruto, R líquido, R em pontos) e o validador exigir o slot ao mencionar a base. Recomendação: decidir no E6.6-2b (é lá que a mentira textual seria pega). |
| **PD-2** | Folha numérica `null` **sem** `reason` na view. **Mais ampla que o delta**: `buckets[].pnlNet` e `buckets[].share` (E6.6-7), `rows[].contribution` (E6.6-9), `deltas[]` (E6.6-8, e `comparison` do E6.6-10). O motor tem o `reason` (tipo `Fraction`), a PromptView o descarta. | **E6.6-7**, antes do 8: `share` é `null` com denominador zero. Citar esse slot ⇒ `FORMAT_INVALID` ⇒ `CAPABILITY_FAILED` (falha fechada, correta, mas pior que dizer "indisponível"). | (a) bump das views acrescentando `reason` irmão nessas folhas, num passo próprio ANTES do E6.6-7; (b) aceitar a falha fechada até o fim e corrigir depois. Recomendação: (a). |

