import type { NextConfig } from "next";

// CSP em modo ENFORCE (16/09): validado sem violação nas páginas públicas (landing,
// login, planos) via navegador real antes de ligar. Continua mandando violações pra
// /api/csp-report — se aparecer algo bloqueado que não devia, é sinal de calibrar a
// lista, não de voltar pro Report-Only. Inclui os domínios de terceiros que o app usa
// (GA/gtag, Meta Pixel, Vercel Analytics/Speed Insights, UploadThing) + service worker.
// 'unsafe-inline'/'unsafe-eval' cobrem os <Script> inline (pixel/gtag) e a hidratação
// do Next; dá pra endurecer com nonce depois.
const cspPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://connect.facebook.net https://va.vercel-scripts.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net https://connect.facebook.net https://www.facebook.com https://www.google.com https://googleads.g.doubleclick.net https://www.googleadservices.com https://vitals.vercel-insights.com https://va.vercel-scripts.com https://*.uploadthing.com https://uploadthing.com https://utfs.io https://*.ufs.sh",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self'",
  "report-uri /api/csp-report",
].join("; ");

// Headers de segurança aplicados a todas as respostas.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: cspPolicy },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "utfs.io",
      },
      {
        protocol: "https",
        hostname: "uploadthing.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
