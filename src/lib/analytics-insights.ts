// Cálculos puros da seção Analytics (diagnósticos + simulador "E se").
// Sem React / sem Prisma — roda no servidor (page) e no client (simulador).

import { dayKeyBR } from "@/lib/date"

export interface InsightTrade {
  date: number // ms epoch
  pnl: number
  pnlPoints: number
  result: "WIN" | "LOSS" | "BREAKEVEN"
  mfe: number | null
  mae: number | null
}

export const MIN_SAMPLE = 30 // abaixo disso padrão é indicativo, não conclusivo
export const MIN_BUCKET = 3 // mínimo de trades num grupo pra tirar conclusão

const TZ = "America/Sao_Paulo"
const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

export function hourBR(ms: number) {
  const h = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date(ms))
  return Number(h) % 24
}

export function dowBR(ms: number) {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date(ms))
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w)
}

export const dowLabel = (d: number) => DOW_LABELS[d]

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)

function percentile(xs: number[], p: number) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))
  return s[idx]
}

// $ por ponto de cada trade (pnl / pontos). Trade com 0 pontos usa a mediana dos demais.
export function dollarsPerPoint(trades: InsightTrade[]): number[] {
  const known = trades.filter((t) => t.pnlPoints !== 0).map((t) => Math.abs(t.pnl / t.pnlPoints))
  const fallback = percentile(known, 0.5)
  return trades.map((t) => (t.pnlPoints !== 0 ? Math.abs(t.pnl / t.pnlPoints) : fallback))
}

// ── Métricas de uma série de P&L ─────────────────────────────────────────────
export interface SeriesMetrics {
  total: number
  count: number
  winRate: number
  profitFactor: number // 99 = sem perdas
  maxDrawdown: number
  cum: number[]
}

export function seriesMetrics(pnls: number[], kept: boolean[]): SeriesMetrics {
  let cum = 0
  let peak = 0
  let maxDD = 0
  const cumSeries: number[] = []
  let wins = 0
  let count = 0
  let gross = 0
  let loss = 0
  pnls.forEach((p, i) => {
    if (kept[i]) {
      cum += p
      count++
      if (p > 0) { wins++; gross += p } else if (p < 0) loss += -p
      if (cum > peak) peak = cum
      if (peak - cum > maxDD) maxDD = peak - cum
    }
    cumSeries.push(Math.round(cum * 100) / 100)
  })
  return {
    total: cum,
    count,
    winRate: count ? Math.round((wins / count) * 100) : 0,
    profitFactor: loss > 0 ? gross / loss : gross > 0 ? 99 : 0,
    maxDrawdown: maxDD,
    cum: cumSeries,
  }
}

// ── Simulador ────────────────────────────────────────────────────────────────
export interface ScenarioOpts {
  stopPts?: number
  targetPts?: number
  maxLossesPerDay?: number
  maxTradesPerDay?: number
  excludeHour?: number
  excludeDow?: number
  dropWorstLosses?: number
}

// Regras do modelo (conservadoras de propósito):
//  • Stop S: se o MAE do trade ≥ S, o trade teria sido stopado em -S (inclusive trades que
//    depois viraram win — o stop mais curto também os corta).
//  • Alvo T: se o MFE ≥ T, o trade teria saído em +T (inclusive trades que viraram loss).
//  • Stop e alvo juntos e ambos atingidos: não dá pra saber quem veio primeiro → assume o stop.
//  • Trade sem MFE/MAE registrado fica como foi.
export function simulate(trades: InsightTrade[], opts: ScenarioOpts): { pnls: number[]; kept: boolean[] } {
  const perPt = dollarsPerPoint(trades)
  const pnls = trades.map((t, i) => {
    const mae = t.mae != null ? Math.abs(t.mae) : null
    const mfe = t.mfe != null ? Math.abs(t.mfe) : null
    const hitStop = opts.stopPts != null && mae != null && mae >= opts.stopPts
    const hitTarget = opts.targetPts != null && mfe != null && mfe >= opts.targetPts
    if (hitStop) return -opts.stopPts! * perPt[i]
    if (hitTarget) return opts.targetPts! * perPt[i]
    return t.pnl
  })

  const kept = trades.map(() => true)

  if (opts.excludeHour != null) trades.forEach((t, i) => { if (hourBR(t.date) === opts.excludeHour) kept[i] = false })
  if (opts.excludeDow != null) trades.forEach((t, i) => { if (dowBR(t.date) === opts.excludeDow) kept[i] = false })

  if (opts.dropWorstLosses) {
    const worst = pnls
      .map((p, i) => ({ p, i }))
      .filter((x) => x.p < 0 && kept[x.i])
      .sort((a, b) => a.p - b.p)
      .slice(0, opts.dropWorstLosses)
    worst.forEach((x) => { kept[x.i] = false })
  }

  if (opts.maxLossesPerDay != null || opts.maxTradesPerDay != null) {
    const perDay = new Map<string, { trades: number; losses: number }>()
    trades.forEach((t, i) => {
      if (!kept[i]) return
      const key = dayKeyBR(t.date)
      const st = perDay.get(key) ?? { trades: 0, losses: 0 }
      const blockedByLosses = opts.maxLossesPerDay != null && st.losses >= opts.maxLossesPerDay
      const blockedByCount = opts.maxTradesPerDay != null && st.trades >= opts.maxTradesPerDay
      if (blockedByLosses || blockedByCount) {
        kept[i] = false
      } else {
        st.trades++
        if (pnls[i] < 0) st.losses++
      }
      perDay.set(key, st)
    })
  }

  return { pnls, kept }
}

export function runScenario(trades: InsightTrade[], opts: ScenarioOpts) {
  const { pnls, kept } = simulate(trades, opts)
  return seriesMetrics(pnls, kept)
}

// Passo "redondo" pra grade de busca (1, 2, 2.5, 5 × 10^n)
function niceStep(max: number, buckets = 30) {
  const raw = Math.max(max / buckets, 0.01)
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const base = [1, 2, 2.5, 5, 10].find((b) => b * pow >= raw) ?? 10
  return base * pow
}

export function pointGrid(max: number) {
  if (max <= 0) return { step: 1, values: [] as number[] }
  const step = niceStep(max)
  const values: number[] = []
  for (let v = step; v <= max + step / 2; v += step) values.push(Math.round(v * 100) / 100)
  return { step, values }
}

// Melhor valor histórico (uma variável por vez). É retrospectivo — serve de pista, não de garantia.
export function bestParam(trades: InsightTrade[], kind: "stopPts" | "targetPts", values: number[], base: ScenarioOpts = {}) {
  let best: { value: number; total: number } | null = null
  for (const v of values) {
    const m = runScenario(trades, { ...base, [kind]: v })
    if (!best || m.total > best.total) best = { value: v, total: m.total }
  }
  return best
}

// ── Diagnóstico de entrada (MAE) ─────────────────────────────────────────────
export interface EntryDiagnosis {
  winCount: number
  lossCount: number
  avgMaeWin: number
  avgMaeLoss: number
  p80MaeWin: number
  maxMaeWin: number
  verdict: "tight" | "sufoco" | "ok" | "few"
}

export function entryDiagnosis(trades: InsightTrade[]): EntryDiagnosis | null {
  const withMae = trades.filter((t) => t.mae != null)
  const wins = withMae.filter((t) => t.pnl > 0).map((t) => Math.abs(t.mae!))
  const losses = withMae.filter((t) => t.pnl < 0).map((t) => Math.abs(t.mae!))
  if (!withMae.length) return null
  const avgMaeWin = avg(wins)
  const avgMaeLoss = avg(losses)
  let verdict: EntryDiagnosis["verdict"] = "ok"
  if (wins.length < MIN_BUCKET || losses.length < MIN_BUCKET) verdict = "few"
  else if (avgMaeWin <= avgMaeLoss * 0.4) verdict = "tight"
  else if (avgMaeWin >= avgMaeLoss * 0.7) verdict = "sufoco"
  return {
    winCount: wins.length,
    lossCount: losses.length,
    avgMaeWin,
    avgMaeLoss,
    p80MaeWin: percentile(wins, 0.8),
    maxMaeWin: wins.length ? Math.max(...wins) : 0,
    verdict,
  }
}

// ── Lucro deixado na mesa (MFE vs saída) ─────────────────────────────────────
export interface LeakRow {
  date: number
  result: InsightTrade["result"]
  mfe: number
  exitPts: number
  leftUsd: number
}

export interface ExitLeak {
  tradesUsed: number
  leftOnWinsUsd: number
  lossesWereGreen: number // losses que chegaram a andar ≥50% do ganho médio a favor
  lossesGreenUsd: number
  top: LeakRow[]
}

export function exitLeak(trades: InsightTrade[]): ExitLeak | null {
  const perPt = dollarsPerPoint(trades)
  const withMfe = trades.map((t, i) => ({ t, i })).filter((x) => x.t.mfe != null && Math.abs(x.t.mfe!) > 0)
  if (!withMfe.length) return null

  const winPts = trades.filter((t) => t.pnl > 0 && t.pnlPoints > 0).map((t) => t.pnlPoints)
  const avgWinPts = avg(winPts)

  const rows: LeakRow[] = []
  let leftOnWins = 0
  let lossesGreen = 0
  let lossesGreenUsd = 0
  for (const { t, i } of withMfe) {
    const mfe = Math.abs(t.mfe!)
    if (t.pnl > 0) {
      const left = Math.max(0, mfe - t.pnlPoints) * perPt[i]
      leftOnWins += left
      rows.push({ date: t.date, result: t.result, mfe, exitPts: t.pnlPoints, leftUsd: left })
    } else if (t.pnl < 0 && avgWinPts > 0 && mfe >= avgWinPts * 0.5) {
      // loss que já esteve no verde: o que teria sido "sair no meio" vs o que perdeu
      const left = (mfe - t.pnlPoints) * perPt[i]
      lossesGreen++
      lossesGreenUsd += left
      rows.push({ date: t.date, result: t.result, mfe, exitPts: t.pnlPoints, leftUsd: left })
    }
  }
  rows.sort((a, b) => b.leftUsd - a.leftUsd)
  return { tradesUsed: withMfe.length, leftOnWinsUsd: leftOnWins, lossesWereGreen: lossesGreen, lossesGreenUsd, top: rows.slice(0, 5) }
}

// ── Horário ──────────────────────────────────────────────────────────────────
export interface BucketStat {
  key: number
  total: number
  wins: number
  pnl: number
  avgPnl: number
  winRate: number
}

function bucketize(trades: InsightTrade[], keyOf: (t: InsightTrade) => number): BucketStat[] {
  const map = new Map<number, { total: number; wins: number; pnl: number }>()
  for (const t of trades) {
    const k = keyOf(t)
    const cur = map.get(k) ?? { total: 0, wins: 0, pnl: 0 }
    map.set(k, { total: cur.total + 1, wins: cur.wins + (t.pnl > 0 ? 1 : 0), pnl: cur.pnl + t.pnl })
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v, avgPnl: v.pnl / v.total, winRate: Math.round((v.wins / v.total) * 100) }))
    .sort((a, b) => a.key - b.key)
}

export const hourStats = (trades: InsightTrade[]) => bucketize(trades, (t) => hourBR(t.date))
export const dowStats = (trades: InsightTrade[]) => bucketize(trades, (t) => dowBR(t.date))

// ── Comportamento pós-loss ───────────────────────────────────────────────────
export interface FollowStat { total: number; wins: number; pnl: number; winRate: number; avgPnl: number }

const followStat = (xs: InsightTrade[]): FollowStat => {
  const wins = xs.filter((t) => t.pnl > 0).length
  const pnl = sum(xs.map((t) => t.pnl))
  return { total: xs.length, wins, pnl, winRate: xs.length ? Math.round((wins / xs.length) * 100) : 0, avgPnl: xs.length ? pnl / xs.length : 0 }
}

export interface AfterLoss {
  afterLoss: FollowStat
  afterWin: FollowStat
  quickAfterLoss: FollowStat // até 15 min depois de um loss (revenge)
  overtradingDays: { days: number; avgDayPnl: number; otherAvgDayPnl: number; threshold: number } | null
  avgTradesPerDay: number
}

export function afterLoss(trades: InsightTrade[]): AfterLoss {
  const afterLossT: InsightTrade[] = []
  const afterWinT: InsightTrade[] = []
  const quick: InsightTrade[] = []
  for (let i = 1; i < trades.length; i++) {
    const prev = trades[i - 1]
    const cur = trades[i]
    if (dayKeyBR(prev.date) !== dayKeyBR(cur.date)) continue // só dentro do mesmo dia
    if (prev.pnl < 0) {
      afterLossT.push(cur)
      if ((cur.date - prev.date) / 60000 <= 15) quick.push(cur)
    } else if (prev.pnl > 0) afterWinT.push(cur)
  }

  const days = new Map<string, { n: number; pnl: number }>()
  for (const t of trades) {
    const k = dayKeyBR(t.date)
    const cur = days.get(k) ?? { n: 0, pnl: 0 }
    days.set(k, { n: cur.n + 1, pnl: cur.pnl + t.pnl })
  }
  const all = [...days.values()]
  const avgPerDay = avg(all.map((d) => d.n))
  const threshold = Math.max(3, Math.ceil(avgPerDay * 1.5))
  const heavy = all.filter((d) => d.n >= threshold)
  const light = all.filter((d) => d.n < threshold)

  return {
    afterLoss: followStat(afterLossT),
    afterWin: followStat(afterWinT),
    quickAfterLoss: followStat(quick),
    avgTradesPerDay: avgPerDay,
    overtradingDays: heavy.length && light.length
      ? { days: heavy.length, avgDayPnl: avg(heavy.map((d) => d.pnl)), otherAvgDayPnl: avg(light.map((d) => d.pnl)), threshold }
      : null,
  }
}

// ── P&L diário + consistência ────────────────────────────────────────────────
export interface DayPnl { key: string; pnl: number; trades: number }

export function dailyPnl(trades: InsightTrade[]): DayPnl[] {
  const map = new Map<string, DayPnl>()
  for (const t of trades) {
    const key = dayKeyBR(t.date)
    const cur = map.get(key) ?? { key, pnl: 0, trades: 0 }
    map.set(key, { key, pnl: cur.pnl + t.pnl, trades: cur.trades + 1 })
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export interface Concentration {
  bestTradeShare: number | null // % do lucro bruto vindo do melhor trade
  bestDayShare: number | null // % do lucro líquido vindo do melhor dia
  pnlWithoutBest: number
  bins: { from: number; to: number; count: number }[]
}

export function concentration(trades: InsightTrade[], days: DayPnl[]): Concentration {
  const pnls = trades.map((t) => t.pnl)
  const grossProfit = sum(pnls.filter((p) => p > 0))
  const best = Math.max(...pnls)
  const total = sum(pnls)
  const bestDay = days.length ? Math.max(...days.map((d) => d.pnl)) : 0

  const min = Math.min(...pnls)
  const max = Math.max(...pnls)
  const nBins = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(pnls.length))))
  const width = (max - min) / nBins || 1
  const bins = Array.from({ length: nBins }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }))
  for (const p of pnls) bins[Math.min(nBins - 1, Math.floor((p - min) / width))].count++

  return {
    bestTradeShare: grossProfit > 0 && best > 0 ? Math.round((best / grossProfit) * 100) : null,
    bestDayShare: total > 0 && bestDay > 0 ? Math.round((bestDay / total) * 100) : null,
    pnlWithoutBest: total - (best > 0 ? best : 0),
    bins,
  }
}
