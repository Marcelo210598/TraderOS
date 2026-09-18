import type { Metadata } from "next"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { TrilhaOverview } from "@/components/trilha/trilha-overview"
import { SectionTour } from "@/components/tour/section-tour"
import { TRILHA_TOUR_STEPS } from "@/lib/tour-content"
import { hasSeenTour } from "@/lib/tours"

export const metadata: Metadata = { title: "Trilha" }

export default async function TrilhaPage() {
  const session = await auth()
  const user = session!.user

  const trilhaTourSeen = await hasSeenTour(user.id, "trilha")

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <SectionTour id="trilha" steps={TRILHA_TOUR_STEPS} initialSeen={trilhaTourSeen} />
      <Header
        title="Trilha de Aprendizado"
        subtitle="Evolua do básico ao avançado no seu ritmo"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
        tourId="trilha"
      />

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <TrilhaOverview />
      </div>
    </div>
  )
}
