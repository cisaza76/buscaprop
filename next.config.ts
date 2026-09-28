import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy de PostHog: el browser le habla a /ingest (mismo dominio) y Next
  // reenvía a PostHog US. Sin esto los adblockers cortan los eventos.
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
    ];
  },
  // Los endpoints de PostHog llevan barra final; sin esto Next redirige y el
  // SDK pierde el POST.
  skipTrailingSlashRedirect: true,
  images: {
    // Hosts de los 4 portales scrapeados. Sin esto, <Image> rechaza
    // las URLs externas con error "Invalid src prop".
    remotePatterns: [
      // Fincaraíz (CDN compartido con InfoCasas LATAM)
      { protocol: 'https', hostname: 'cdn2.infocasas.com.uy' },
      { protocol: 'https', hostname: 'static-prod-asset.fincaraiz.com.co' },
      // MetroCuadrado
      { protocol: 'https', hostname: 'multimedia.metrocuadrado.com' },
      // Properati (URLs base64-encoded en path)
      { protocol: 'https', hostname: 'img.properati.com' },
      // Ciencuadras (S3 dedicado)
      { protocol: 'https', hostname: 'www-img-cc.s3.amazonaws.com' },
      // Sample data placeholders
      { protocol: 'https', hostname: 'placehold.co' },
    ],
  },
};

export default nextConfig;
