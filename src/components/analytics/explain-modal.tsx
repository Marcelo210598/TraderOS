"use client"

import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { HelpCircle, X } from "lucide-react"
import { cn } from "@/lib/utils"

export type ExplainTopic = "mfe" | "mae" | "captura" | "drawdown" | "profitFactor" | "expectancy" | "whatif"

// Mini-diagrama de um trade de compra: mostra onde ficam entrada, MFE, MAE e saída.
function TradeDiagram({ show }: { show: "mfe" | "mae" | "both" }) {
  const rows = [
    { y: 18, label: "MFE  20.040", color: "rgb(34 197 94)", on: show !== "mae", note: "máximo a favor: +40 pts" },
    { y: 46, label: "Saída  20.025", color: "rgb(148 163 184)", on: true, note: "onde você fechou: +25 pts" },
    { y: 78, label: "Entrada  20.000", color: "rgb(96 165 250)", on: true, note: "compra" },
    { y: 104, label: "MAE  19.985", color: "rgb(239 68 68)", on: show !== "mfe", note: "máximo contra: -15 pts" },
  ]
  return (
    <svg viewBox={show === "mae" ? "0 34 300 86" : show === "mfe" ? "0 0 300 92" : "0 0 300 120"} className="w-full max-w-sm mx-auto" role="img" aria-label="Diagrama de um trade com entrada, MFE, MAE e saída">
      {rows.filter((r) => r.on).map((r) => (
        <g key={r.label}>
          <line x1="8" x2="150" y1={r.y} y2={r.y} stroke={r.color} strokeWidth="1.5" strokeDasharray={r.label.startsWith("Entrada") ? "0" : "4 3"} />
          <text x="156" y={r.y - 2} fontSize="9.5" fill={r.color} fontFamily="monospace" fontWeight="bold">{r.label}</text>
          <text x="156" y={r.y + 9} fontSize="8.5" fill="currentColor" opacity="0.55">{r.note}</text>
        </g>
      ))}
    </svg>
  )
}

const P = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
const B = ({ children }: { children: ReactNode }) => <strong className="text-foreground font-semibold">{children}</strong>
const Tip = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg bg-teal/5 border border-teal/20 px-3 py-2 text-xs text-muted-foreground leading-relaxed">{children}</div>
)

const CONTENT: Record<ExplainTopic, { title: string; body: ReactNode }> = {
  mfe: {
    title: "MFE — Máximo a Favor",
    body: (
      <>
        <P>
          É o <B>máximo que o preço andou a seu favor</B> depois que você entrou, mesmo que você não tenha saído ali.
          Em inglês: <em>Maximum Favorable Excursion</em>. Medido em pontos.
        </P>
        <TradeDiagram show="mfe" />
        <P>
          No exemplo, você comprou em 20.000, o preço foi até 20.040 e você fechou em 20.025. O <B>MFE foi 40 pts</B>,
          mas você embolsou 25. Ficaram 15 pts na mesa.
        </P>
        <Tip>
          <B>Pra que serve:</B> mostra se você sai cedo demais. MFE alto com lucro pequeno = a entrada estava certa e a
          saída foi o problema. Também mostra os losses que já estiveram no verde antes de virar prejuízo.
        </Tip>
      </>
    ),
  },
  mae: {
    title: "MAE — Máximo Contra",
    body: (
      <>
        <P>
          É o <B>máximo que o preço andou contra você</B> depois que entrou, antes do trade terminar.
          Em inglês: <em>Maximum Adverse Excursion</em>. Medido em pontos.
        </P>
        <TradeDiagram show="mae" />
        <P>
          Você comprou em 20.000, o preço caiu até 19.985 e só depois subiu. O <B>MAE foi 15 pts</B>: o trade sofreu 15
          pts antes de dar certo.
        </P>
        <Tip>
          <B>Pra que serve:</B> calibrar o stop e a entrada. Se seus wins quase nunca passam de 10 pts contra, mas seu
          stop é 40, você está dando folga que só serve pra perder mais nos trades ruins. Se os wins sofrem quase tanto
          quanto os losses, a entrada está cedo demais.
        </Tip>
      </>
    ),
  },
  captura: {
    title: "Taxa de captura",
    body: (
      <>
        <P>
          Mede <B>quanto do movimento a favor você realmente pegou</B>. É o lucro em pontos dividido pelo MFE, calculado só
          nos trades que deram lucro.
        </P>
        <P>
          Exemplo: MFE de 40 pts e saída com +25 pts = captura de <B>62%</B>. A média dos seus trades é o número que aparece no card.
        </P>
        <Tip>
          Acima de ~60% é uma saída eficiente. Abaixo de 40% você costuma sair muito cedo (ou devolve o lucro esperando mais).
          Ninguém captura 100%: isso exigiria vender exatamente no topo.
        </Tip>
      </>
    ),
  },
  drawdown: {
    title: "Drawdown",
    body: (
      <>
        <P>
          É a <B>distância entre o pico da sua equity e onde você está agora</B>. Responde: &ldquo;quanto eu já perdi do
          melhor momento?&rdquo;.
        </P>
        <P>
          Exemplo: sua conta chegou a +$500 e depois caiu pra +$380. O drawdown naquele ponto é de <B>$120</B>. Se depois
          ela sobe pra +$520, o drawdown volta a zero (novo pico).
        </P>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li><B>Max drawdown</B>: a maior queda pico→vale de todo o histórico. Mede o pior sufoco que você já passou.</li>
          <li><B>Drawdown atual</B>: quanto você está abaixo do último pico agora. Zero = você está no topo.</li>
        </ul>
        <Tip>
          <B>Por que importa:</B> em mesa proprietária o drawdown é o que reprova a conta (limite de trailing drawdown).
          Também pesa no psicológico: o drawdown mostra o tamanho do buraco que você precisa recuperar.
          Aqui ele é calculado pelo P&L dos trades fechados.
        </Tip>
      </>
    ),
  },
  profitFactor: {
    title: "Profit Factor",
    body: (
      <>
        <P>
          É <B>tudo que você ganhou dividido por tudo que você perdeu</B> (valores brutos). Se ganhou $1.000 nos wins e
          perdeu $500 nos losses, o profit factor é <B>2,0</B>.
        </P>
        <Tip>
          Abaixo de 1,0 = perde dinheiro. 1,0 a 1,5 = lucrativo mas apertado. Acima de 1,5 = sólido. Muito acima de 3 com
          poucos trades costuma ser sorte de amostra pequena, não habilidade comprovada.
        </Tip>
      </>
    ),
  },
  expectancy: {
    title: "Expectância",
    body: (
      <>
        <P>
          É <B>quanto, em média, cada trade seu rende</B>: (win rate × ganho médio) − (taxa de loss × perda média).
        </P>
        <P>
          Expectância de +$61 significa que, em média, cada vez que você aperta o botão, o resultado esperado é +$61.
          Positiva = sua forma de operar tem vantagem estatística; negativa = mesmo ganhando de vez em quando, no
          longo prazo você perde.
        </P>
        <Tip>Precisa de amostra: com poucos trades o número balança muito. Confie mais depois de 30+ trades.</Tip>
      </>
    ),
  },
  whatif: {
    title: 'Como funciona o "E se..."',
    body: (
      <>
        <P>
          O simulador pega <B>seus trades reais</B> e refaz as contas mudando uma regra de cada vez, pra você ver quanto
          essa regra teria mudado o resultado.
        </P>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li><B>Stop mais curto:</B> se o MAE do trade passou do stop simulado, ele teria sido stopado. Isso inclui trades que depois virariam win.</li>
          <li><B>Alvo fixo:</B> se o MFE chegou no alvo, você teria saído nele, inclusive nos trades que depois viraram loss.</li>
          <li><B>Stop + alvo juntos:</B> se os dois foram atingidos, não dá pra saber quem veio primeiro, então o simulador assume o pior caso (stop).</li>
          <li><B>Limites diários:</B> pára de operar no dia depois de N losses ou N trades.</li>
        </ul>
        <Tip>
          <B>Cuidado:</B> é retrospectivo. O &ldquo;melhor valor&rdquo; é o que teria funcionado no passado; com poucos trades
          isso pode ser coincidência. Use como pista e teste com calma, não como garantia. Só entram trades com MFE/MAE
          registrados; os demais ficam como foram.
        </Tip>
      </>
    ),
  },
}

interface ExplainButtonProps {
  topic: ExplainTopic
  label?: string
  className?: string
}

export function ExplainButton({ topic, label, className }: ExplainButtonProps) {
  const [open, setOpen] = useState(false)
  const content = CONTENT[topic]

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`O que é: ${content.title}`}
        className={cn(
          "inline-flex items-center gap-1 p-1.5 -m-1.5 text-muted-foreground/70 hover:text-teal transition-colors align-middle",
          label ? "text-[11px] underline decoration-dotted underline-offset-2" : "",
          className,
        )}
      >
        <HelpCircle className="w-3.5 h-3.5" />
        {label}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={content.title}
            onClick={(e) => e.stopPropagation()}
            className="bg-popover text-popover-foreground border border-border w-full sm:max-w-md max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl shadow-2xl pb-[env(safe-area-inset-bottom)]"
          >
            <div className="sticky top-0 bg-popover flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold">{content.title}</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">{content.body}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
