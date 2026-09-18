"use client"

import { OnboardingModal } from "@/components/onboarding/onboarding-modal"
import { SectionTour } from "@/components/tour/section-tour"
import { DASHBOARD_TOUR_STEPS } from "@/lib/tour-content"

interface Props {
  isNewUser: boolean
  onboardingSeen: boolean
  dashboardTourSeen: boolean
}

// Decide entre o onboarding (5 telas, só na 1ª vez sem nenhum trade) e o tour
// guiado do dashboard — nunca os dois ao mesmo tempo, e nunca nenhum dos dois.
// `onboardingSeen`/`dashboardTourSeen` vêm do server (User.seenTours), então
// dá pra decidir isso na hora, sem useEffect nem risco de hydration mismatch.
export function DashboardIntro({ isNewUser, onboardingSeen, dashboardTourSeen }: Props) {
  const onboardingPending = isNewUser && !onboardingSeen

  return (
    <>
      <OnboardingModal isNewUser={isNewUser} initialSeen={onboardingSeen} />
      {!onboardingPending && (
        <SectionTour id="dashboard" steps={DASHBOARD_TOUR_STEPS} initialSeen={dashboardTourSeen} />
      )}
    </>
  )
}
