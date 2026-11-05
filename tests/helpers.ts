import { prisma } from "@judge/shared";
import type { Executor, Problem, RunResult, Sandbox } from "@judge/shared";

export async function resetDb() {
    await prisma.$executeRawUnsafe('TRUNCATE "Submission"');
}

export function makeProblem(overrides: Partial<Problem> = {}): Problem {
    return {
        id: "add",
        title: "Add",
        difficulty: "Easy",
        statement: "Print a+b",
        timeLimitMs: 1000,
        tests: [
            { input: "1 2\n", output: "3\n", hidden: false },
            { input: "10 -4\n", output: "6\n", hidden: true },
        ],
        ...overrides,
    };
}

const ok = (stdout: string): RunResult => ({ kind: "ok", stdout, stderr: "", exitCode: 0 });

/** An executor that never touches Docker: `run` decides the outcome for each test input. */
export function fakeExecutor(opts: {
    compile?: { ok: true } | { ok: false; log: string };
    run: (input: string, timeLimitMs: number) => RunResult | Promise<RunResult>;
}): Executor {
    return {
        async prepare(): Promise<Sandbox> {
            return {
                compile: async () => opts.compile ?? { ok: true },
                run: async (input, limit) => opts.run(input, limit),
                dispose: async () => {},
            };
        },
    };
}

/** Correct "a + b" behavior for the fake executor. */
export function addRun(input: string): RunResult {
    const [a, b] = input.trim().split(/\s+/).map(Number);
    return ok(`${a! + b!}\n`);
}

export { ok };
