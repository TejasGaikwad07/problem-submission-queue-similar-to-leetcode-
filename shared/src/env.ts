import path from "path";
import dotenv from "dotenv";

// Load the repo-root .env regardless of which workspace folder the process was started from.
// Variables already set in the environment (CI, tests) win over the file.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const config = {
    port: Number(process.env.PORT ?? 3000),
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    maxCodeBytes: 50_000,
};
