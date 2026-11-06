/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Imported Blink clips are streamed through the app to the camera service. Next buffers request bodies
    // for its proxy layer and cuts them off at 10 MB by default, so allow clips up to the service limit.
    proxyClientMaxBodySize: "600mb",
  },
  async redirects() {
    // Pages that moved when the app was reorganised (see lib/nav-config.ts). Old links and bookmarks keep working.
    return [
      { source: "/operations", destination: "/daily-round", permanent: true },
      { source: "/health/tests", destination: "/health?tab=tests", permanent: true },
      { source: "/health/treatments", destination: "/health?tab=treatments", permanent: true },
    ];
  },
};

export default nextConfig;
