import { ExternalLink, MessageCircle } from "lucide-react"
import { ESPECIALISTA, linkWhatsApp } from "@/lib/mesas/contato"
import { LinkComAviso } from "./link-com-aviso"

/** `assunto` completa a mensagem do WhatsApp: "...saber mais sobre {assunto}." */
export function ContatoEspecialista({ assunto }: { assunto: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-lg font-semibold">Ficou com dúvida?</h2>
      <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-2xl">
        Fale com o <strong className="text-foreground">{ESPECIALISTA.nome}</strong>, nosso especialista, com{" "}
        {ESPECIALISTA.experiencia}. Ele ajuda a tirar dúvidas e a escolher a mesa
        e o plano que combinam com o seu momento. A mensagem já vai pronta, é só enviar.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={linkWhatsApp(assunto)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-medium text-teal-foreground hover:opacity-90 transition-opacity"
        >
          <MessageCircle className="size-4" aria-hidden />
          Chamar no WhatsApp
          <span className="text-xs font-normal opacity-80">{ESPECIALISTA.whatsapp.exibicao}</span>
        </a>

        <LinkComAviso
          href={ESPECIALISTA.site.url}
          titulo="Você vai sair do MeuTrade"
          aviso={`${ESPECIALISTA.site.nome} é um site de terceiros, com conteúdo e ofertas próprios. O MeuTrade não controla o que está lá. É um site de cupons e pode receber comissão por compras feitas pelos links dele. Confira sempre as regras no site oficial da mesa antes de comprar.`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Conhecer o site {ESPECIALISTA.site.nome} <ExternalLink className="size-3.5" aria-hidden />
        </LinkComAviso>
      </div>

      <p className="mt-4 text-xs text-muted-foreground leading-relaxed max-w-2xl">
        {ESPECIALISTA.avisoParceria} {ESPECIALISTA.avisoSeguranca}
      </p>
    </section>
  )
}
