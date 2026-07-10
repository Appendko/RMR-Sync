import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/shareCategories.test.js"],
    environment: "node",
    globals: true,
  },
});
