"use client"

import { useEffect, useState } from "react"
import { OnboardingModal } from "@/components/onboarding/onboarding-modal"
import { SectionTour } from "@/components/tour/section-tour"
import { DASHBOARD_TOUR_STEPS } from "@/lib/tour-content"

const ONBOARDING_KEY = "traderos_onboarding_v1"

// Decide entre o onboarding (5 telas, só na 1ª vez sem nenhum trade) e o tour
// guiado do dashboard — nunca os dois ao mesmo tempo, e nunca nenhum dos dois.
// Bug corrigido: antes, uma conta com 0 trades que já tinha dispensado o
// onboarding há tempos (localStorage antigo) não via NADA, porque o tour
// também ficava bloqueado enquanto isNewUser fosse true.
export function DashboardIntro({ isNewUser }: { isNewUser: boolean }) {
  const [showTour, setShowTour] = useState(false)

  useEffect(() => {
    const onboardingPending = isNewUser && !localStorage.getItem(ONBOARDING_KEY)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!onboardingPending) setShowTour(true)
  }, [isNewUser])

  return (
    <>
      <OnboardingModal isNewUser={isNewUser} />
      {showTour && <SectionTour id="dashboard" steps={DASHBOARD_TOUR_STEPS} />}
    </>
  )
}
