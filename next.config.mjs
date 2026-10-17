/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/api/**': ['./data/**/*.json'],
    '/': ['./data/**/*.json'],
  },
};

export default nextConfig;
