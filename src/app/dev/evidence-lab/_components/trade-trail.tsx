import { maskLabel } from "@/lib/dev/evidence-lab/redact-view"
import type { Demo } from "@/lib/dev/evidence-lab/model"
import type { TradeEvidence } from "@/lib/evidence/schema"
import { Badge, Hash, Json, Kv, Num, Panel, QLink, Section, Table, Td } from "./ui"
import { href, type LabParams } from "./params"

const when = (t: TradeEvidence["entry"]["at"]) => `${t.instantUtc ?? t.localDate ?? "?"} (${t.precision}, fonte ${t.sourceTz ?? "?"})`

export function TradeTrail({ demo, p }: { demo: Demo; p: LabParams }) {
  const idx = Math.min(p.trade, demo.tradeEvidence.length - 1)
  const e = demo.tradeEvidence[idx]
  const ref = demo.importRef
  const prov = Object.entries(e.fieldProvenance)
  const provCount = (k: string) => prov.filter(([, v]) => v === k).length
  return (
    <>
      <Section title="Trilha do trade" subtitle="TradeEvidence → SourceRowRef (importId, rowNo, rowHash) → ImportRef. Dados 100% sintéticos; tudo abaixo é a Evidence que o domínio real gerou.">
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-1">
            {demo.tradeEvidence.map((t, i) => (
              <QLink key={t.tradeId} href={href(p, { tab: "trade", trade: i })} active={i === idx}>
                <span className="font-mono text-xs">#{i + 1}</span> {t.direction === "LONG" ? "C" : "V"} {t.quantity}× · {t.entry.price}→{t.exit.price}{" "}
                <span className="font-mono text-xs">{t.pnl.net === null ? "—" : t.pnl.net.toFixed(2)}</span>
                {t.reconstruction && t.reconstruction.ambiguities.length > 0 ? <span className="ml-1 text-amber-300" title="ambiguidade registrada">●</span> : null}
              </QLink>
            ))}
          </div>
          <div className="min-w-0 space-y-4">
            <Panel>
              <Kv
                rows={[
                  ["tradeId", <span key="a" className="break-all font-mono text-xs">{e.tradeId}</span>],
                  ["importId", <span key="b" className="break-all font-mono text-xs">{e.importId}</span>],
                  ["proveniência", <Badge key="c" tone={e.provenance === "COMPLETE" ? "ok" : "warn"}>{e.provenance}</Badge>],
                  ["granularidade", e.granularity],
                  ["accountRef", <span key="d" className="font-mono text-xs">{e.accountRef}</span>],
                  ["instrumento", `${e.instrument.raw} (raiz ${e.instrument.root})`],
                  ["direção · quantidade", `${e.direction} · ${e.quantity}${e.peakQuantity !== null ? ` (pico ${e.peakQuantity})` : ""}`],
                  ["entrada", `${e.entry.price} em ${when(e.entry.at)}`],
                  ["saída", `${e.exit.price} em ${when(e.exit.at)}`],
                  ["pontos por contrato", <Num key="e" v={e.pointsPerContract} />],
                ]}
              />
            </Panel>
            <Section title="Componentes financeiros" subtitle="Cópia fiel do Canonical (nada recalculado na Evidence).">
              <Table head={["campo", "valor", "observação"]}>
                {(
                  [
                    ["P&L declarado pela fonte", e.pnl.reported, "o que a plataforma reportou"],
                    ["P&L bruto", e.pnl.gross, `base ${e.pnl.basis} (${e.pnl.basisSource})`],
                    ["Comissão", e.pnl.commission, ""],
                    ["Taxas", e.pnl.fees, ""],
                    ["P&L líquido", e.pnl.net, `status ${e.pnl.netStatus}`],
                    ["R líquido", e.r.net, e.r.netReason ? `ausente: ${e.r.netReason}` : "líquido ÷ risco em US$"],
                    ["R em pontos", e.r.points, e.risk.reason ? `ausente: ${e.risk.reason}` : "pontos ÷ risco em pontos (sem custos)"],
                    ["MFE (pontos)", e.excursions.mfePoints, e.excursions.mfeReason ?? `origem ${e.excursions.origin}${e.excursions.conflict ? " · CONFLITO entre linhas" : ""}`],
                    ["MAE (pontos)", e.excursions.maePoints, e.excursions.maeReason ?? ""],
                  ] as Array<[string, number | null, string]>
                ).map(([k, v, o]) => (
                  <tr key={k}>
                    <Td>{k}</Td>
                    <Td><Num v={v} /></Td>
                    <Td className="text-zinc-400">{o}</Td>
                  </tr>
                ))}
              </Table>
            </Section>
            {e.reconstruction ? (
              <Section title="Reconstrução do ciclo">
                <Panel>
                  <Kv
                    rows={[
                      ["método · versão", `${e.reconstruction.method} · v${e.reconstruction.version}`],
                      ["escopo", e.reconstruction.scope],
                      ["confiança", <Badge key="a" tone={e.reconstruction.confidence === "HIGH" ? "ok" : "warn"}>{e.reconstruction.confidence}</Badge>],
                      ["completude das bordas", <Badge key="b" tone={e.reconstruction.completeness === "VERIFIED" ? "ok" : "warn"}>{e.reconstruction.completeness}</Badge>],
                      ["integridade do relatório", e.reconstruction.integrity],
                      ["ciclo (chave)", `${e.reconstruction.cycleKey.accountRef} · ${e.reconstruction.cycleKey.contract} · ${e.reconstruction.cycleKey.direction}`],
                      ["ambiguidades", e.reconstruction.ambiguities.length === 0 ? "nenhuma" : e.reconstruction.ambiguities.map((a) => `${a.code}${a.rowNos ? ` (linhas ${a.rowNos.join(", ")})` : ""}`).join(" · ")],
                    ]}
                  />
                </Panel>
                {e.entryLegs && e.exitLegs ? (
                  <div className="mt-3">
                    <Table head={["perna", "papel", "preço", "qtd", "rótulo", "linhas", "motivo da saída"]}>
                      {[...e.entryLegs.map((l) => ({ k: "entrada", l, reason: "" })), ...e.exitLegs.map((l) => ({ k: "saída", l, reason: `${l.reason} (${l.reasonRule})` }))].map(({ k, l, reason }, i) => (
                        <tr key={i}>
                          <Td>{k}</Td><Td>{l.role}</Td><Td mono>{l.price}</Td><Td mono>{l.quantity}</Td><Td>{maskLabel(l.sourceLabel)}</Td><Td mono>{l.rowRefs.join(", ")}</Td><Td className="text-zinc-400">{reason}</Td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                ) : null}
              </Section>
            ) : null}
            <Section title="Linhas de origem (SourceRowRef)" subtitle="Cada linha do arquivo que compõe o trade: (importId, rowNo, rowHash) identifica e prova o conteúdo; o resto são os valores crus que a conta usa. MAE/MFE/ETD são US$ da linha, nunca somados.">
              <Table head={["linha", "rowHash", "detalhe", "rótulos", "preços", "profit", "comissão", "MAE", "MFE", "ETD"]}>
                {e.sourceRows.map((r) => (
                  <tr key={r.rowNo}>
                    <Td mono>{r.rowNo}</Td><Td><Hash value={r.rowHash} n={16} /></Td><Td>{r.detail}</Td>
                    <Td className="text-zinc-400">{maskLabel(r.entryLabel)}/{maskLabel(r.exitLabel)}</Td>
                    <Td mono>{r.entryPrice}→{r.exitPrice}</Td><Td><Num v={r.reportedProfit} /></Td><Td><Num v={r.commission} /></Td><Td><Num v={r.maeUsd} /></Td><Td><Num v={r.mfeUsd} /></Td><Td><Num v={r.etdUsd} /></Td>
                  </tr>
                ))}
              </Table>
            </Section>
            <Section title="ImportRef" subtitle="Proveniência do arquivo (sem o conteúdo do CSV).">
              <Panel>
                <Kv
                  rows={[
                    ["importId", <span key="a" className="break-all font-mono text-xs">{ref.importId}</span>],
                    ["fileSha256", <span key="b" className="break-all font-mono text-xs">{ref.fileSha256}</span>],
                    ["arquivo", `${ref.fileName ?? "(omitido)"} · ${ref.fileBytes} bytes · ${ref.lineEnding}`],
                    ["parser", `${ref.parserId}@${ref.parserVersion}`],
                    ["reconstrução", `${ref.reconstructionMethod}@${ref.reconstructionVersion}`],
                    ["linhas", `${ref.rowsRead} lidas · ${ref.rowsAccepted} aceitas · ${ref.rowsRejected} rejeitadas · ${ref.accountCount} conta(s)`],
                    ["configurações", `fuso ${ref.settings.sourceTz} (${ref.settings.sourceTzOrigin}) · datas ${ref.settings.dateOrder} · números ${ref.settings.numberLocale} · excursões ${ref.settings.excursionUnit}`],
                  ]}
                />
              </Panel>
            </Section>
            <Section title="Origem de cada informação" subtitle="FILE = veio do arquivo · DERIVED = derivado por regra do domínio · INFERRED = inferido · ABSENT = não existe na origem.">
              <div className="mb-2 flex flex-wrap gap-2">
                {(["FILE", "DERIVED", "INFERRED", "ABSENT"] as const).map((k) => <Badge key={k} tone={k === "FILE" ? "ok" : k === "ABSENT" ? "mute" : "warn"}>{k} {provCount(k)}</Badge>)}
              </div>
              <Json value={e.fieldProvenance} label="fieldProvenance (por campo)" />
            </Section>
            <Json value={e} label="TradeEvidence completo (JSON)" />
          </div>
        </div>
      </Section>
    </>
  )
}
