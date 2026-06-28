// Helper pra abrir o modal de upgrade de qualquer lugar do client.
// O modal (UpgradeModal) escuta o evento e aparece.

export interface UpgradeDetail {
  reason?: string
  suggestedPlan?: "TRADER" | "PRO"
}

export const UPGRADE_EVENT = "traderos:upgrade"

export function openUpgradeModal(detail: UpgradeDetail = {}): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(UPGRADE_EVENT, { detail }))
}
