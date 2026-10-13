// UTILITÁRIO ÚNICO do sal para as capacidades (E6.6-7; sugestão do Marcelo depois de o guarda de sal barrar por detalhe textual duas vezes). Toda capacidade que chama
// `explainMetric`/`explainDerived` repassa o sal SÓ por `...generatorOpts(ctx)` e recusa import SALGADO sem sal por `saltMissing(ctx)`: o guarda reconhece essa forma
// de cara (test-evidence-salt-propagation, camadas 2 e 2d) e uma capacidade nova não precisa mais ajustar o estilo do repasse.
// Importa nada (nem Evidence): é só a regra. O VALOR do sal vem do servidor (ctx), nunca do modelo.

interface SaltContext { accountRefSalt?: string }
interface SaltedContext extends SaltContext { importRecords: ReadonlyArray<{ reproducibility?: { accountRefSalted?: boolean } }> }

/** Opções para os geradores de Evidence: o sal quando existe, nada quando não existe. */
export function generatorOpts(ctx: SaltContext): { opts: { accountRefSalt: string } } | Record<string, never> {
  return typeof ctx.accountRefSalt === "string" && ctx.accountRefSalt !== "" ? { opts: { accountRefSalt: ctx.accountRefSalt } } : {}
}

/** Import SALGADO sem o sal: gerar a Evidence assim daria refs sem sal e um falso SOURCE_MISMATCH (lacuna conhecida 3d do guarda de sal): a capacidade falha FECHADA. */
export function saltMissing(ctx: SaltedContext): boolean {
  return ctx.importRecords.some((r) => r.reproducibility?.accountRefSalted === true) && !(typeof ctx.accountRefSalt === "string" && ctx.accountRefSalt !== "")
}
