import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification builds (CI/agent) go to a separate dir: running `next build`
  // over the .next of an active `next dev` invalidates its assets and the open
  // tab falls into a full-reload loop. Usage: NEXT_DIST_DIR=.next-build pnpm build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Cache Components (PPR): event pages and the feed use `use cache`
  // + cacheLife/cacheTag; invalidation via revalidateTag (route handlers)
  // and updateTag (server actions). No legacy unstable_cache.
  cacheComponents: true,
  experimental: {
    // View Transitions (React 19 <ViewTransition>): the human web uses it in F1;
    // in F0 it stays enabled + a minimal example on the event page.
    viewTransition: true,
  },
};

export default nextConfig;
