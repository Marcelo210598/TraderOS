// Tela do AI Partner (E7-15e, D-U1): quem pode ver as duas entradas. Decisão PURA com `env` injetado (testável sem mexer em process.env); o chamador (página no servidor) passa process.env.
//   · prévia `/dev/ai-partner` (transporte falso): SÓ com NODE_ENV === "development";
//   · página real `/ai-partner`: SÓ com AI_PARTNER_UI exatamente "1" (em produção a variável não existe ⇒ notFound()).
type Env = { readonly NODE_ENV?: string; readonly AI_PARTNER_UI?: string; readonly AI_PARTNER_ALLOWED_EMAILS?: string }
export const isAiPartnerPreviewEnabled = (env: Env): boolean => env.NODE_ENV === "development"
export const isAiPartnerPageEnabled = (env: Env): boolean => env.AI_PARTNER_UI === "1"

/** E7-18: quem pode usar o AI Partner em produção. Exige AI_PARTNER_UI exatamente "1" E o e-mail da sessão na lista AI_PARTNER_ALLOWED_EMAILS
 *  (separada por vírgula; comparação EXATA, sem diferença de maiúsculas nem de espaços nas pontas). Lista ausente/vazia ⇒ ninguém (falha fechada). */
export const isAiPartnerUserAllowed = (env: Env, email: unknown): boolean => {
  if (!isAiPartnerPageEnabled(env) || typeof email !== "string") return false
  const who = email.trim().toLowerCase()
  if (who === "") return false
  return (env.AI_PARTNER_ALLOWED_EMAILS ?? "").split(",").some((e) => e.trim().toLowerCase() === who)
}
