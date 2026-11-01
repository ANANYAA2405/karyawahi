import type { MetadataRoute } from 'next';
import { PALETTE } from '@/lib/tokens';

/**
 * The web app manifest, served at /manifest.webmanifest and linked from every page by Next.
 * It lets Android Chrome offer "Add to home screen" / "Install app": the app then opens on
 * My day, full screen, with the brand mark as its icon. Icons are drawn from the Logo in
 * src/components/Brand.tsx by scripts/gen-icons.cjs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/today',
    name: 'Karyavahi / कार्यवाही',
    short_name: 'कार्यवाही',
    description: 'My day for headmasters and cluster and block coordinators: tasks, proof and photos, also without signal. Demo with fictional data.',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'hi',
    dir: 'ltr',
    background_color: PALETTE.ivory.DEFAULT,
    theme_color: PALETTE.brand.DEFAULT,
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
