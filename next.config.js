const path = require('path');

/** @type {import('next').NextConfig} */
const uiRailV2Enabled = process.env.UI_RAIL_V2 !== 'off';

const nextConfig = {
  reactStrictMode: true,
  env: {
    UI_RAIL_V2: uiRailV2Enabled ? 'on' : 'off',
    NEXT_PUBLIC_UI_RAIL_V2: uiRailV2Enabled ? 'on' : 'off',
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
          },
        ],
      },
    ];
  },
  turbopack: {},
  webpack: (config) => {
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['@/providers'] = path.join(__dirname, 'src/vendor-shims/providers.tsx');
    return config;
  },
};

module.exports = nextConfig;
