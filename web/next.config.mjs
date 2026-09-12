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
}

export default nextConfig
