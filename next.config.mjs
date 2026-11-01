/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Imported Blink clips are streamed through the app to the camera service. Next buffers request bodies
    // for its proxy layer and cuts them off at 10 MB by default, so allow clips up to the service limit.
    proxyClientMaxBodySize: "600mb",
  },
};

export default nextConfig;
