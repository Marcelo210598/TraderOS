"use client"

import { useState, useEffect, useCallback } from "react"
import { Bell, BellOff, Check, Loader2, Share } from "lucide-react"

type PushState = "idle" | "subscribed" | "loading" | "denied" | "unsupported"

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export function PushNotifications() {
  const [pushState, setPushState] = useState<PushState>("idle")
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false)
  const [testMsg, setTestMsg] = useState<"sending" | "ok" | "fail" | null>(null)

  useEffect(() => {
    let cancelled = false

    // Detecção de capacidade roda só no client (acessa navigator/Notification).
    // Numa função async pra não disparar setState síncrono no corpo do effect.
    async function detect() {
      const ua = navigator.userAgent || ""
      const isIOS = /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true

      if (isIOS && !isStandalone) {
        if (!cancelled) { setIosNeedsInstall(true); setPushState("unsupported") }
        return
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setPushState("unsupported")
        return
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setPushState("denied")
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!cancelled) setPushState(sub ? "subscribed" : "idle")
    }

    detect()
    return () => { cancelled = true }
  }, [])

  const enablePush = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return
    setPushState("loading")
    try {
      const perm = await Notification.requestPermission()
      if (perm !== "granted") { setPushState("denied"); return }

      let reg = await navigator.serviceWorker.getRegistration()
      if (!reg) reg = await navigator.serviceWorker.register("/sw.js")
      // Espera o SW ativar (máx 10s)
      if (!reg.active) {
        await Promise.race([
          new Promise<void>((resolve) => {
            const sw = reg!.installing || reg!.waiting
            if (!sw) return resolve()
            sw.addEventListener("statechange", () => { if (sw.state === "activated") resolve() })
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 10000)),
        ])
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
      if (!vapidKey) throw new Error("VAPID key ausente")

      // Remove inscrição antiga (pode ter chave corrompida) antes de recriar
      const existing = await reg.pushManager.getSubscription()
      if (existing) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        }).catch(() => {})
        await existing.unsubscribe().catch(() => {})
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      })

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error("falha ao salvar")
      setPushState("subscribed")
    } catch (err) {
      console.error("[enablePush]", err)
      setPushState("idle")
    }
  }, [])

  const testPush = useCallback(async () => {
    setTestMsg("sending")
    try {
      const res = await fetch("/api/push/test", { method: "POST" })
      const data = await res.json()
      setTestMsg(res.ok && data.sent > 0 ? "ok" : "fail")
    } catch {
      setTestMsg("fail")
    }
    setTimeout(() => setTestMsg(null), 6000)
  }, [])

  return (
    <div>
      {/* iPhone: precisa instalar o app primeiro */}
      {iosNeedsInstall && (
        <div className="rounded-xl border border-teal/30 bg-teal/5 p-4">
          <p className="text-sm font-semibold text-teal mb-2">📱 No iPhone, instale o app primeiro</p>
          <p className="text-xs text-muted-foreground mb-3">
            A Apple só permite notificações se o site estiver instalado na tela inicial. É rápido:
          </p>
          <ol className="text-xs space-y-1.5 list-decimal pl-4 text-foreground/80">
            <li>Toque em <Share className="w-3 h-3 inline -mt-0.5" /> <strong>Compartilhar</strong> na barra do Safari</li>
            <li>Role e toque em <strong>&quot;Adicionar à Tela de Início&quot;</strong></li>
            <li>Confirme em <strong>Adicionar</strong></li>
            <li>Abra o app pelo <strong>ícone novo na tela inicial</strong> (não pelo Safari)</li>
            <li>Volte aqui em Configurações e ative as notificações</li>
          </ol>
          <p className="text-[11px] mt-3 text-muted-foreground/70">⚠️ Precisa de iPhone com iOS 16.4 ou mais novo.</p>
        </div>
      )}

      {!iosNeedsInstall && pushState === "idle" && (
        <button
          onClick={enablePush}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-teal/30 bg-teal/5 text-left hover:bg-teal/10 transition-colors"
        >
          <Bell className="w-4 h-4 text-teal shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-teal">Ativar notificações neste dispositivo</p>
            <p className="text-xs text-muted-foreground">Receba os trades do bot mesmo com o app fechado</p>
          </div>
        </button>
      )}

      {pushState === "loading" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Configurando dispositivo…
        </p>
      )}

      {pushState === "denied" && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-loss/30 bg-loss/5">
          <BellOff className="w-4 h-4 text-loss shrink-0" />
          <p className="text-xs text-loss">
            Notificações bloqueadas. Libere nas configurações do navegador para receber alertas.
          </p>
        </div>
      )}

      {pushState === "unsupported" && !iosNeedsInstall && (
        <p className="text-xs text-muted-foreground">Este navegador não suporta notificações push.</p>
      )}

      {pushState === "subscribed" && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-profit/10 text-profit">
            <Check className="w-3.5 h-3.5" /> Ativo neste dispositivo
          </span>
          <button
            onClick={testPush}
            disabled={testMsg === "sending"}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-teal/30 text-teal hover:bg-teal/10 transition-colors disabled:opacity-50"
          >
            {testMsg === "sending" ? "Enviando…" : "Enviar teste"}
          </button>
          <button
            onClick={enablePush}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            Reativar
          </button>
          {testMsg === "ok" && <span className="text-xs text-profit">✅ Enviado! Veja a notificação.</span>}
          {testMsg === "fail" && <span className="text-xs text-loss">❌ Falhou. Tente &quot;Reativar&quot;.</span>}
        </div>
      )}
    </div>
  )
}
