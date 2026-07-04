import { cloudflarePool } from "@cloudflare/vitest-pool-workers";

export default {
  test: {
    globals: true,
    pool: cloudflarePool({
      wrangler: { configPath: "./wrangler.toml" },
    }),
  },
};
