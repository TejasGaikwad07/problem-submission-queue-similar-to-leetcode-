import request from "supertest";
import { createMemoryQueue, getProblem, prisma, processSubmission } from "@judge/shared";
import { createApp } from "../express-server/src/app";
import { addRun, fakeExecutor, ok, resetDb } from "./helpers";

const queue = createMemoryQueue();
const app = createApp({ db: prisma, queue });

beforeEach(async () => {
    await resetDb();
    while (queue.size() > 0) await queue.dequeue(0);
});

afterAll(async () => {
    await prisma.$disconnect();
});

const twoSum = getProblem("two-sum")!;
/** Solves two-sum correctly, as a stand-in for a real sandboxed program. */
const solveTwoSum = (input: string) => {
    const [first, second] = input.trim().split("\n");
    const target = Number(first!.split(" ")[1]);
    const a = second!.split(" ").map(Number);
    for (let i = 0; i < a.length; i++)
        for (let j = i + 1; j < a.length; j++) if (a[i]! + a[j]! === target) return ok(`${i} ${j}\n`);
    return ok("none\n");
};

async function submit(body: object) {
    return request(app).post("/submit").send(body);
}

describe("GET /problems", () => {
    test("lists the problems", async () => {
        const res = await request(app).get("/problems");
        expect(res.status).toBe(200);
        expect(res.body.map((p: { id: string }) => p.id)).toContain("two-sum");
        expect(res.body[0]).not.toHaveProperty("tests");
    });

    test("a problem has a statement and examples but never hidden tests", async () => {
        const res = await request(app).get("/problems/two-sum");
        expect(res.status).toBe(200);
        expect(res.body.statement).toBeTruthy();
        expect(res.body.examples.length).toBeGreaterThan(0);
        expect(res.body).not.toHaveProperty("tests");
        const text = JSON.stringify(res.body);
        for (const t of twoSum.tests.filter((t) => t.hidden)) expect(text).not.toContain(JSON.stringify(t.input));
    });

    test("unknown problem is 404", async () => {
        expect((await request(app).get("/problems/nope")).status).toBe(404);
    });
});

describe("POST /submit validation", () => {
    const good = { problemId: "two-sum", language: "python", code: "print(1)" };

    test.each([
        ["missing code", { ...good, code: undefined }],
        ["empty code", { ...good, code: "" }],
        ["unsupported language", { ...good, language: "cobol" }],
        ["missing problemId", { ...good, problemId: undefined }],
        ["wrong types", { problemId: 5, language: "python", code: 1 }],
    ])("rejects %s with 400 and stores nothing", async (_name, body) => {
        const res = await submit(body);
        expect(res.status).toBe(400);
        expect(await prisma.submission.count()).toBe(0);
        expect(queue.size()).toBe(0);
    });

    test("rejects code over the size limit", async () => {
        const res = await submit({ ...good, code: "x".repeat(50_001) });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain("at most");
        expect(await prisma.submission.count()).toBe(0);
    });

    test("accepts code exactly at the limit", async () => {
        const res = await submit({ ...good, code: "#".repeat(50_000) });
        expect(res.status).toBe(201);
    });

    test("an absurdly large body is rejected before parsing", async () => {
        const res = await submit({ ...good, code: "x".repeat(400_000) });
        expect(res.status).toBe(413);
    });

    test("unknown problem is 404", async () => {
        expect((await submit({ ...good, problemId: "nope" })).status).toBe(404);
    });
});

describe("submission flow", () => {
    test("submit returns an id immediately and the submission is stored as queued", async () => {
        const res = await submit({ problemId: "two-sum", language: "python", code: "print(1)" });
        expect(res.status).toBe(201);

        const stored = await prisma.submission.findUniqueOrThrow({ where: { id: res.body.submissionId } });
        expect(stored).toMatchObject({ status: "queued", language: "python", code: "print(1)", verdict: null });
        expect(queue.size()).toBe(1);

        const status = await request(app).get(`/submissions/${res.body.submissionId}`);
        expect(status.body).toMatchObject({ status: "queued", verdict: null });
        expect(status.body).not.toHaveProperty("code");
    });

    test("end to end: queued -> done with Accepted", async () => {
        const res = await submit({ problemId: "two-sum", language: "python", code: "ok" });
        const id = res.body.submissionId;

        const next = await queue.dequeue(0);
        expect(next).toBe(id);
        await processSubmission(prisma, fakeExecutor({ run: solveTwoSum }), next!);

        const done = await request(app).get(`/submissions/${id}`);
        expect(done.body).toMatchObject({ status: "done", verdict: "Accepted", failedTest: null });
        expect(done.body.startedAt).toBeTruthy();
        expect(done.body.finishedAt).toBeTruthy();
    });

    test("end to end: a wrong program gets Wrong Answer with the failing test number", async () => {
        const res = await submit({ problemId: "two-sum", language: "javascript", code: "bad" });
        const id = res.body.submissionId;
        await processSubmission(prisma, fakeExecutor({ run: () => ok("9 9\n") }), (await queue.dequeue(0))!);

        const done = await request(app).get(`/submissions/${id}`);
        expect(done.body).toMatchObject({ status: "done", verdict: "WrongAnswer", failedTest: 1 });
    });

    test("an internal failure ends as done with no verdict and an explanation", async () => {
        const res = await submit({ problemId: "two-sum", language: "python", code: "x" });
        const silence = jest.spyOn(console, "error").mockImplementation(() => {});
        const boom = { prepare: async () => { throw new Error("docker exploded"); } };
        await processSubmission(prisma, boom, res.body.submissionId);
        silence.mockRestore();

        const done = await request(app).get(`/submissions/${res.body.submissionId}`);
        expect(done.body.status).toBe("done");
        expect(done.body.verdict).toBeNull();
        expect(done.body.detail).toContain("docker exploded");
    });

    test("a submission is only judged once even if it is queued twice", async () => {
        const res = await submit({ problemId: "two-sum", language: "python", code: "x" });
        let runs = 0;
        const executor = fakeExecutor({ run: (i) => { runs++; return solveTwoSum(i); } });
        await Promise.all([
            processSubmission(prisma, executor, res.body.submissionId),
            processSubmission(prisma, executor, res.body.submissionId),
        ]);
        expect(runs).toBe(twoSum.tests.length);
    });

    test("GET /submissions/:id: unknown and malformed ids are 404", async () => {
        expect((await request(app).get("/submissions/00000000-0000-4000-8000-000000000000")).status).toBe(404);
        expect((await request(app).get("/submissions/not-a-uuid")).status).toBe(404);
    });
});

test("fake executor sanity: addRun works", () => {
    expect(addRun("2 3\n").stdout).toBe("5\n");
});
