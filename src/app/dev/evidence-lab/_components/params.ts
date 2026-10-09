// Parâmetros da URL do Lab (a página é toda renderizada no servidor; trocar de aba/cenário é só trocar a URL).
import { EVIDENCE_LAB_BASE_PATH } from "@/lib/dev/evidence-lab/guard"
import { GROUP_DIMENSIONS, SCENARIOS, type GroupDimension } from "@/lib/dev/evidence-lab/model"
import { METRIC_IDS } from "@/lib/metrics"

export const TABS = [
  { id: "overview", label: "Visão geral" },
  { id: "trade", label: "Trilha do trade" },
  { id: "metrics", label: "Métricas" },
  { id: "bundle", label: "EvidenceBundle" },
  { id: "verify", label: "Verificador" },
  { id: "tamper", label: "Adulteração" },
] as const
export type Tab = (typeof TABS)[number]["id"]

export interface LabParams {
  tab: Tab
  /** id de cenário ("intact"…), ou "bundle" = o bundle montado na aba EvidenceBundle. */
  scenario: string
  trade: number
  metric: string
  by: GroupDimension | null
  group: number
  mode: "full" | "hashonly"
  pnl: "NET" | "GROSS"
  r: "NET" | "POINTS"
}

type Raw = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const int = (v: string | undefined, d: number) => (v !== undefined && /^\d{1,4}$/.test(v) ? Number(v) : d)

export const DEFAULTS: LabParams = { tab: "overview", scenario: "intact", trade: 0, metric: "netPnl", by: null, group: 0, mode: "full", pnl: "NET", r: "NET" }

export function parseParams(raw: Raw): LabParams {
  const tab = one(raw.tab)
  const scenario = one(raw.scenario)
  const metric = one(raw.metric)
  const by = one(raw.by)
  return {
    tab: (TABS.some((t) => t.id === tab) ? tab : DEFAULTS.tab) as Tab,
    scenario: scenario === "bundle" || SCENARIOS.some((s) => s.id === scenario) ? (scenario as string) : DEFAULTS.scenario,
    trade: int(one(raw.trade), DEFAULTS.trade),
    metric: metric && METRIC_IDS.includes(metric) ? metric : DEFAULTS.metric,
    by: by && (GROUP_DIMENSIONS as readonly string[]).includes(by) ? (by as GroupDimension) : null,
    group: int(one(raw.group), DEFAULTS.group),
    mode: one(raw.mode) === "hashonly" ? "hashonly" : "full",
    pnl: one(raw.pnl) === "GROSS" ? "GROSS" : "NET",
    r: one(raw.r) === "POINTS" ? "POINTS" : "NET",
  }
}

/** Monta a URL só com o que difere do padrão. */
export function href(p: LabParams, over: Partial<LabParams> = {}): string {
  const q = { ...p, ...over }
  const sp = new URLSearchParams()
  for (const k of Object.keys(DEFAULTS) as Array<keyof LabParams>) {
    const v = q[k]
    if (v !== null && v !== undefined && String(v) !== String(DEFAULTS[k])) sp.set(k, String(v))
  }
  if (q.tab !== "overview") sp.set("tab", q.tab)
  const s = sp.toString()
  return s ? `${EVIDENCE_LAB_BASE_PATH}?${s}` : EVIDENCE_LAB_BASE_PATH
}
