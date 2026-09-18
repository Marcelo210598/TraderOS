"use client"

import { OnboardingModal } from "@/components/onboarding/onboarding-modal"
import { SectionTour } from "@/components/tour/section-tour"
import { DASHBOARD_TOUR_STEPS } from "@/lib/tour-content"

interface Props {
  onboardingSeen: boolean
  dashboardTourSeen: boolean
}

// Decide entre o onboarding (5 telas, so na 1a vez logando) e o tour guiado do
// dashboard — nunca os dois ao mesmo tempo, e nunca nenhum dos dois depois que
// ja foram vistos. So depende de "ja visto" (User.seenTours) — NUNCA de quantos
// trades reais o usuario tem agora. Bug corrigido: antes usava isNewUser (0
// trades nao-TEST), e isso reabria o onboarding pra usuario antigo sempre que
// os trades "reais" dele zerassem (ex: arquivar contas antigas) — mesmo tendo
// usado o app por meses.
export function DashboardIntro({ onboardingSeen, dashboardTourSeen }: Props) {
  const onboardingPending = !onboardingSeen

  return (
    <>
      <OnboardingModal initialSeen={onboardingSeen} />
      {!onboardingPending && (
        <SectionTour id="dashboard" steps={DASHBOARD_TOUR_STEPS} initialSeen={dashboardTourSeen} />
      )}
    </>
  )
}
