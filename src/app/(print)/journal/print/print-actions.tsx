"use client"

import { useEffect } from "react"
import { Printer, ArrowLeft } from "lucide-react"

export function PrintActions() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 600)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="flex items-center gap-3 p-4 bg-white border-b border-gray-200 print:hidden">
      <a
        href="/journal"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar ao Journal
      </a>
      <button
        onClick={() => window.print()}
        className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
      >
        <Printer className="w-4 h-4" />
        Imprimir / Salvar PDF
      </button>
      <p className="text-xs text-gray-400 ml-2">O diálogo de impressão abrirá automaticamente. Escolha &quot;Salvar como PDF&quot; para exportar.</p>
    </div>
  )
}
