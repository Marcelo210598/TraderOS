import Script from "next/script"

// IDs vêm de env vars (NEXT_PUBLIC_* são inlined no build). Sem ID, o bloco não renderiza
// — nada carrega, nada quebra. Pra ativar: setar na Vercel e REDEPLOYAR.
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID // ex: "123456789012345"
const GA_ID = process.env.NEXT_PUBLIC_GA_ID                 // GA4, ex: "G-XXXXXXX"
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID // Google Ads, ex: "AW-XXXXXXX"

/**
 * Pixels de retargeting/analytics. Meta Pixel (retargeting Facebook/Instagram) +
 * Google gtag (GA4 e/ou Google Ads). Carregam após interação pra não travar o load.
 */
export function TrackingScripts() {
  const googleId = GA_ID || GOOGLE_ADS_ID
  return (
    <>
      {META_PIXEL_ID && (
        <>
          <Script id="meta-pixel" strategy="afterInteractive">
            {`!function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window,document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${META_PIXEL_ID}');
            fbq('track', 'PageView');`}
          </Script>
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              alt=""
              src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}

      {googleId && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${googleId}`} strategy="afterInteractive" />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            ${GA_ID ? `gtag('config', '${GA_ID}');` : ""}
            ${GOOGLE_ADS_ID ? `gtag('config', '${GOOGLE_ADS_ID}');` : ""}`}
          </Script>
        </>
      )}
    </>
  )
}
