// Pin de dataset por spec (E7-4, D-B2): o conjunto EXATO de arquivos (e as preferências de análise) com que uma consulta foi feita. Sem ele, regenerar a Evidence com "os arquivos de hoje" daria
// outro `evidenceRef` (medido: arquivo novo, `analysis.timeZone` e `analysis.minSample` mudam o ref). Forma canônica: `sources` ordenado por `fileSha256` (a ordem em que o pin foi pedido nunca importa).
// Puro, sem dependências. Inválido ⇒ null (sem eco).
export const MAX_PIN_SOURCES = 10
const SHA_RE = /^[0-9a-f]{64}$/
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

export interface DatasetPin {
  readonly sources: ReadonlyArray<{ readonly fileSha256: string }>
  readonly analysis: { readonly timeZone?: string; readonly minSample?: number }
}

function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz === "" || tz.length > 64) return false
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true } catch { return false }
}

/** Valida e devolve uma CÓPIA canônica (sources ordenado), ou null. */
export function parseDatasetPin(x: unknown): DatasetPin | null {
  try {
    if (!isRecord(x) || Object.keys(x).sort().join(",") !== "analysis,sources") return null
    const { sources, analysis } = x
    if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_PIN_SOURCES) return null
    const shas: string[] = []
    for (const s of sources) {
      if (!isRecord(s) || Object.keys(s).join(",") !== "fileSha256" || typeof s.fileSha256 !== "string" || !SHA_RE.test(s.fileSha256)) return null
      shas.push(s.fileSha256)
    }
    if (new Set(shas).size !== shas.length) return null
    if (!isRecord(analysis) || Object.keys(analysis).some((k) => k !== "timeZone" && k !== "minSample")) return null
    const out: { timeZone?: string; minSample?: number } = {}
    if (Object.hasOwn(analysis, "timeZone")) { if (!validTimeZone(analysis.timeZone)) return null; out.timeZone = analysis.timeZone }
    if (Object.hasOwn(analysis, "minSample")) {
      const m = analysis.minSample
      if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 100_000) return null
      out.minSample = m
    }
    return { sources: [...shas].sort().map((fileSha256) => ({ fileSha256 })), analysis: out }
  } catch {
    return null
  }
}
