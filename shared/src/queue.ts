import { createClient } from "redis";

/** FIFO queue of submission ids. */
export interface SubmissionQueue {
    enqueue(submissionId: string): Promise<void>;
    /** waits up to timeoutSeconds for the next id; null on timeout */
    dequeue(timeoutSeconds: number): Promise<string | null>;
    close(): Promise<void>;
}

export const QUEUE_KEY = "judge:queue";

export async function createRedisQueue(url: string, key: string = QUEUE_KEY): Promise<SubmissionQueue> {
    const client = createClient({ url });
    client.on("error", (err) => console.error("Redis client error", err));
    await client.connect();
    return {
        async enqueue(id) {
            await client.lPush(key, id);
        },
        async dequeue(timeoutSeconds) {
            const item = await client.brPop(key, timeoutSeconds);
            return item ? item.element : null;
        },
        async close() {
            await client.quit();
        },
    };
}

/** In-process queue for tests and quick experiments. */
export function createMemoryQueue(): SubmissionQueue & { size(): number } {
    const items: string[] = [];
    return {
        async enqueue(id) {
            items.push(id);
        },
        async dequeue() {
            return items.shift() ?? null;
        },
        async close() {},
        size: () => items.length,
    };
}
