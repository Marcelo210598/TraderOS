// Cenários da POLÍTICA DE SAL no Evidence Lab (aba "Origem (E5b)", P5 do salt-policy-plano.md). Tudo SINTÉTICO e só em desenvolvimento.
// Os "sais" abaixo são derivados de um texto fixo DEMO (sha256): servem só para o Lab ser determinístico, não protegem nada e NUNCA aparecem na
// interface (a página só vê saltId/saltCheck e os estados dos checks). Funções reais: pipeline com sal gerenciado, explainMetric, E5b com provider.
import { computeEvidenceHash } from "../../evidence/hash.ts"
import { explainMetric, metricEvidenceBundle } from "../../evidence/explain-metric.ts"
import type { EvidenceBundle } from "../../evidence/schema.ts"
import { sha256Hex } from "../../infra/hash.ts"
import { runImportPipeline } from "../../ingest/pipeline.ts"
import { InMemorySaltKeyring, saltCheck } from "../../ingest/salt.ts"
import { calculateMetricsTraced, toAnalyticsTrades } from "../../metrics/index.ts"
import { assertEvidenceLabEnabled } from "./guard.ts"
import type { SourceContext, SourceScenario } from "./source.ts"
import { DEMO_FILE_NAME, DEMO_SOURCE_TZ } from "./synthetic.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const USER = "lab-user"
const demoSalt = (tag: string): string => sha256Hex(`lab-demo-salt/${tag}`) // 64 hex: forma de sal forte, valor público (DEMO)
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const reseal = (b: Any): Any => ({ ...b, evidenceHash: computeEvidenceHash(b) })
const enc = (s: string) => new TextEncoder().encode(s)

/** Chaveiro determinístico do Lab com os sais DEMO `tags` (s1, s2…); `retire` aposenta os ids listados. */
function keyring(tags: string[], retire: string[] = []): InMemorySaltKeyring {
  let n = 0
  const kr = new InMemorySaltKeyring(() => demoSalt(tags[n++]))
  for (let i = 0; i < tags.length; i++) kr.rotate(USER)
  for (const id of retire) kr.retire(USER, id)
  return kr
}

interface Built { bundle: Any; files: Record<string, Uint8Array> }

/** Gera o bundle de `netPnl` de um import. `salt`: sal de GERAÇÃO (a regra é passar o MESMO sal do import). */
function generate(csv: string, importCtx: { salt?: { provider: InMemorySaltKeyring; userId: string }; accountRefSalt?: string }, genSalt: string | undefined): Built {
  const run = runImportPipeline(csv, { sourceTz: DEMO_SOURCE_TZ, fileName: DEMO_FILE_NAME, ...importCtx })
  if (!run.importRecord) throw new Error(`Lab: import do cenário de sal recusado (${run.issues.map((i) => i.code).join(",")})`)
  const T = toAnalyticsTrades(run.trades)
  const t = calculateMetricsTraced(T)
  // `opts` é repassado sempre; nos cenários do legado ele pode ficar SEM sal de propósito (é o "esquecimento" que se quer mostrar)
  const opts: { accountRefSalt?: string } = genSalt !== undefined ? { accountRefSalt: genSalt } : {}
  const r = explainMetric({ metricId: "netPnl", source: { kind: "METRICS", result: t.result, trace: t.trace }, trades: T, importRecords: [run.importRecord], opts })
  if (!r.ok) throw new Error(`Lab: Evidence do cenário de sal recusada (${r.code})`)
  return { bundle: metricEvidenceBundle(r), files: { [run.importRecord.importId]: enc(csv) } }
}

const tamperRef = (b: Any): Any => { const x = clone(b); x.evidence.trades[0].accountRef = `acc_${"0".repeat(24)}`; return reseal(x) }
const setDecl = (b: Any, saltId: string, check: string): Any => { const x = clone(b); for (const i of x.evidence.imports) { i.reproducibility.saltId = saltId; i.reproducibility.saltCheck = check } return reseal(x) }

const scenario = (s: Omit<SourceScenario, "make" | "expected"> & { build: (csv: string) => { built: Built; options: Any } }): Omit<SourceScenario, "expected"> => ({
  ...s,
  make: (c: SourceContext) => {
    assertEvidenceLabEnabled()
    const { built, options } = s.build(c.demo.csv)
    return { bundle: built.bundle as EvidenceBundle, files: built.files, options }
  },
})

const managed = (csv: string, tags: string[], genTag: string) => {
  const kr = keyring(tags)
  const cur = kr.current(USER)!
  const built = generate(csv, { salt: { provider: kr, userId: USER } }, demoSalt(genTag === "current" ? tags[tags.length - 1] : genTag))
  return { kr, cur, built }
}

/** Cenários SEM o estado previsto: o `expected` de cada um mora em source.ts (SALT_EXPECTED), que lê os dois verificadores (guarda do veredito combinado). */
export const SALT_SOURCE_DEFS: Array<Omit<SourceScenario, "expected">> = [
  scenario({
    id: "salt-ok",
    title: "Sal gerenciado: tudo confere",
    what: "Import com o sal ATUAL do chaveiro (saltId s1); a Evidence declara saltId e saltCheck (nunca o valor). O E5b resolve o sal pelo provider e reconfere refs e valores.",
    expectedNote: "saltId resolvível, refs e saltCheck batem. O valor do sal nunca aparece no bundle nem nesta tela.",
    build: (csv) => { const m = managed(csv, ["a"], "current"); return { built: m.built, options: { salt: { provider: m.kr, userId: USER } } } },
  }),
  scenario({
    id: "salt-rotated",
    title: "Rotação: bundle antigo (s1) ainda verifica",
    what: "O usuário rotacionou o sal (s1 → s2). O bundle gerado sob o s1 continua verificável enquanto o s1 estiver no chaveiro (só o s2 gera).",
    expectedNote: "O bundle declara s1; o provider ainda guarda o valor do s1 só para verificar. Migrar = regerar a Evidence, nunca editar o bundle.",
    // fluxo REAL: o import e a Evidence nascem quando o s1 era o sal atual; depois o chaveiro rotaciona (s2 atual) e o s1 fica só para verificar
    build: (csv) => { const m = managed(csv, ["a"], "current"); return { built: m.built, options: { salt: { provider: keyring(["a", "b"]), userId: USER } } } },
  }),
  scenario({
    id: "salt-check-diverges",
    title: "saltCheck divergente, refs corretos (aviso)",
    what: "Os refs batem com o sal resolvido, mas o saltCheck declarado no bundle é de outro sal. O saltCheck NÃO é portão: os refs são conferidos de verdade.",
    expectedNote: "Veredito rebaixado (L_SALT_CHECK_DIVERGENT): autodeclaração incorreta, não prova de adulteração dos dados. Nunca fica atrás de um VERIFIED limpo.",
    build: (csv) => { const m = managed(csv, ["a"], "current"); return { built: { ...m.built, bundle: setDecl(m.built.bundle, "s1", saltCheck(demoSalt("outro"))) }, options: { salt: { provider: m.kr, userId: USER } } } },
  }),
  scenario({
    id: "salt-tampered-both",
    title: "Ref adulterado E saltCheck adulterado (selo refeito)",
    what: "Um ref é trocado e o saltCheck também, com o selo recalculado. Como o saltId resolve, o E5b usa o sal do provider e compara os refs de verdade.",
    expectedNote: "Reforçado por V_SALT_CHECK_MISMATCH. Nunca UNVERIFIABLE: quem adultera não escolhe a severidade do próprio ataque.",
    build: (csv) => { const m = managed(csv, ["a"], "current"); return { built: { ...m.built, bundle: tamperRef(setDecl(m.built.bundle, "s1", saltCheck(demoSalt("falso")))) }, options: { salt: { provider: m.kr, userId: USER } } } },
  }),
  scenario({
    id: "salt-id-unknown",
    title: "saltId que o provider não conhece",
    what: "O bundle declara um saltId (s2) que este chaveiro não tem, e nenhum sal conhecido do usuário reproduz os refs. (Ids são por usuário: um saltId que EXISTE com outro valor seria divergência real, SOURCE_MISMATCH.)",
    expectedNote: "S_SALT_UNKNOWN: NÃO é prova de integridade — nada que dependa do sal foi conferido. Um bundle adulterado com o saltId trocado cai aqui também (resíduo documentado).",
    // gerado sob o s2 de OUTRO chaveiro (sais x,y); o chaveiro que verifica só tem o s1 ⇒ o s2 declarado não existe nele
    build: (csv) => { const m = managed(csv, ["x", "y"], "current"); return { built: m.built, options: { salt: { provider: keyring(["a"]), userId: USER } } } },
  }),
  scenario({
    id: "salt-retired",
    title: "Sal aposentado",
    what: "O s1 foi aposentado (o valor foi apagado; o registro fica). O bundle antigo declara s1.",
    expectedNote: "S_SALT_RETIRED: sem o valor do sal os refs não são reproduzíveis. Regere a Evidence com o sal atual para voltar a verificar.",
    build: (csv) => { const m = managed(csv, ["a"], "current"); return { built: m.built, options: { salt: { provider: keyring(["a", "b"], ["s1"]), userId: USER } } } },
  }),
  scenario({
    id: "salt-id-wrong",
    title: "saltId declarado errado, refs de outro sal conhecido",
    what: "O bundle declara um saltId que não existe, mas os refs foram gerados com o s2, que o usuário tem. O E5b tenta os sais conhecidos antes de desistir.",
    expectedNote: "L_SALT_ID_NOT_RESOLVED: declaração errada, dados reproduzidos por outro sal conhecido. Não é prova de adulteração.",
    build: (csv) => {
      const kr = keyring(["a", "b"])
      const built = generate(csv, { accountRefSalt: demoSalt("b") }, demoSalt("b"))
      return { built: { ...built, bundle: setDecl(built.bundle, "s9", saltCheck(demoSalt("b"))) }, options: { salt: { provider: kr, userId: USER } } }
    },
  }),
  scenario({
    id: "salt-forgotten",
    title: "Legado: sal esquecido na geração (lacuna conhecida)",
    what: "Import com sal por string (sem saltCheck, legado) e Evidence gerada SEM repassar o sal. Sem saltId o verificador não sabe distinguir isso de adulteração.",
    expectedNote: "Parece adulteração; o texto do check traz a pista 'possível causa: sal não propagado'. Para imports gerenciados (saltCheck) a geração teria sido RECUSADA (E_SALT_REQUIRED).",
    build: (csv) => ({ built: generate(csv, { accountRefSalt: demoSalt("a") }, undefined), options: { accountRefSalt: demoSalt("a") } }),
  }),
]
