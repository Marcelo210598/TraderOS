import { CHECK_CATALOG, type VerifyReport, type VerifyStatus } from "@/lib/evidence/verify"
import { Badge, Callout, Panel, Section, Table, Td, checkTone, statusTone } from "./ui"

export const STATUS_EXPLAIN: Record<VerifyStatus, string> = {
  VALID: "Todos os checks que se aplicam passaram e nada bloqueante foi pulado: os números do bundle são reproduzíveis pelo motor a partir dos trades declarados. NÃO prova a origem, a seleção original nem é assinatura.",
  TAMPERED: "Pelo menos um check FALHOU: selo, referência, população ou cálculo está inconsistente. Algo foi alterado (ou gerado de forma incoerente).",
  UNVERIFIABLE: "Nada acusou adulteração, mas algo obrigatório NÃO pôde ser verificado (população acima do limite, versão incompatível, associação sem referência, proveniência incompleta, ordem da sequência não registradaa). Não é aprovação.",
  INVALID_FORMAT: "O bundle não tem a forma do contrato (evidence/1 estrito): nem dá para ler selo e referências com segurança. Os checks seguintes ficam SKIPPED.",
}

const titles = new Map(CHECK_CATALOG.map((c) => [c.id, c.title]))

export function StatusLegend() {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {(Object.keys(STATUS_EXPLAIN) as VerifyStatus[]).map((s) => (
        <Panel key={s} className="!p-3">
          <Badge tone={statusTone(s)}>{s}</Badge>
          <p className="mt-1.5 text-xs text-zinc-400">{STATUS_EXPLAIN[s]}</p>
        </Panel>
      ))}
    </div>
  )
}

export function CheckTable({ report }: { report: VerifyReport }) {
  return (
    <Table head={["nível", "check", "status", "código", "explicação"]}>
      {report.checks.map((c) => (
        <tr key={c.id} className={c.status === "FAIL" ? "bg-rose-500/5" : ""}>
          <Td mono>{c.level}</Td>
          <Td><span className="font-mono text-xs text-zinc-100">{c.id}</span><span className="block text-[11px] text-zinc-500">{titles.get(c.id)}</span></Td>
          <Td><Badge tone={checkTone(c.status)}>{c.status}</Badge></Td>
          <Td mono>{c.code ?? "—"}</Td>
          <Td className="max-w-xl text-zinc-300">{c.detail}</Td>
        </tr>
      ))}
    </Table>
  )
}

export function ReportSummary({ report }: { report: VerifyReport }) {
  const by = (s: string) => report.checks.filter((c) => c.status === s).length
  const blocking = report.checks.filter((c) => c.status === "SKIPPED" && c.code !== "S_NOT_APPLICABLE").length
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={statusTone(report.status)}>{report.status}</Badge>
      <Badge tone="ok">PASS {by("PASS")}</Badge>
      <Badge tone="bad">FAIL {by("FAIL")}</Badge>
      <Badge tone="warn" title="Pulados que impedem VALID">SKIPPED bloqueantes {blocking}</Badge>
      <Badge tone="mute" title="O check não se aplica a este bundle (não impede VALID)">NOT_APPLICABLE {by("SKIPPED") - blocking}</Badge>
      <span className="text-xs text-zinc-500">{report.checks.length} checks · {report.schema}</span>
    </div>
  )
}

export function VerifierPanel({ title, report, extra }: { title: string; report: VerifyReport; extra?: React.ReactNode }) {
  return (
    <>
      <Section title="Verificador — os quatro veredictos" subtitle="verifyEvidence devolve um destes quatro status. SKIPPED nunca é apresentado como aprovado.">
        <StatusLegend />
      </Section>
      <Section title={title} subtitle="Relatório REAL de verifyEvidence sobre o bundle selecionado, na ordem fixa dos checks (V0 formato · V1 selo · V2 referências · V3 população · V4 métricas · V6 derivados — este último só se aplica a bundles com derivados; veja a aba Derivados (E6)).">
        {extra}
        <div className="mb-3"><ReportSummary report={report} /></div>
        <CheckTable report={report} />
        <Callout tone="mute" title="O que nem VALID afirma (limitations do relatório)">
          <ul className="list-disc space-y-1 pl-5">{report.limitations.map((l) => <li key={l.code}><span className="font-mono text-xs">{l.code}</span> — {l.text}</li>)}</ul>
        </Callout>
      </Section>
    </>
  )
}
