"use client"

import { useState } from "react"
import { updateProfile, updatePassword } from "@/app/actions/settings"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/toast"

interface SettingsFormsProps {
  userName: string | null
  userEmail: string | null
  hasPassword: boolean
}

function FormMessage({ type, text }: { type: "success" | "error"; text: string }) {
  return (
    <p className={cn("text-xs mt-2", type === "success" ? "text-profit" : "text-loss")}>
      {text}
    </p>
  )
}

export function ProfileForm({ userName, userEmail }: Pick<SettingsFormsProps, "userName" | "userEmail">) {
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMsg(null)
    const res = await updateProfile(new FormData(e.currentTarget))
    setLoading(false)
    if (res.error) setMsg({ type: "error", text: res.error })
    else {
      setMsg({ type: "success", text: "Nome atualizado com sucesso!" })
      toast.success("Nome atualizado com sucesso!")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="profile-name" className="block text-xs text-muted-foreground mb-1.5">Nome</label>
        <input
          id="profile-name"
          name="name"
          defaultValue={userName ?? ""}
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-teal transition-colors"
          placeholder="Seu nome"
        />
      </div>
      <div>
        <label htmlFor="profile-email" className="block text-xs text-muted-foreground mb-1.5">Email</label>
        <input
          id="profile-email"
          value={userEmail ?? ""}
          disabled
          className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
        />
        <p className="text-xs text-muted-foreground mt-1">Email não pode ser alterado</p>
      </div>
      {msg && <FormMessage type={msg.type} text={msg.text} />}
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 bg-teal text-teal-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "Salvando..." : "Salvar alterações"}
      </button>
    </form>
  )
}

export function PasswordForm({ hasPassword }: Pick<SettingsFormsProps, "hasPassword">) {
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  if (!hasPassword) {
    return (
      <p className="text-sm text-muted-foreground">
        Sua conta foi criada via Google OAuth — não há senha para alterar.
      </p>
    )
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMsg(null)
    const form = e.currentTarget
    const res = await updatePassword(new FormData(form))
    setLoading(false)
    if (res.error) {
      setMsg({ type: "error", text: res.error })
    } else {
      setMsg({ type: "success", text: "Senha alterada com sucesso!" })
      toast.success("Senha alterada com sucesso!")
      form.reset()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="current-password" className="block text-xs text-muted-foreground mb-1.5">Senha atual</label>
        <input
          id="current-password"
          name="currentPassword"
          type="password"
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-teal transition-colors"
          placeholder="••••••••"
        />
      </div>
      <div>
        <label htmlFor="new-password" className="block text-xs text-muted-foreground mb-1.5">Nova senha</label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-teal transition-colors"
          placeholder="••••••••"
        />
        <p className="text-xs text-muted-foreground mt-1">Mínimo 8 caracteres</p>
      </div>
      {msg && <FormMessage type={msg.type} text={msg.text} />}
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 bg-teal text-teal-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "Alterando..." : "Alterar senha"}
      </button>
    </form>
  )
}
