# Política de sal por usuário — plano (P0)

> Status: **P0, P1, P2 e P4 feitos (P4 antes do P3, ordem aprovada)** (12/10/2026; tabela de andamento na §5.1). Decisões O1/O2/O3 aprovadas. Decisões D1–D7 aprovadas pelo Marcelo (D4 com correção de design, abaixo).
> Expectativas executáveis: `scripts/expectations/salt-policy.expected.json` (escritas **antes** do código; mudar exige `_meta.history`).
> Tudo local: sem push, deploy, banco, Prisma, produção; sem dado real no repo; E6.5 só desenho, depois de D1–D3.

## 1. Problema
Hoje o sal (`accountRefSalt`) é opção do chamador, **por import**. O bundle só diz que o import foi salgado (`reproducibility.accountRefSalted`), não **qual** sal. Um ref gerado com o sal errado/esquecido é indistinguível de adulteração: `SOURCE_MISMATCH` com pista de texto (lacuna conhecida, `data-contract.md` §14.15). Sem sal, `accountRef/strategyRef/labelRef/patternRef` são adivinháveis por dicionário (§14.14). O guarda de propagação (camadas 1/2/2b/2c/3) previne, mas **não é prova formal** (3 falsos-negativos registrados).

## 2. Decisões (aprovadas em 12/10/2026)
| # | Decisão |
|---|---|
| D1 | **1 sal por usuário**, fixo para tudo que ele gera (não por tipo de ref, não por import). Os 4 refs já têm domínios de hash separados; sais por tipo só multiplicariam os estados de "esqueci" sem ganho. Por import quebraria a comparação entre imports (o que o agente do E6.5 precisa). Consequência intencional: refs de usuários diferentes não são comparáveis. |
| D2 | O sal é **gerado pelo sistema**, aleatório, **≥ 256 bits (32 bytes)**. O usuário não digita sal. (Habilita D4 com segurança.) |
| D3 | **Obrigatório** em todo caminho de produto; **opcional** só no Lab/dev e testes (`UNSALTED_BY_DESIGN` continua, sob guarda). |
| D4 | O bundle declara `saltId` (rótulo não secreto, ex. `s1`) e `saltCheck` (`slt_<24 hex>`, hash do sal em domínio `meutrade/saltCheck/1`), campos **opcionais** em `ImportRef.reproducibility`. Geração **fail-closed** (`E_SALT_REQUIRED`, `E_SALT_MISMATCH`). **Regra revisada abaixo.** |
| D5 | `SaltProvider` como **interface** (`get(userId, saltId) → ACTIVE+valor | RETIRED | UNKNOWN`); implementação **só em memória/env** nesta fase. Persistência real fica para a fase de persistência (requisitos: cifrado em repouso, nunca em bundle/log/repo/prompt de LLM/front). A string `accountRefSalt` continua só para compatibilidade com bundles legados. |
| D6 | **Chaveiro versionado** por usuário (`s1`, `s2`…): só o mais recente gera; bundles antigos continuam verificáveis enquanto o sal antigo estiver no chaveiro. **Migração = regerar** a Evidence a partir do CSV (bundle é imutável, o selo cobre o conteúdo). Aposentar um sal ⇒ seus bundles ficam `UNVERIFIABLE` com código explícito; se o sal vazou, os refs daqueles bundles são tratados como expostos por dicionário. Memória do agente (E6.5) que guarde refs fica obsoleta após rotação. |
| D7 | **Legado intacto:** bundle sem `saltId` mantém o comportamento de hoje (inclusive a lacuna com pista). Nenhum hash existente muda. |
| Ordem | Política de sal **antes** do E6.5; desenho do E6.5 (só doc) em paralelo depois de D1–D3, sem tocar o schema ao mesmo tempo. |

## 3. Correção de design da D4 (Marcelo, 12/10/2026) — `saltCheck` NÃO é portão
Motivo: se um `saltCheck` ruim bastasse para o verificador desistir, um atacante que adultera um ref **e** bagunça o `saltCheck` escolheria a severidade do próprio ataque (`UNVERIFIABLE`, que soa inofensivo, em vez de `SOURCE_MISMATCH`).

Regra:
1. `saltId` resolve para um sal conhecido via `SaltProvider` ⇒ o verificador **usa esse sal e compara os refs de verdade**, mesmo com `saltCheck` divergente. `saltCheck` é autodeclaração redundante, não fonte da verdade.
2. `S_SALT_UNKNOWN` **só** quando o provider não tem nenhum sal para o `saltId` declarado (não cadastrado, ou aposentado sem registro). Aposentado **com** registro ⇒ `S_SALT_RETIRED`.
3. Refs batem e `saltCheck` diverge ⇒ **limitação/aviso visível** (não `SOURCE_MISMATCH` automático, não `UNVERIFIABLE` silencioso) — ver O2.
4. Refs divergem ⇒ `SOURCE_MISMATCH`, **reforçado** (detalhe `V_SALT_CHECK_MISMATCH`) se o `saltCheck` também divergir.
5. **Controle negativo obrigatório no P4:** `saltId` conhecido e resolvível + `saltCheck` adulterado + ref adulterado ⇒ **`SOURCE_MISMATCH`, nunca `UNVERIFIABLE`** (caso `V6` do arquivo de expectativas).

## 4. Pontos em aberto (propostos por mim; precisam de decisão antes do passo indicado)
- **O1 (antes do P4) — o mesmo ataque, pelo `saltId`.** Adulterar um ref **e** trocar o `saltId` para um valor desconhecido leva a `S_SALT_UNKNOWN` (`UNVERIFIABLE`): é a mesma família que a correção acima fecha para o `saltCheck`. Proposta: antes de dar `S_SALT_UNKNOWN`, tentar **todos os sais conhecidos do usuário** no provider; se algum reproduz os refs ⇒ `SOURCE_VERIFIED_PARTIAL` + limitação "saltId declarado não resolve" (caso `V8`); se nenhum reproduz ⇒ `UNVERIFIABLE`, **resíduo documentado**: indistinguível de bundle de sal aposentado (caso `V9`); o veredito combinado é `NOT_VERIFIED`, e o texto do check diz explicitamente que não é prova de integridade e que nada dependente de sal foi conferido. *Limite que não dá para eliminar:* sem o sal original, adulteração e sal aposentado são a mesma coisa para o verificador.
- **O2 (antes do P4) — status de "refs batem, `saltCheck` diverge".** Proposta: `SOURCE_VERIFIED_PARTIAL` com limitação `L_SALT_CHECK_DIVERGENT`, para o aviso aparecer no veredito combinado (`VERIFIED_PARTIAL`). Alternativa: `SOURCE_VERIFIED` só com a limitação.
- **O3 (antes do P4) — string × provider.** Bundle com `saltId` resolvível e `accountRefSalt` (string) do chamador diferente: proposta = vale o sal do provider; a string é ignorada para bundles com `saltId`.
- **O4 — `saltId/saltCheck` no `importId`?** **Resolvido por leitura:** `reproducibility` está fora do `importId` (`identity.ts`). Confirmado por teste no P2 (`H4`); se o teste disser outra coisa, **paro e reporto**.

## 5. Passos (expectativa antes do código; 1 commit por passo; paro a cada um para aprovação)
| Passo | Conteúdo | Muda comportamento? |
|---|---|---|
| **P0** | Este plano + `salt-policy.expected.json` (**este commit**) | não |
| **P1** | `SaltProvider` (interface + implementação em memória), `generateSalt` (32 bytes), `saltCheck`, chaveiro (`ACTIVE/RETIRED/UNKNOWN`). Funções puras, **não ligadas a nada**. Testes `P1–P4`. Confirmar O4 por teste. | não |
| **P2** | `saltId`/`saltCheck` opcionais no schema (`ImportRef.reproducibility`) + V0 de formato (`S1`); `importId/rowHash/tradeId` inalterados (`H4`); prova dos 9 bundles (`H1–H3`); varredura de sigilo (`S2`). | não para bundles existentes |
| **P3** | Geração fail-closed nos `explain-*`: `E_SALT_REQUIRED`, `E_SALT_MISMATCH` (`G1–G6`); legado intacto; guardas (`GD1/GD2`) atualizados; camada 2c e lista de aprovados revistas. | **sim**: import novo salgado sem sal certo passa a ser erro |
| **P4** | E5b lê `saltId/saltCheck` via provider; regra revisada da §3 (`V3–V12`), controle negativo `V6`; decidir O1/O2/O3 **antes**; matriz completa (`V13`). | **sim, só para bundles novos** |
| **P5** | Lab: cenários de sal esquecido, errado, rotacionado, `saltCheck` adulterado (inclui o `V6`). | não (dev) |
| **P6** | Docs (contrato §14.14 deixa de ser "decisão pendente"; §14.15 lacuna → fechada para bundles novos), CHANGELOG, lista revista dos falsos-negativos do guarda, fechar a pendência `sal-usuario` em `layers.ts`. | não |

### 5.1 Andamento
| Passo | Estado |
|---|---|
| P0 | feito (`50f4099`); O1 (tentar sais conhecidos; V8 PARTIAL / V9 UNVERIFIABLE), O2 (`SOURCE_VERIFIED_PARTIAL` + `L_SALT_CHECK_DIVERGENT`, rebaixa o combinado para `VERIFIED_PARTIAL`) e O3 (provider vence a string) **aprovados**; O4 resolvido por leitura e **confirmado por teste no P2 (H4)** |
| P1 | feito (`f047355`) + `ensure` fail-closed (`f827d96`: último sal aposentado ⇒ `E_SALT_NO_CURRENT`, só `rotate` explícito destrava; antes recriava em silêncio) |
| P2 | feito — `saltId`/`saltCheck` opcionais (juntos ou nenhum) em `ImportRecord.reproducibility` e `ImportRef.reproducibility`; formatos em `domain/canonical.ts` (fonte única); `projectReproducibility` copia só se declarados. **Estado transitório:** sem produtor (P3) e sem leitor (P4), um bundle com os campos dá `SOURCE_MISMATCH` no E5b (`V_IMPORT_RECORD_MISMATCH` em `reproducibility`) — fail-closed, travado por teste e a ser SUBSTITUÍDO no P4. |
| P4 | feito — E5b lê `saltId`/`saltCheck` via `VerifySourceOptions.salt = {provider, userId}`; regras da §3 + O1/O2/O3; `V_SALT_CHECK_MISMATCH`, `V_SALT_DECLARATION_INCONSISTENT` (V14, caso novo, **aguarda confirmação**), `S_SALT_UNKNOWN`, `S_SALT_RETIRED`, `L_SALT_CHECK_DIVERGENT`, `L_SALT_ID_NOT_RESOLVED`. Teste `test-salt-policy-p4.mts` (13), 5 mutações pegas (inclui `saltCheck` como portão). Bundles sem `saltId` (legado) e não-salgados: caminho de sempre. **Mudança colateral:** `combine()` passa a preferir SKIPPED bloqueante sobre `S_POPULATION_PARTIAL` (como o comentário já dizia) — nenhum teste existente mudou. |
| P3 | pendente (gerador fail-closed `E_SALT_REQUIRED`/`E_SALT_MISMATCH`, emite `saltId`/`saltCheck`) — agora SEM janela de bundle acusado, pois o leitor já existe |

## 6. Fora de escopo
Persistência real/Prisma/banco, UI de produto, Vega IA, E6.5 (só desenho depois de D1–D3), E5c, vocabulário v2, tratar o sal como senha de usuário.

## 7. Riscos
- **`saltCheck` permite testar palpites de sal offline.** Contido por D2 (sal aleatório de 256 bits ⇒ inviável). **Se algum caminho aceitar sal escolhido pelo usuário, `saltCheck` não pode ser publicado.**
- **P3/P4 mudam comportamento do gerador/verificador** (só para bundles/imports novos). Cada um com aprovação própria e baselines comparados linha a linha (como no conserto do `rowTrades`).
- **Perda do sal = perda de verificação** dos refs daquele usuário (sem recuperação): backup do chaveiro é requisito da fase de persistência.
- **Refs não são anonimização** mesmo com sal forte (pseudônimo): quem tem o sal reverte por dicionário.
