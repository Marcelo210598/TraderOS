"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"
import { AlertTriangle, X, Loader2 } from "lucide-react"
import { toast } from "@/components/ui/toast"

const CONFIRM_WORD = "EXCLUIR"

export function DeleteAccount() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleDelete() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/user", { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Não consegui excluir sua conta agora.")
        setLoading(false)
        return
      }
      toast.success("Conta excluída. Sentiremos sua falta.")
      await signOut({ callbackUrl: "/login" })
    } catch {
      setError("Erro de conexão. Tente de novo.")
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 border border-loss/40 text-loss rounded-lg text-sm font-medium hover:bg-loss/10 transition-colors"
      >
        Excluir minha conta
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="relative w-full max-w-sm bg-card border border-loss/30 rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => !loading && setOpen(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Fechar"
              disabled={loading}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-xl bg-loss/10 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-loss" />
            </div>

            <h3 className="text-lg font-bold text-foreground">Excluir sua conta</h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              Isso apaga permanentemente seus trades, journal, check-ins, setups e demais dados do MeuTrade,
              e cancela qualquer assinatura ativa. Não dá pra desfazer.
            </p>

            <label htmlFor="confirm-delete" className="block text-xs text-muted-foreground mt-4 mb-1.5">
              Digite <span className="font-mono font-semibold text-foreground">{CONFIRM_WORD}</span> para confirmar
            </label>
            <input
              id="confirm-delete"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={loading}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-loss transition-colors"
              placeholder={CONFIRM_WORD}
              autoComplete="off"
            />

            {error && <p className="text-xs text-loss mt-2">{error}</p>}

            <button
              onClick={handleDelete}
              disabled={loading || typed !== CONFIRM_WORD}
              className="w-full py-2.5 mt-4 rounded-xl text-sm font-semibold bg-loss text-white hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Excluir permanentemente
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={loading}
              className="w-full py-2 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
