import type { NextConfig } from "next";

// Headers de segurança aplicados a todas as respostas.
// CSP fica de fora de propósito: o app carrega scripts de terceiros (GA, Meta Pixel,
// Google Ads, Vercel) e um CSP mal calibrado quebraria o tracking — vale a pena, mas
// exige um passo dedicado de teste. Estes 5 headers são seguros e não afetam nada.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
