import type { ScenarioRun } from "@/lib/dev/evidence-lab/model"
import { Badge, Callout, Json, Kv, Panel, QLink, Section, Table, Td, statusTone } from "./ui"
import { CheckTable, ReportSummary } from "./verifier-panel"
import { href, type LabParams } from "./params"

export function TamperPanel({ runs, selected, p }: { runs: ScenarioRun[]; selected: ScenarioRun; p: LabParams }) {
  const s = selected.scenario
  const failing = selected.report.checks.filter((c) => c.status === "FAIL")
  const blocking = selected.report.checks.filter((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE")
  return (
    <>
      <Section
        title="Cenários de adulteração"
        subtitle="Cada linha executa agora as funções reais: gera o bundle, aplica a alteração, recalcula o selo com computeEvidenceHash quando o cenário diz que sim e roda verifyEvidence. A coluna 'status real' é o resultado; 'previsto' é só o que o contrato espera, para o Lab acusar divergência."
      >
        <Table head={["cenário", "selo novo?", "previsto", "status real", "o que acusou", ""]}>
          {runs.map((r) => (
            <tr key={r.scenario.id} className={r.scenario.id === s.id ? "bg-zinc-800/50" : ""}>
              <Td>{r.scenario.title}</Td>
              <Td>{r.scenario.resealed ? "sim" : "não"}</Td>
              <Td><Badge tone="mute">{r.scenario.expected}</Badge></Td>
              <Td>
                <Badge tone={statusTone(r.report.status)}>{r.report.status}</Badge>{" "}
                {r.matchesContract ? <span className="text-xs text-emerald-400" title="igual ao previsto pelo contrato">✓</span> : <span className="text-xs text-rose-400" title="DIFERENTE do previsto pelo contrato">⚠ diverge</span>}
              </Td>
              <Td className="font-mono text-[11px] text-zinc-400">
                {r.report.checks.filter((c) => c.status === "FAIL").map((c) => c.id).join(", ") || r.report.checks.filter((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE").map((c) => `${c.id}·${c.code}`).slice(0, 2).join(", ") || "nada (sem falhas)"}
              </Td>
              <Td><QLink href={`${href(p, { tab: "tamper", scenario: r.scenario.id })}#detalhe`} active={r.scenario.id === s.id}>detalhar</QLink></Td>
            </tr>
          ))}
        </Table>
      </Section>
      <Section id="detalhe" title={s.title} subtitle={s.what}>
        <div className="space-y-4">
          <Panel>
            <Kv
              rows={[
                ["status real", <Badge key="a" tone={statusTone(selected.report.status)}>{selected.report.status}</Badge>],
                ["previsto pelo contrato", <span key="b"><Badge tone="mute">{s.expected}</Badge> <span className="text-sm text-zinc-300">{s.expectedNote}</span></span>],
                ["conforme o contrato?", selected.matchesContract ? "sim" : "NÃO — divergência a investigar"],
                ["selo antes", <span key="c" className="break-all font-mono text-xs">{selected.sealBefore}</span>],
                ["selo depois", <span key="d" className="break-all font-mono text-xs">{selected.sealAfter ?? "(ausente/inválido)"}{selected.sealAfter === selected.sealBefore ? "  — igual" : ""}</span>],
                ["checks que falharam", failing.length ? failing.map((c) => c.id).join(", ") : "nenhum"],
                ["pulados bloqueantes", blocking.length ? blocking.map((c) => `${c.id} (${c.code})`).join(", ") : "nenhum"],
              ]}
            />
          </Panel>
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">O que mudou no JSON (comparado ao bundle íntegro)</p>
            <Panel className="!p-3">{selected.changes.length === 0 ? <span className="text-sm text-zinc-400">nada</span> : <ul className="space-y-0.5 font-mono text-xs text-zinc-300">{selected.changes.map((c) => <li key={c}>{c}</li>)}</ul>}</Panel>
          </div>
          {s.id === "coordinated" ? (
            <Callout tone="warn" title="Por que este VALID é o limite, não um bug">
              O bundle foi regenerado do zero com as funções reais a partir de um dado de origem alterado. Por dentro tudo fecha (hashes, referências, motor). O selo é integridade interna, não assinatura: só comparar com o CSV original (E5b) mostraria que o P&L não é o do arquivo. É por isso que o relatório sempre traz as limitações.
            </Callout>
          ) : null}
          <div className="mb-1"><ReportSummary report={selected.report} /></div>
          <CheckTable report={selected.report} />
          <Json value={selected.bundle} label="Bundle usado neste cenário (JSON)" />
        </div>
      </Section>
    </>
  )
}
