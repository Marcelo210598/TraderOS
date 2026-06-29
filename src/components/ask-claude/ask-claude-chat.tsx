"use client"

import { useState, useRef, useEffect } from "react"
import Image from "next/image"
import { Send, Loader2, User, Database } from "lucide-react"
import { cn } from "@/lib/utils"
import { openUpgradeModal } from "@/lib/upgrade"

interface Message {
  role: "user" | "assistant"
  content: string
}

const SUGGESTIONS = [
  "Analise meu desempenho nos últimos 90 dias e diga onde posso melhorar",
  "Qual sessão (AM/PM) é mais lucrativa para mim e por quê?",
  "Meu setup mais usado está performando bem? O que os dados dizem?",
  "Como está meu win rate comparado ao ideal para ser lucrativo?",
]

export function AskClaudeChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [tradeCount, setTradeCount] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/ask-claude")
      .then((r) => r.json())
      .then((d) => { if (typeof d.tradeCount === "number") setTradeCount(d.tradeCount) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  async function send(content: string) {
    if (!content.trim() || loading) return
    const userMsg: Message = { role: "user", content: content.trim() }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput("")
    setLoading(true)

    try {
      const res = await fetch("/api/ask-claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json()
      // Limite de plano atingido → abre modal de upgrade
      if (res.status === 403) {
        openUpgradeModal({ reason: data.error?.toString(), suggestedPlan: data.suggestedPlan ?? "PRO" })
        setMessages(next)
        return
      }
      const reply = data.reply ?? data.error ?? "Erro ao processar sua pergunta. Tente novamente."
      setMessages([...next, { role: "assistant", content: reply }])
    } catch {
      setMessages([...next, { role: "assistant", content: "Erro ao conectar. Tente novamente." }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Context indicator */}
      {tradeCount !== null && (
        <div className="border-b border-border px-6 py-2 flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-teal shrink-0" />
          <p className="text-xs text-muted-foreground">
            {tradeCount > 0
              ? `Vega tem acesso aos seus últimos ${tradeCount} trades (90 dias) para análise contextual`
              : "Nenhum trade registrado ainda — registre operações no Journal para análise personalizada"
            }
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6 max-w-lg mx-auto">
            <div className="w-24 h-24 rounded-2xl overflow-hidden ring-1 ring-teal/30">
              <Image src="/vega.png" alt="Vega" width={96} height={96} className="object-cover" priority />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Vega</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {tradeCount && tradeCount > 0
                  ? `Analisei ${tradeCount} trades seus. Pergunte sobre sua performance, setups ou psicologia.`
                  : "Analista de trading com IA. Pergunte sobre setups, métricas, Apex Funding ou psicologia."
                }
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-sm text-muted-foreground hover:text-foreground bg-card hover:bg-muted border border-border rounded-lg px-4 py-2.5 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-3 max-w-3xl",
              msg.role === "user" ? "ml-auto flex-row-reverse" : ""
            )}
          >
            <div className={cn(
              "w-7 h-7 rounded-lg shrink-0 mt-0.5 flex items-center justify-center overflow-hidden",
              msg.role === "user" ? "bg-primary" : "bg-card ring-1 ring-teal/30"
            )}>
              {msg.role === "user"
                ? <User className="w-4 h-4 text-primary-foreground" />
                : <Image src="/vega-sm.png" alt="Vega" width={28} height={28} className="object-cover" />
              }
            </div>
            <div className={cn(
              "rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap max-w-[80%]",
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-foreground"
            )}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0 mt-0.5 ring-1 ring-teal/30">
              <Image src="/vega-sm.png" alt="Vega" width={28} height={28} className="object-cover" />
            </div>
            <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-teal animate-spin" />
              <span className="text-sm text-muted-foreground">Analisando seus dados...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="flex items-end gap-3 max-w-3xl mx-auto">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre seus trades..."
            rows={1}
            className="flex-1 min-w-0 resize-none bg-card border border-border rounded-xl px-4 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap focus:outline-none focus:ring-1 focus:ring-teal/50 min-h-[52px] max-h-32"
            style={{ overflowY: "auto" }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-xl bg-teal flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-teal/90 transition-colors"
          >
            <Send className="w-4 h-4 text-teal-foreground" />
          </button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground/50 mt-2">
          Enter para enviar · Shift+Enter para nova linha
        </p>
      </div>
    </div>
  )
}
