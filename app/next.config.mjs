/** @type {import('next').NextConfig} */
const nextConfig = {
  // The domain rules live outside app/ in ../src so the seed generator, the validator and
  // the app all run the same code. Next must transpile those .ts files.
  outputFileTracingRoot: new URL('..', import.meta.url).pathname,
  // Server actions carry an uploaded assessment CSV as text; a whole-state round is ~1.5 MB.
  // Proof photos are shrunk in the browser first; the server still refuses anything over 5 MB.
  experimental: { externalDir: true, serverActions: { bodySizeLimit: '8mb' } },
  serverExternalPackages: ['node:sqlite'],
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
