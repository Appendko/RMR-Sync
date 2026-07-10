import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/shareCategories.crosscheck.test.js"],
    environment: "node",
    globals: true,
  },
});
