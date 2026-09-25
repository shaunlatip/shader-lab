import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile in $HOME otherwise makes Next
  // infer the wrong root directory.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Portless serves each branch at <branch>.shader-lab.localhost. Next blocks
  // cross-origin dev resources (the HMR socket) by default, and without the
  // socket the client-only editor never mounts — a blank page.
  allowedDevOrigins: ["*.shader-lab.localhost"],
};

export default nextConfig;
