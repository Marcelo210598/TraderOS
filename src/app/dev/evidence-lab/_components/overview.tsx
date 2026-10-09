import { PENDING, STATUS_LABEL, STATUS_MEANING, type LayerStatus, type LayerView } from "@/lib/dev/evidence-lab/layers"
import { Badge, Callout, Panel, Section, type Tone } from "./ui"

const tone = (s: LayerStatus): Tone => (s === "concluido" ? "ok" : s === "parcial" ? "warn" : s === "pendente" ? "mute" : "info")

export function Overview({ layers }: { layers: LayerView[] }) {
  const counts = (s: LayerStatus) => layers.filter((l) => l.status === s).length + PENDING.filter((p) => p.status === s).length
  return (
    <>
      <Section
        title="Visão geral da fundação"
        subtitle="As camadas já construídas, na ordem do fluxo dos dados. O estado é declarado com a base que o sustenta; a SONDA AO VIVO roda o código real agora e mostra o que ele produz com os dados sintéticos. Selo verde só existe para o que está implementado e testado."
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(["concluido", "parcial", "pendente", "fora"] as const).map((s) => (
            <Panel key={s} className="!p-3">
              <div className="flex items-center justify-between">
                <Badge tone={tone(s)}>{STATUS_LABEL[s]}</Badge>
                <span className="font-mono text-lg text-zinc-100">{counts(s)}</span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">{STATUS_MEANING[s]}</p>
            </Panel>
          ))}
        </div>
        <div className="space-y-3">
          {layers.map((l) => (
            <Panel key={l.id}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-100">{l.title}</h3>
                <Badge tone={tone(l.status)}>{STATUS_LABEL[l.status]}</Badge>
                {l.probe ? <Badge tone={l.probe.ok ? "ok" : "bad"} title="Resultado da sonda rodada agora">{l.probe.ok ? "sonda ao vivo ok" : "sonda falhou"}</Badge> : null}
              </div>
              <p className="mt-1.5 text-sm text-zinc-300">{l.summary}</p>
              {l.probe ? <p className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">▸ {l.probe.text}</p> : null}
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">base e limitações</summary>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Base</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-zinc-300">{l.basis.map((b) => <li key={b} className="font-mono text-xs">{b}</li>)}</ul>
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">O que NÃO cobre</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-zinc-300">{l.limits.map((b) => <li key={b}>{b}</li>)}</ul>
                  </div>
                </div>
              </details>
            </Panel>
          ))}
        </div>
      </Section>
      <Section title="Pendente e fora de escopo" subtitle="O que ainda NÃO existe — listado de propósito, para ninguém ler a lista acima como 'tudo pronto'.">
        <div className="grid gap-2 md:grid-cols-2">
          {PENDING.map((p) => (
            <Panel key={p.id} className="!p-3">
              <div className="flex items-center gap-2">
                <Badge tone={tone(p.status)}>{STATUS_LABEL[p.status]}</Badge>
                <span className="text-sm font-medium text-zinc-100">{p.title}</span>
              </div>
              <p className="mt-1.5 text-xs text-zinc-400">{p.why}</p>
            </Panel>
          ))}
        </div>
      </Section>
      <Callout tone="warn" title="O que este laboratório é — e não é">
        Ferramenta de desenvolvimento, só em <code>NODE_ENV=development</code>, com dados inventados. Não é a interface do produto, não usa banco nem as fixtures reais, e não calcula nada por conta própria: cada número, hash e veredito vem das funções reais do domínio.
      </Callout>
    </>
  )
}
