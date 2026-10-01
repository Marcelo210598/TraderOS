// Tempo no domínio canônico do MeuTrade.
//
// Regra (docs/ai-partner/data-contract.md §Tempo):
//   1) timestamps são guardados em UTC (ISO "…Z"); o horário local é DERIVADO só p/ análise/exibição;
//   2) uma hora NUNCA é inventada: data sem hora = DATE_ONLY com instante nulo (não vira 12:00Z);
//   3) texto sem fuso só é convertido com um fuso de origem EXPLÍCITO (sourceTz) — sem ele, erro;
//   4) data com barra (a/b/aaaa) só é lida com a ordem (DMY/MDY) conhecida — ambígua sem dica = erro;
//   5) horário de verão/transições são tratados de verdade (Intl/IANA), não por offset fixo.
// Sem dependências externas.

/**
 * Fuso padrão do MeuTrade (análise do trader E fuso de origem de import quando o usuário não informa outro).
 * Armazenamento interno é sempre UTC. Sessão/calendário CME usam America/New_York (ver `legacySessionType`).
 * Quando este padrão é usado como fuso de ORIGEM, o import registra `sourceTzOrigin = "DEFAULT"` e avisa — não é silencioso.
 */
export const DEFAULT_USER_TIME_ZONE = "America/Sao_Paulo"

export type DateOrder = "MDY" | "DMY" | "YMD"
export type TimePrecision = "DATETIME" | "DATE_ONLY" | "UNKNOWN"
export type FoldAmbiguity = "NONE" | "FOLD_EARLIER_ASSUMED" | "FOLD_LATER_ASSUMED"
export type FoldPolicy = "EARLIER" | "LATER"

export interface TimeValue {
  /** Texto exatamente como veio da fonte (auditoria). */
  raw: string
  precision: TimePrecision
  /** Instante em UTC, ISO com ms e "Z". Null quando só há data (DATE_ONLY) ou nada (UNKNOWN). */
  instantUtc: string | null
  /** Data civil "YYYY-MM-DD" na ORIGEM (para DATE_ONLY é a única informação temporal). */
  localDate: string | null
  /** Fuso de origem usado na conversão; null se o texto já trazia offset explícito ou não há hora. */
  sourceTz: string | null
  explicitOffset: boolean
  ambiguity: FoldAmbiguity
}

export type TimeErrorCode =
  | "E_TIME_EMPTY"
  | "E_TIME_FORMAT"
  | "E_DATE_INVALID"
  | "E_DATE_ORDER_REQUIRED"
  | "E_TZ_REQUIRED"
  | "E_TZ_INVALID"
  | "E_TIME_GAP"

export type TimeParseResult = { ok: true; value: TimeValue } | { ok: false; code: TimeErrorCode; message: string }

export const UNKNOWN_TIME: TimeValue = {
  raw: "",
  precision: "UNKNOWN",
  instantUtc: null,
  localDate: null,
  sourceTz: null,
  explicitOffset: false,
  ambiguity: "NONE",
}

// ── Fusos (Intl/IANA) ───────────────────────────────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    fmtCache.set(tz, f)
  }
  return f
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

interface WallParts {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

function wallParts(tz: string, utcMs: number): WallParts {
  const parts = formatter(tz).formatToParts(new Date(utcMs))
  const n = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? "0")
  const h = n("hour")
  return { y: n("year"), mo: n("month"), d: n("day"), h: h === 24 ? 0 : h, mi: n("minute"), s: n("second") }
}

/** Offset (minutos a leste de UTC) do fuso no instante dado. Ex.: America/Sao_Paulo em jan/2026 = -180. */
export function zoneOffsetMinutes(tz: string, utcMs: number): number {
  const w = wallParts(tz, utcMs)
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000)
}

interface Resolution {
  utcMs: number
  ambiguity: FoldAmbiguity
}

/**
 * Hora de parede local → instante UTC, com verão.
 *  - lacuna (spring forward, hora que não existe) → null (o chamador reporta E_TIME_GAP);
 *  - repetição (fall back, hora que acontece 2×) → escolhe conforme a política e SINALIZA a ambiguidade.
 */
function localWallToUtc(w: WallParts, ms: number, tz: string, policy: FoldPolicy): Resolution | null {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s, ms)
  const offsets = new Set([zoneOffsetMinutes(tz, guess - 86400000), zoneOffsetMinutes(tz, guess + 86400000)])
  const valid: number[] = []
  for (const off of offsets) {
    const cand = guess - off * 60000
    if (zoneOffsetMinutes(tz, cand) === off) valid.push(cand)
  }
  if (valid.length === 0) return null
  valid.sort((a, b) => a - b)
  if (valid.length === 1) return { utcMs: valid[0], ambiguity: "NONE" }
  return policy === "EARLIER"
    ? { utcMs: valid[0], ambiguity: "FOLD_EARLIER_ASSUMED" }
    : { utcMs: valid[valid.length - 1], ambiguity: "FOLD_LATER_ASSUMED" }
}

// ── Parsing de texto de data/hora ──────────────────────────────────────────

const TIME_PART = String.raw`(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:\s*([AaPp][Mm]))?`
const ZONE_PART = String.raw`(Z|z|[+-]\d{2}:?\d{2})`
const RE_YMD = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[Tt\s]+${TIME_PART}(?:\s*${ZONE_PART})?)?$`)
const RE_XYZ = new RegExp(String.raw`^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:[Tt\s]+${TIME_PART}(?:\s*${ZONE_PART})?)?$`)

function validCivilDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) return false
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0")
const ymd = (y: number, mo: number, d: number) => `${pad(y, 4)}-${pad(mo)}-${pad(d)}`

export interface ParseTimeOptions {
  /** Ordem da data com barra/ponto. Obrigatória quando a data é ambígua (ambos ≤ 12). */
  dateOrder?: DateOrder
  /** Fuso IANA de onde o texto foi gerado (ex.: o fuso do PC que exportou). Obrigatório se o texto não trouxer offset. */
  tz?: string | null
  /** Em fim de horário de verão a mesma hora ocorre 2×. Padrão EARLIER (e sinaliza a ambiguidade). */
  foldPolicy?: FoldPolicy
}

function fail(code: TimeErrorCode, message: string): TimeParseResult {
  return { ok: false, code, message }
}

export function parseLocalDateTime(text: string | null | undefined, opts: ParseTimeOptions = {}): TimeParseResult {
  const raw = (text ?? "").trim()
  if (!raw) return fail("E_TIME_EMPTY", "Data/hora vazia.")

  let y: number, mo: number, d: number
  let timeStart: number
  let m = raw.match(RE_YMD)
  if (m) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); timeStart = 4
  } else {
    m = raw.match(RE_XYZ)
    if (!m) return fail("E_TIME_FORMAT", `Formato de data/hora não reconhecido: "${raw}".`)
    const a = Number(m[1]), b = Number(m[2])
    y = Number(m[3])
    timeStart = 4
    let order = opts.dateOrder
    if (!order || order === "YMD") {
      if (a > 12 && b <= 12) order = "DMY"
      else if (b > 12 && a <= 12) order = "MDY"
      else if (a <= 12 && b <= 12 && a !== b) {
        return fail("E_DATE_ORDER_REQUIRED", `Data ambígua "${raw}": pode ser dia/mês ou mês/dia. Informe a ordem (DMY ou MDY) — não vamos adivinhar.`)
      } else if (a === b) order = "DMY" // 05/05: a ordem não muda o resultado
      else return fail("E_DATE_INVALID", `Data inválida: "${raw}".`)
    }
    if (order === "DMY") { d = a; mo = b } else { mo = a; d = b }
  }
  if (!validCivilDate(y, mo, d)) return fail("E_DATE_INVALID", `Data inválida: "${raw}".`)
  const localDate = ymd(y, mo, d)

  // Só data → DATE_ONLY. Sem inventar hora.
  if (m[timeStart] === undefined) {
    return {
      ok: true,
      value: { raw, precision: "DATE_ONLY", instantUtc: null, localDate, sourceTz: null, explicitOffset: false, ambiguity: "NONE" },
    }
  }

  let hh = Number(m[timeStart])
  const mi = Number(m[timeStart + 1])
  const ss = m[timeStart + 2] !== undefined ? Number(m[timeStart + 2]) : 0
  const frac = m[timeStart + 3]
  const msPart = frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0
  const ampm = m[timeStart + 4]?.toUpperCase()
  const zone = m[timeStart + 5]

  if (ampm) {
    if (hh < 1 || hh > 12) return fail("E_DATE_INVALID", `Hora inválida com AM/PM: "${raw}".`)
    if (ampm === "AM") hh = hh === 12 ? 0 : hh
    else hh = hh === 12 ? 12 : hh + 12
  }
  if (hh > 23 || mi > 59 || ss > 59) return fail("E_DATE_INVALID", `Hora inválida: "${raw}".`)

  // Offset explícito no texto (Z, +03:00): instante absoluto; fuso de origem irrelevante.
  if (zone) {
    let offMin = 0
    if (zone.toUpperCase() !== "Z") {
      const sign = zone[0] === "-" ? -1 : 1
      const digits = zone.slice(1).replace(":", "")
      offMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)))
    }
    const utcMs = Date.UTC(y, mo - 1, d, hh, mi, ss, msPart) - offMin * 60000
    return {
      ok: true,
      value: {
        raw, precision: "DATETIME", instantUtc: new Date(utcMs).toISOString(), localDate,
        sourceTz: null, explicitOffset: true, ambiguity: "NONE",
      },
    }
  }

  const tz = opts.tz
  if (!tz) return fail("E_TZ_REQUIRED", `"${raw}" não traz fuso e nenhum fuso de origem foi informado. Informe o fuso do arquivo (ex.: America/Sao_Paulo).`)
  if (!isValidTimeZone(tz)) return fail("E_TZ_INVALID", `Fuso inválido: "${tz}".`)

  const res = localWallToUtc({ y, mo, d, h: hh, mi, s: ss }, msPart, tz, opts.foldPolicy ?? "EARLIER")
  if (!res) return fail("E_TIME_GAP", `"${raw}" não existe em ${tz} (transição de horário de verão).`)
  return {
    ok: true,
    value: {
      raw, precision: "DATETIME", instantUtc: new Date(res.utcMs).toISOString(), localDate,
      sourceTz: tz, explicitOffset: false, ambiguity: res.ambiguity,
    },
  }
}

/**
 * Decide a ordem de data de um ARQUIVO inteiro olhando várias amostras (nunca uma linha só).
 * Retorna null se for ambíguo ou inconsistente — o chamador então exige a ordem do usuário.
 */
export function inferDateOrder(samples: string[]): DateOrder | null {
  let sawDmy = false, sawMdy = false, sawYmd = false
  for (const s of samples) {
    const t = s.trim()
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(t)) { sawYmd = true; continue }
    const m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{4}/)
    if (!m) continue
    const a = Number(m[1]), b = Number(m[2])
    if (a > 12 && b <= 12) sawDmy = true
    else if (b > 12 && a <= 12) sawMdy = true
  }
  const n = Number(sawDmy) + Number(sawMdy) + Number(sawYmd)
  if (n !== 1) return null
  return sawDmy ? "DMY" : sawMdy ? "MDY" : "YMD"
}

// ── Derivados (só p/ análise/exibição — nunca gravados como verdade) ─────────

export interface LocalParts {
  date: string
  time: string
  hour: number
  minute: number
  /** 0 = domingo … 6 = sábado, no fuso pedido. */
  weekday: number
  offsetMinutes: number
  /** "YYYY-MM-DDTHH:mm:ss±hh:mm" */
  iso: string
}

export function toLocal(instantUtc: string, tz: string): LocalParts {
  const ms = Date.parse(instantUtc)
  if (Number.isNaN(ms)) throw new RangeError(`Instante inválido: ${instantUtc}`)
  const w = wallParts(tz, ms)
  const off = zoneOffsetMinutes(tz, ms)
  const sign = off < 0 ? "-" : "+"
  const abs = Math.abs(off)
  const date = ymd(w.y, w.mo, w.d)
  const time = `${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`
  return {
    date,
    time,
    hour: w.h,
    minute: w.mi,
    weekday: new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay(),
    offsetMinutes: off,
    iso: `${date}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  }
}

export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d + n))
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

export function durationSeconds(entryUtc: string | null, exitUtc: string | null): number | null {
  if (!entryUtc || !exitUtc) return null
  return Math.round((Date.parse(exitUtc) - Date.parse(entryUtc)) / 1000)
}

export interface TradingDayOptions {
  /** Fuso da bolsa (padrão America/Chicago). */
  tz?: string
  /** Hora local em que o pregão seguinte começa (CME index: 17:00 CT). */
  rollHour?: number
}

/**
 * Dia de pregão da bolsa. Convenção CME (equity index): a sessão que abre às 17:00 CT pertence ao dia SEGUINTE.
 *   dom 17:00 CT → segunda; seg–qui ≥ 17:00 → dia seguinte; sex ≥ 17:00, sábado e dom < 17:00 → null (mercado fechado).
 * Isso resolve "overnight" e trades que atravessam a meia-noite sem depender do fuso do usuário.
 */
export function tradingDay(instantUtc: string, opts: TradingDayOptions = {}): string | null {
  const tz = opts.tz ?? "America/Chicago"
  const roll = opts.rollHour ?? 17
  const l = toLocal(instantUtc, tz)
  const closed = (l.weekday === 5 && l.hour >= roll) || l.weekday === 6 || (l.weekday === 0 && l.hour < roll)
  if (closed) return null
  return l.hour >= roll ? addDays(l.date, 1) : l.date
}

export type LegacySession = "AM" | "PM" | "OVERNIGHT"

/** Mesma regra do `detectSession` legado do sync NT8 (ET: 9–12 AM, 12–17 PM, resto OVERNIGHT), mas sobre um UTC correto. */
export function legacySessionType(instantUtc: string): LegacySession {
  const h = toLocal(instantUtc, "America/New_York").hour
  if (h >= 9 && h < 12) return "AM"
  if (h >= 12 && h < 17) return "PM"
  return "OVERNIGHT"
}
