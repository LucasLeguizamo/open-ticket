import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Builds de verificación (CI/agente) a un dir aparte: `next build` sobre el
  // .next de un `next dev` activo invalida sus assets y la pestaña abierta
  // entra en loop de full-reload. Uso: NEXT_DIST_DIR=.next-build pnpm build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Cache Components (PPR): páginas de evento y feed usan `use cache`
  // + cacheLife/cacheTag; invalidación con revalidateTag (route handlers)
  // y updateTag (server actions). Nada de unstable_cache legacy.
  cacheComponents: true,
  experimental: {
    // View Transitions (React 19 <ViewTransition>): la web humana lo usa en F1;
    // en F0 queda habilitado + ejemplo mínimo en la página de evento.
    viewTransition: true,
  },
};

export default nextConfig;
