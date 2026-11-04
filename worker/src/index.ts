import {
    config,
    createDockerExecutor,
    createRedisQueue,
    isDockerAvailable,
    prisma,
    processSubmission,
} from "@judge/shared";

async function main() {
    if (!isDockerAvailable()) {
        throw new Error("Docker is not available. Start Docker Desktop, then run `npm run judge:pull-images`.");
    }
    const queue = await createRedisQueue(config.redisUrl);
    const executor = createDockerExecutor();
    console.log("Worker connected to Redis; waiting for submissions.");

    let stopping = false;
    const stop = () => {
        stopping = true;
        console.log("Stopping after the current submission...");
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    // One submission at a time; the 5s block timeout lets the loop notice a stop request.
    while (!stopping) {
        try {
            const id = await queue.dequeue(5);
            if (!id) continue;
            console.log(`Judging ${id}`);
            await processSubmission(prisma, executor, id);
            console.log(`Finished ${id}`);
        } catch (e) {
            console.error("Worker loop error", e);
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
    await queue.close();
    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
