import { createRedisQueue } from "@judge/shared";

// Needs a Redis; set REDIS_URL_TEST to run it (CI does). Skipped, with a message, otherwise.
const url = process.env.REDIS_URL_TEST;
if (!url) {
    console.warn("\n[queue.test.ts] SKIPPED: REDIS_URL_TEST is not set, so the Redis queue was not tested.\n");
}
const redisDescribe = url ? describe : describe.skip;

redisDescribe("Redis queue", () => {
    const key = `judge:test:${Date.now()}`;

    test("is FIFO and dequeue times out with null when empty", async () => {
        const queue = await createRedisQueue(url!, key);
        try {
            await queue.enqueue("a");
            await queue.enqueue("b");
            expect(await queue.dequeue(1)).toBe("a");
            expect(await queue.dequeue(1)).toBe("b");
            expect(await queue.dequeue(1)).toBeNull();
        } finally {
            await queue.close();
        }
    });
});
