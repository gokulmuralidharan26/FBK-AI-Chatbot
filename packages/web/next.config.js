/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse uses dynamic require – keep it server-only
  serverExternalPackages: ['pdf-parse'],

  turbopack: {
    // Point to the monorepo root so Turbopack finds the correct lockfile
    root: '../../',
  },

  async headers() {
    return [
      {
        // Allow the embedded widget (on any origin) to call public API routes
        source: '/api/chat',
        headers: corsHeaders,
      },
      {
        source: '/api/feedback',
        headers: corsHeaders,
      },
      {
        // Serve widget.js with correct MIME + cache headers
        source: '/widget.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript' },
          { key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },
};

const corsHeaders = [
  { key: 'Access-Control-Allow-Origin', value: '*' },
  { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
];

module.exports = nextConfig;
