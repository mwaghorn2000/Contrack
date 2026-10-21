/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

const imageBucketUrl = process.env.S3_PUBLIC_URL
  ? new URL(process.env.S3_PUBLIC_URL)
  : null;

/** @type {import("next").NextConfig} */
const config = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
        port: "",
        pathname: "/avatars/**",
      },
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
        port: "",
        pathname: "/embed/avatars/**",
      },
      ...(imageBucketUrl
        ? [
            {
              protocol: /** @type {"http" | "https"} */ (
                imageBucketUrl.protocol.slice(0, -1)
              ),
              hostname: imageBucketUrl.hostname,
              port: imageBucketUrl.port,
              pathname: `${imageBucketUrl.pathname.replace(/\/$/, "")}/**`,
            },
          ]
        : []),
    ],
  },
};

export default config;
