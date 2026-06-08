import { Lightbulb, AlertTriangle, Sparkles } from "lucide-react"
import type { Block } from "@/lib/trilha-content"
import { cn } from "@/lib/utils"

// Renderiza **negrito** inline dentro de um texto.
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function LessonContent({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "h":
            return (
              <h3 key={i} className="text-base font-semibold text-foreground pt-2">
                {block.text}
              </h3>
            )
          case "p":
            return (
              <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                {renderInline(block.text)}
              </p>
            )
          case "list":
            return (
              <ul key={i} className="space-y-2">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            )
          case "tip":
            return (
              <Callout key={i} icon={Lightbulb} tone="teal" label="Dica TraderOS">
                {renderInline(block.text)}
              </Callout>
            )
          case "warn":
            return (
              <Callout key={i} icon={AlertTriangle} tone="loss" label="Cuidado">
                {renderInline(block.text)}
              </Callout>
            )
          case "key":
            return (
              <Callout key={i} icon={Sparkles} tone="profit" label="Resumindo">
                {renderInline(block.text)}
              </Callout>
            )
          default:
            return null
        }
      })}
    </div>
  )
}

function Callout({
  icon: Icon,
  tone,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  tone: "teal" | "loss" | "profit"
  label: string
  children: React.ReactNode
}) {
  const toneMap = {
    teal: { border: "border-teal/20", bg: "bg-teal/5", text: "text-teal" },
    loss: { border: "border-loss/20", bg: "bg-loss/5", text: "text-loss" },
    profit: { border: "border-profit/20", bg: "bg-profit/5", text: "text-profit" },
  }[tone]

  return (
    <div className={cn("rounded-xl border p-4", toneMap.border, toneMap.bg)}>
      <div className={cn("mb-1.5 flex items-center gap-2 text-xs font-semibold", toneMap.text)}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}
