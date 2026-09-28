"use client"

import { useRef } from "react"

interface Props {
  href: string
  titulo: string
  aviso: string
  className?: string
  children: React.ReactNode
}

// Link externo que abre um aviso antes de sair do MeuTrade. Sem JavaScript, o link continua funcionando direto.
export function LinkComAviso({ href, titulo, aviso, className, children }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={(e) => {
          e.preventDefault()
          dialogRef.current?.showModal()
        }}
      >
        {children}
      </a>

      <dialog
        ref={dialogRef}
        aria-labelledby="aviso-saida-titulo"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/60"
        onClick={(e) => {
          // clique no fundo escurecido fecha
          if (e.target === dialogRef.current) dialogRef.current?.close()
        }}
      >
        <h3 id="aviso-saida-titulo" className="text-base font-semibold">
          {titulo}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{aviso}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Voltar
          </button>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-teal-foreground hover:opacity-90 transition-opacity"
          >
            Continuar
          </a>
        </div>
      </dialog>
    </>
  )
}
