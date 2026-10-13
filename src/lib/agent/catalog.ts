// Catálogos de PROSA do agente (E6.6-3): dado puro, sem lógica. Frases pt-BR (proposta minha; revisão de redação como o O-G; os CÓDIGOS são o contrato).
// Usados só na resposta canônica de falha (motivo da última rejeição, consultas tentadas) e no rótulo do banner. Nenhum texto tem dígito, ref nem placeholder.
// Um teste (test-agent-turn.mts, T8) exige que as chaves de cada catálogo sejam EXATAMENTE o conjunto do contrato: item novo sem prosa derruba o build (sem texto de reserva).
import { CombinedVerdictSchema, type CapabilityId, type REJECTION_REASONS } from "./contract.ts"

/** Motivo da rejeição → frase que descreve a RESPOSTA do modelo (nunca o usuário). */
export const REJECTION_PHRASES: Readonly<Record<(typeof REJECTION_REASONS)[number], string>> = Object.freeze({
  REF_NOT_IN_LEDGER: "a resposta citava um resultado que não existe nesta conversa",
  SLOT_PATH_INVALID: "a resposta apontava para um dado que o resultado não tem",
  MODEL_ARITHMETIC: "a resposta fazia conta própria em vez de usar um resultado calculado",
  NUMBER_FROM_UNVERIFIED_EVIDENCE: "a resposta citava números de um resultado que não passou na verificação",
  MISSING_NOT_VERIFIED_LABEL: "a resposta não marcava como não verificado um valor ainda não conferido",
  UNVERIFIED_USED_FOR_CONCLUSION: "a resposta tirava conclusão de valores ainda não conferidos",
  REF_EPOCH_MIX: "a resposta misturava resultados de momentos de identificação diferentes",
  STALE_REF: "a resposta usava um resultado desatualizado",
  CAUSAL_CLAIM: "a resposta afirmava uma causa que os dados não sustentam",
  EXIT_REASON_OVERCLAIM: "a resposta tratava o motivo de saída como o tipo real da ordem",
  SCOPE_OVERCLAIM: "a resposta ia além da população analisada",
  MISSING_PARTIAL_PHRASE: "a resposta omitia o aviso de verificação parcial",
  INCONCLUSIVE_AS_CONCLUSIVE: "a resposta tratava como conclusivo um resultado de amostra pequena",
  INCOMPLETE_PRESENTED_AS_COMPLETE: "a resposta apresentava como completa uma apuração interrompida",
  TIE_OVERCLAIM: "a resposta falava em empate sem o motor marcar empate",
  STRUCTURE_INVALID: "a resposta veio fora do formato esperado",
  OPERATIONAL_ADVICE: "a resposta dava recomendação operacional",
  NUMBER_OUTSIDE_SLOT: "a resposta escrevia números fora do resultado calculado",
})

/** Capacidade → rótulo na linha "Consultas tentadas". */
export const CAPABILITY_LABELS: Readonly<Record<CapabilityId, string>> = Object.freeze({
  "metrics.query@1": "consulta de métricas",
  "metrics.groups@1": "métricas por grupo",
  "exit.breakdown@1": "quebra por motivo de saída",
  "metrics.compare@1": "comparação de grupos ou períodos",
  "rank.groups@1": "ranking de grupos",
  "exit.analysis@1": "análise por motivo de saída",
  "evidence.explain@1": "detalhe dos trades",
  "evidence.refresh@1": "regeração da evidência",
})

const C = CombinedVerdictSchema.enum // os valores vêm do enum do contrato (o guarda G2 proíbe literal de veredito fora de verdict.ts/contract.ts)
/** Veredito combinado → rótulo do banner da resposta. */
export const BANNER_LABELS: Readonly<Record<keyof typeof C, string>> = Object.freeze({
  [C.VERIFIED]: "Verificado",
  [C.VERIFIED_PARTIAL]: "Verificado parcialmente",
  [C.NOT_VERIFIED]: "Não verificado",
  [C.TAMPERED_OR_MISMATCH]: "Não confere",
})
