import path from "path";
import { config, createRedisQueue, prisma } from "@judge/shared";
import { createApp } from "./app";

async function main() {
    const queue = await createRedisQueue(config.redisUrl);
    console.log("Connected to Redis");

    const app = createApp({
        db: prisma,
        queue,
        staticDir: path.resolve(__dirname, "../../web/dist"),
    });
    app.listen(config.port, () => {
        console.log(`API listening on http://localhost:${config.port}`);
    });
}

main().catch((e) => {
    console.error("Failed to start the API", e);
    process.exit(1);
});
