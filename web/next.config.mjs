/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  outputFileTracingIncludes: {
    '/api/web-automation': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        // The service worker must always be fetched fresh, or a fix to it would never reach phones.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
