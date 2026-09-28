// Contato do especialista em mesas proprietárias: Piero, apoio do MeuTrade (combinado pelo Marcelo em 28/09/2026).
// O Marcelo NÃO recebe nada por isso (a monetização do MeuTrade é outra). Trocar aqui se número, site ou termos mudarem.

export const ESPECIALISTA = {
  nome: "Piero",
  rotulo: "Especialista em mesas proprietárias",
  experiencia: "mais de 2 anos no mercado de mesas proprietárias",
  /** Aviso de transparência. Mostrado junto de todo convite pro especialista. */
  avisoParceria:
    "O Piero é um parceiro que apoia o MeuTrade: o MeuTrade não recebe nada por essa indicação. O site de cupons dele é independente e pode receber comissão das mesas por compras feitas pelos links de lá. A sugestão do quiz é calculada só pelas regras da mesa e não muda por causa dessa parceria.",
  avisoSeguranca: "Ao chamar no WhatsApp você fala direto com uma pessoa: nunca envie senhas, códigos ou dados de cartão.",
  site: { nome: "Cupons Mesas Proprietárias", url: "https://cuponsmesasproprietarias.com.br/" },
  whatsapp: { numero: "5547997905555", exibicao: "+55 47 99790-5555" },
} as const

/** Link do WhatsApp com a mensagem já escrita. `assunto` entra depois de "saber mais sobre". */
export const linkWhatsApp = (assunto: string) =>
  `https://wa.me/${ESPECIALISTA.whatsapp.numero}?text=${encodeURIComponent(
    `Olá, ${ESPECIALISTA.nome}! Vim pelo MeuTrade.app e gostaria de saber mais sobre ${assunto}.`
  )}`
