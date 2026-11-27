/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Imported Blink clips are streamed through the app to the camera service. Next buffers request bodies
    // for its proxy layer and cuts them off at 10 MB by default, so allow clips up to the service limit.
    proxyClientMaxBodySize: "600mb",
    // On a machine short of memory, `NEXT_BUILD_CPUS=1 npm run build` builds with one worker instead of one per core.
    ...(Number(process.env.NEXT_BUILD_CPUS) > 0 ? { cpus: Number(process.env.NEXT_BUILD_CPUS) } : {}),
  },
};

export default nextConfig;
