// Formatação de datas SEMPRE no fuso de Brasília (America/Sao_Paulo), via Intl nativo.
//
// Por quê: fixar o timezone garante que o SERVIDOR (UTC na Vercel) e o NAVEGADOR
// produzam exatamente a MESMA string. Isso (a) mata o hydration mismatch do React
// (erro #418, que acontecia quando o client formatava `new Date()` no fuso local e o
// server no UTC) e (b) deixa os horários consistentes em todo o app (antes o Dashboard
// mostrava 19:54 e o Journal 16:54 pro mesmo trade). Sem dependência nova.

const TZ = "America/Sao_Paulo"

function partsBR(date: Date | string | number) {
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(date))
  const g = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? ""
  return { yyyy: g("year"), MM: g("month"), dd: g("day"), HH: g("hour"), mm: g("minute") }
}

/** "16:54" */
export function formatTimeBR(date: Date | string | number) {
  const { HH, mm } = partsBR(date)
  return `${HH}:${mm}`
}

/** "15/07 16:54" */
export function formatDateTimeBR(date: Date | string | number) {
  const { dd, MM, HH, mm } = partsBR(date)
  return `${dd}/${MM} ${HH}:${mm}`
}

/** "15/07" */
export function formatShortDateBR(date: Date | string | number) {
  const { dd, MM } = partsBR(date)
  return `${dd}/${MM}`
}

/** "15/07/2026" */
export function formatDateBR(date: Date | string | number) {
  const { dd, MM, yyyy } = partsBR(date)
  return `${dd}/${MM}/${yyyy}`
}

/** "15/07/26 16:54" (ano com 2 dígitos) */
export function formatDateTimeShortYearBR(date: Date | string | number) {
  const { dd, MM, yyyy, HH, mm } = partsBR(date)
  return `${dd}/${MM}/${yyyy.slice(2)} ${HH}:${mm}`
}

/** "2026-07-15" — chave de dia NO FUSO BR (pra agrupar/comparar trades por dia sem erro de UTC) */
export function dayKeyBR(date: Date | string | number) {
  const { yyyy, MM, dd } = partsBR(date)
  return `${yyyy}-${MM}-${dd}`
}

/** "quarta-feira, 15 de julho de 2026" */
export function formatLongDateBR(date: Date | string | number) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(date))
}

/** "julho de 2026" */
export function formatMonthYearBR(date: Date | string | number) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, month: "long", year: "numeric" }).format(new Date(date))
}
