// Flags centrais pra ligar/desligar integrações de sync automático sem apagar
// código nem dados. Compartilhado entre a UI (integration-section.tsx) e as
// rotas de API que recebem/preparam a sincronização — mudar aqui afeta os dois.
//
// Pra religar uma integração: trocar a flag pra true. UI, tutorial e backend
// voltam intactos.

// Pausado em 17/09/2026: base do app (Journal, Analytics, etc.) precisa ficar
// redonda e bem testada antes de reabrir sync automático — não só NT8, outras
// integrações futuras também vão passar por esse mesmo ciclo de calibração.
export const NT8_ENABLED = false

// Desativado desde 13/07/2026 (sync de trades do MT5 nunca chegou no app).
export const MT5_ENABLED = false
