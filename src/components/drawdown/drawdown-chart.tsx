"use client"

import { useRef, useState, type PointerEvent } from "react"
import { formatAxis, makeYPct, xPct } from "@/components/analytics/scrub-plot"
import { DRAWDOWN_TYPES, type DrawdownType, type Frame } from "@/lib/drawdown-engine"
import { usd, type AccountRules } from "@/lib/drawdown-rules"
import { EQUITY_COLOR, Marker, RULE_STYLE, TARGET_COLOR } from "./rule-style"

interface Props {
  frames: Frame[]
  rules: AccountRules
  /** regra em foco: ganha o "corredor de segurança" (área entre patrimônio e limite) e linha grossa */
  focus: DrawdownType
  visible: (t: DrawdownType) => boolean
  zoneColor: string
  xLabels: string[]
  stepLabel: (frame: Frame) => string
  height?: number
}

const MIN_LABEL_GAP = 7 // % da altura entre rótulos do gutter, pra não sobrepor

/** Degrau: o limite só muda no passo em que a regra atualiza o pico. */
function stepPoints(xs: number[], ys: number[]): [number, number][] {
  const pts: [number, number][] = [[xs[0], ys[0]]]
  for (let i = 1; i < xs.length; i++) {
    pts.push([xs[i], ys[i - 1]], [xs[i], ys[i]])
  }
  return pts
}
const toPath = (pts: [number, number][]) => pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ")

export function DrawdownChart({ frames, rules, focus, visible, zoneColor, xLabels, stepLabel, height = 280 }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(null)

  const count = frames.length
  const target = rules.profitTarget === null ? null : rules.startBalance + rules.profitTarget
  const shown = DRAWDOWN_TYPES.filter(visible)
  const floor = rules.startBalance - rules.maxDrawdown

  const values = [
    ...frames.map((f) => f.equity),
    rules.startBalance,
    floor,
    ...(target !== null ? [target] : []),
    ...shown.flatMap((t) => frames.map((f) => f.rules[t].limit)),
  ]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo) * 0.05 || 50
  const toY = makeYPct(lo - pad, hi + pad)
  const xs = frames.map((_, i) => xPct(i, count))
  const equityYs = frames.map((f) => toY(f.equity))

  const ticks = Array.from({ length: 5 }, (_, i) => {
    const v = lo + ((hi - lo) * i) / 4
    return { y: toY(v), label: formatAxis(v) }
  })

  // corredor de segurança da regra em foco: patrimônio (ida) + limite em degrau (volta)
  const focusPts = stepPoints(xs, frames.map((f) => toY(f.rules[focus].limit)))
  const corridor =
    xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x} ${equityYs[i]}`).join(" ") +
    " " +
    [...focusPts].reverse().map(([x, y]) => `L ${x} ${y}`).join(" ") +
    " Z"

  // rótulos diretos no gutter (nome + margem), sem sobrepor
  const lastFrame = frames[count - 1]
  const labels = [
    ...shown.map((t) => ({
      key: t,
      y: toY(lastFrame.rules[t].limit),
      text: RULE_STYLE[t].short,
      sub: usd(lastFrame.rules[t].margin),
      type: t as DrawdownType | null,
    })),
    ...(target !== null ? [{ key: "meta", y: toY(target), text: "Meta", sub: usd(target), type: null }] : []),
  ].sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < MIN_LABEL_GAP) labels[i].y = labels[i - 1].y + MIN_LABEL_GAP
  }

  function pointer(e: PointerEvent<HTMLDivElement>) {
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    setActive(count <= 1 ? 0 : Math.round(ratio * (count - 1)))
  }

  const shownIdx = active ?? count - 1
  const x = xPct(shownIdx, count)
  const align = x > 65 ? "-100%" : x < 35 ? "0%" : "-50%"
  const f = frames[shownIdx]

  return (
    <div>
      <div className="flex" style={{ height }}>
        <div className="relative w-12 shrink-0">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground/70 font-mono"
              style={{ top: `${t.y}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>

        <div
          ref={plotRef}
          className="relative flex-1 cursor-crosshair select-none"
          style={{ touchAction: "pan-y" }}
          onPointerDown={pointer}
          onPointerMove={pointer}
          onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
            {ticks.map((t, i) => (
              <line
                key={i} x1="0" x2="100" y1={t.y} y2={t.y}
                stroke="currentColor" strokeOpacity="0.07" strokeWidth="1"
                vectorEffect="non-scaling-stroke" className="text-muted-foreground"
              />
            ))}

            {/* saldo inicial: régua discreta */}
            <line
              x1="0" x2="100" y1={toY(rules.startBalance)} y2={toY(rules.startBalance)}
              stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="1 5"
              vectorEffect="non-scaling-stroke" className="text-muted-foreground"
            />

            {/* piso estático do drawdown: linha de "chão" fina */}
            <line
              x1="0" x2="100" y1={toY(floor)} y2={toY(floor)}
              stroke="currentColor" strokeOpacity="0.18" strokeWidth="1"
              vectorEffect="non-scaling-stroke" className="text-muted-foreground"
            />

            {/* meta: faixa pontilhada */}
            {target !== null && (
              <line
                x1="0" x2="100" y1={toY(target)} y2={toY(target)}
                stroke={TARGET_COLOR} strokeWidth="1.6" strokeDasharray="2 6" strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* corredor de segurança (regra em foco) */}
            {visible(focus) && <path d={corridor} fill={zoneColor} fillOpacity="0.11" stroke="none" />}

            {/* regras em comparação: linhas finas */}
            {shown
              .filter((t) => t !== focus)
              .map((t) => (
                <path
                  key={t}
                  d={toPath(stepPoints(xs, frames.map((fr) => toY(fr.rules[t].limit))))}
                  fill="none" stroke={RULE_STYLE[t].color} strokeWidth="1.4" strokeOpacity="0.7"
                  strokeLinejoin="round" vectorEffect="non-scaling-stroke"
                />
              ))}

            {/* regra em foco: linha grossa */}
            {visible(focus) && (
              <path
                d={toPath(focusPts)} fill="none" stroke={RULE_STYLE[focus].color} strokeWidth="2.8"
                strokeLinejoin="round" vectorEffect="non-scaling-stroke"
              />
            )}

            {/* patrimônio */}
            <path
              d={xs.map((px, i) => `${i === 0 ? "M" : "L"} ${px} ${equityYs[i]}`).join(" ")}
              fill="none" stroke={EQUITY_COLOR} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {active != null && (
            <div className="absolute top-0 bottom-0 w-px bg-muted-foreground/30 pointer-events-none" style={{ left: `${x}%` }} />
          )}

          <div
            className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none ring-2 ring-card"
            style={{ left: `${x}%`, top: `${equityYs[shownIdx]}%`, background: EQUITY_COLOR }}
          />

          {active != null && (
            <div
              className="absolute z-10 pointer-events-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap"
              style={{ left: `${x}%`, top: 0, transform: `translateX(${align})` }}
            >
              <p className="font-semibold mb-1">{stepLabel(f)}</p>
              <p className="font-mono">Patrimônio {usd(f.equity)}</p>
              {shown.map((t) => (
                <p key={t} className="font-mono flex items-center gap-1.5">
                  <Marker shape={RULE_STYLE[t].shape} color={RULE_STYLE[t].color} size={8} />
                  {RULE_STYLE[t].short}: {usd(f.rules[t].limit)}
                  <span className="text-muted-foreground">· margem {usd(f.rules[t].margin)}</span>
                </p>
              ))}
            </div>
          )}
        </div>

        {/* gutter: rótulos diretos no fim das linhas (some no celular; a legenda de chips cobre) */}
        <div className="relative w-40 shrink-0 hidden md:block">
          {labels.map((l) => (
            <div
              key={l.key}
              className="absolute left-2 -translate-y-1/2 flex items-center gap-1.5 leading-tight whitespace-nowrap"
              style={{ top: `${l.y}%` }}
            >
              {l.type ? (
                <Marker shape={RULE_STYLE[l.type].shape} color={RULE_STYLE[l.type].color} size={9} />
              ) : (
                <span className="w-2 h-2 rounded-full border-2 shrink-0" style={{ borderColor: TARGET_COLOR }} />
              )}
              <span className="text-[10px]">
                <span className="text-muted-foreground">{l.text}</span>{" "}
                <span className="font-mono text-foreground/90">{l.sub}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between mt-1.5 pl-12 pr-1 md:pr-40">
        {xLabels.map((l, i) => (
          <span key={i} className="text-[10px] text-muted-foreground font-mono">
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}
