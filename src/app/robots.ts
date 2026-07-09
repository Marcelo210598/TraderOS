import type { MetadataRoute } from "next"

const BASE_URL = "https://meutrade.app"

// Só a landing e as telas de auth são públicas — tudo em (app) exige login
// e não deve ser rastreado (é dado pessoal, não conteúdo pra indexar).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login", "/cadastro"],
      disallow: [
        "/api/",
        "/dashboard",
        "/journal",
        "/planos",
        "/setups",
        "/carteira",
        "/checkin",
        "/calendario",
        "/desafios",
        "/trilha",
        "/analytics",
        "/planner",
        "/guardian",
        "/configuracoes",
        "/notificacoes",
        "/admin",
        "/ask-claude",
        "/progress",
        "/share",
        "/logout",
      ],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
