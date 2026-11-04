/** Tests use a real Postgres (DATABASE_URL_TEST) and, where marked, real Docker; run serially. */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  maxWorkers: 1,
  testTimeout: 30000,
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json", diagnostics: false }],
  },
};
