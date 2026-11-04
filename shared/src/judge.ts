import type { Language } from "./languages";
import type { Problem } from "./problems";

export type Verdict =
    | "Accepted"
    | "WrongAnswer"
    | "TimeLimitExceeded"
    | "RuntimeError"
    | "CompilationError";

export interface JudgeResult {
    verdict: Verdict;
    /** 1-based number of the first failing test case */
    failedTest: number | null;
    detail: string | null;
}

export interface RunResult {
    kind: "ok" | "timeout" | "output_limit" | "error";
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

/** One prepared submission: the code is on disk (or wherever) and can be compiled and run. */
export interface Sandbox {
    compile(): Promise<{ ok: true } | { ok: false; log: string }>;
    run(input: string, timeLimitMs: number): Promise<RunResult>;
    dispose(): Promise<void>;
}

/** Abstraction over "run this code safely". The Docker implementation is in dockerExecutor.ts. */
export interface Executor {
    prepare(language: Language, code: string): Promise<Sandbox>;
}

const DETAIL_LIMIT = 2000;
const clip = (s: string) => (s.length > DETAIL_LIMIT ? s.slice(0, DETAIL_LIMIT) + "\n...(truncated)" : s);

/** Windows line endings and trailing whitespace (per line and at the end) do not matter. */
export function normalizeOutput(s: string): string {
    return s
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trimEnd();
}

export function outputsMatch(actual: string, expected: string): boolean {
    return normalizeOutput(actual) === normalizeOutput(expected);
}

export async function judge(
    executor: Executor,
    problem: Problem,
    language: Language,
    code: string
): Promise<JudgeResult> {
    const sandbox = await executor.prepare(language, code);
    try {
        const compiled = await sandbox.compile();
        if (!compiled.ok) {
            return { verdict: "CompilationError", failedTest: null, detail: clip(compiled.log) };
        }

        for (let i = 0; i < problem.tests.length; i++) {
            const test = problem.tests[i]!;
            const number = i + 1;
            const result = await sandbox.run(test.input, problem.timeLimitMs);

            if (result.kind === "timeout") {
                return {
                    verdict: "TimeLimitExceeded",
                    failedTest: number,
                    detail: `Exceeded ${problem.timeLimitMs} ms`,
                };
            }
            if (result.kind === "output_limit") {
                return { verdict: "RuntimeError", failedTest: number, detail: "Output limit exceeded" };
            }
            if (result.kind === "error" || result.exitCode !== 0) {
                const why = result.exitCode === 137 ? "Killed (likely out of memory). " : "";
                return {
                    verdict: "RuntimeError",
                    failedTest: number,
                    detail: clip(`${why}Exit code ${result.exitCode}\n${result.stderr}`.trim()),
                };
            }
            if (!outputsMatch(result.stdout, test.output)) {
                return { verdict: "WrongAnswer", failedTest: number, detail: null };
            }
        }
        return { verdict: "Accepted", failedTest: null, detail: null };
    } finally {
        await sandbox.dispose();
    }
}
