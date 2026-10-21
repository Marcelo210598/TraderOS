// Tela do AI Partner (E7-15e, D-U1): quem pode ver as duas entradas. Decisão PURA com `env` injetado (testável sem mexer em process.env); o chamador (página no servidor) passa process.env.
//   · prévia `/dev/ai-partner` (transporte falso): SÓ com NODE_ENV === "development";
//   · página real `/ai-partner`: SÓ com AI_PARTNER_UI exatamente "1" (em produção a variável não existe ⇒ notFound()).
type Env = { readonly NODE_ENV?: string; readonly AI_PARTNER_UI?: string }
export const isAiPartnerPreviewEnabled = (env: Env): boolean => env.NODE_ENV === "development"
export const isAiPartnerPageEnabled = (env: Env): boolean => env.AI_PARTNER_UI === "1"
