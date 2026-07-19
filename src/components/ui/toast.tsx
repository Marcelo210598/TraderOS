"use client"

import { useSyncExternalStore, useEffect, useState } from "react"
import { CheckCircle2, XCircle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

type ToastType = "success" | "error" | "info"

interface ToastItem {
  id: number
  type: ToastType
  message: string
}

// ── Store module-level ────────────────────────────────────────────────
// Um array simples + listeners, pra que `toast(...)` possa ser chamado de
// QUALQUER lugar (client component, handler async, etc) sem context/hook.
let toasts: ToastItem[] = []
const listeners = new Set<() => void>()
let nextId = 1

const AUTO_DISMISS_MS = 3500

function emit() {
  // Snapshot novo a cada mudança (useSyncExternalStore compara por referência)
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return toasts
}

function removeToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

function push(type: ToastType, message: string) {
  const id = nextId++
  toasts = [...toasts, { id, type, message }]
  emit()
  if (typeof window !== "undefined") {
    window.setTimeout(() => removeToast(id), AUTO_DISMISS_MS)
  }
  return id
}

// ── API pública ───────────────────────────────────────────────────────
type ToastFn = ((message: string) => number) & {
  success: (message: string) => number
  error: (message: string) => number
  info: (message: string) => number
}

export const toast = ((message: string) => push("info", message)) as ToastFn
toast.success = (message: string) => push("success", message)
toast.error = (message: string) => push("error", message)
toast.info = (message: string) => push("info", message)

// ── UI ────────────────────────────────────────────────────────────────
const STYLES: Record<ToastType, { icon: typeof Info; border: string; text: string }> = {
  success: { icon: CheckCircle2, border: "border-profit/40", text: "text-profit" },
  error: { icon: XCircle, border: "border-loss/40", text: "text-loss" },
  info: { icon: Info, border: "border-teal/40", text: "text-teal" },
}

function ToastCard({ item }: { item: ToastItem }) {
  const [visible, setVisible] = useState(false)
  const { icon: Icon, border, text } = STYLES[item.type]

  // Slide/fade de entrada no próximo frame
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-card px-3.5 py-3 shadow-lg backdrop-blur-sm",
        "w-full sm:w-80 transition-all duration-300 ease-out",
        border,
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", text)} />
      <p className="flex-1 text-xs leading-relaxed text-foreground">{item.message}</p>
      <button
        onClick={() => removeToast(item.id)}
        aria-label="Fechar"
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  )
}
