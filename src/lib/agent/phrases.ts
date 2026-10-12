// Catálogo de FRASES CANÔNICAS do agente (agent-capabilities.md §5.5 e §6). DADOS, não comportamento: o servidor renderiza estas frases; o modelo só
// escolhe o código (`phrase` segment) e nunca escreve texto de limitação (D9). Sem frase de reserva: código sem frase aqui é erro de build do catálogo (SG3).
// Redação final = O-G (a prosa pode mudar sem mudar o contrato; o conjunto de CÓDIGOS é fixo e derivado do código-fonte dos verificadores).

/** Texto ESTRUTURAL (A1): infraestrutura de verificação (arquivo original armazenado) ainda não existe. UM texto, idêntico em toda resposta, em posição fixa. */
export const STRUCTURAL_TEXT =
  "Este valor foi calculado pelo motor do MeuTrade, mas ainda não foi conferido contra o arquivo original que você importou: essa verificação ainda não está disponível."

/** Frases ESPECÍFICAS (A1): uma por código `S_*` que bloqueia (⇒ UNVERIFIABLE) em verify.ts/verify-source.ts. */
export const SPECIFIC_PHRASES = {
  S_SOURCE_NOT_PROVIDED: "O arquivo original deste cálculo não foi fornecido para a conferência.",
  S_ENCODING_UNSUPPORTED: "O arquivo original não pôde ser lido na codificação registrada; a conferência contra ele não foi feita.",
  S_VERSION_INCOMPATIBLE: "Este cálculo foi feito com uma versão do motor/leitor diferente da atual e não pode ser reproduzido; isso não indica erro nos dados.",
  S_CONTEXT_INSUFFICIENT: "Faltou o contexto da importação (por exemplo, o mapa de motivos de saída que você definiu) para reproduzir o cálculo.",
  S_REINGEST_FAILED: "Não foi possível refazer a importação a partir do arquivo para conferir o cálculo.",
  S_FILE_NOT_VERIFIED: "O arquivo fornecido não pôde ser validado antes da conferência; nada que dependa dele foi checado.",
  S_ACCOUNT_REF_UNVERIFIED: "Sem o sal de identificação das contas não dá para conferir a ligação deste valor às suas contas.",
  S_ROWHASH_MISSING: "Faltam as marcas de linha necessárias para ligar este valor ao arquivo.",
  S_NO_IMPORTS: "Este valor não tem nenhuma importação associada; não há arquivo a conferir.",
  S_DERIVED_TRADES_NOT_VERIFIED: "Parte dos trades que sustentam esta análise não pôde ser conferida com o arquivo.",
  S_SALT_UNKNOWN: "Não há mais sal conhecido que reproduza as identificações deste valor; isto não é prova de integridade (nada que dependa do sal foi conferido).",
  S_SALT_RETIRED: "O sal usado neste valor foi aposentado; regere a análise para voltar a conferi-la.",
  S_NO_METRICS: "Não há métrica neste resultado para conferir.",
  S_HASH_ONLY: "A população é grande demais para ser listada: só a assinatura dela foi conferida, não cada trade.",
  S_REFS_BROKEN: "As referências internas deste resultado estão incompletas; a conferência não pôde ser feita.",
  S_PROVENANCE_INCOMPLETE: "A origem deste cálculo está incompleta; a conferência de proveniência não pôde ser feita.",
  S_ASSOCIATION_UNVERIFIABLE: "A associação deste grupo (por exemplo, por estratégia) não tem referência no resultado e não pôde ser conferida.",
  S_ORDER_NOT_RECORDED: "A ordem em que os trades foram processados não foi registrada; a conferência da sequência não foi feita.",
  S_NO_ANCHOR_CHECK: "Não há âncora numérica para conferir este valor.",
  S_QUERY_INVALID: "A consulta registrada neste resultado é inválida; o valor não pôde ser reproduzido.",
  S_CHECK_NOT_EXECUTED: "Uma das conferências não foi executada; por segurança o valor é tratado como não verificado.",
} as const

/** Verificação PARCIAL (`VERIFIED_PARTIAL`). */
export const PARTIAL_PHRASES = {
  S_POPULATION_PARTIAL: "Só parte da população foi conferida contra o arquivo; trate como indicativo.",
  L_SALT_CHECK_DIVERGENT: "A conferência bateu, mas o bundle traz uma autodeclaração de sal incorreta; os dados conferem, o aviso deve ser investigado.",
  L_SALT_ID_NOT_RESOLVED: "A conferência bateu com outro sal seu; a identificação de sal declarada no bundle estava errada.",
} as const

/** Integridade (`TAMPERED_OR_MISMATCH`, `INVALID_FORMAT`): sem especular causa, sem acusar o usuário. */
export const INTEGRITY_PHRASES = {
  INTEGRITY_SEAL: "O resultado não confere com o seu próprio selo de integridade; não vou citar números dele. Vou pedir que seja regerado.",
  INTEGRITY_SOURCE: "O resultado não confere com o arquivo original; não vou citar números dele. Vou pedir que seja regerado.",
  INTEGRITY_FORMAT: "O resultado está ilegível ou fora do formato; não vou citar números dele.",
} as const

/** Escopo (`{n}` é o ÚNICO placeholder permitido; preenchido pelo servidor a partir do handle). */
export const SCOPE_PHRASES = {
  POPULATION_DECLARED: "Considerando a população declarada de {n} trades.",
  INDICATIVE_ONLY: "Resultado indicativo, não conclusivo.",
} as const

/** Motivos de parada (§5.5). */
export const STOP_PHRASES = {
  BUDGET_LIMIT_REACHED: "Atingi o limite de consultas deste turno. Abaixo está o que apurei até aqui; o restante não foi apurado.",
  REGEN_EXHAUSTED: "Não consigo afirmar isso com evidência verificável agora.",
  CAPABILITY_FAILED: "Uma consulta falhou e não consegui apurar essa parte.",
} as const

export const STRUCTURAL_CODE = "VERIFICATION_INFRA_MISSING" as const

/** Todas as frases por código (o texto estrutural entra com o código `VERIFICATION_INFRA_MISSING`). */
export const PHRASES = {
  [STRUCTURAL_CODE]: STRUCTURAL_TEXT,
  ...SPECIFIC_PHRASES,
  ...PARTIAL_PHRASES,
  ...INTEGRITY_PHRASES,
  ...SCOPE_PHRASES,
  ...STOP_PHRASES,
} as const

export type PhraseCode = keyof typeof PHRASES
export const PHRASE_CODES = Object.keys(PHRASES) as [PhraseCode, ...PhraseCode[]]
