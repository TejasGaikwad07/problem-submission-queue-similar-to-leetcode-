import { judge, normalizeOutput, outputsMatch } from "@judge/shared";
import { addRun, fakeExecutor, makeProblem, ok } from "./helpers";

describe("output comparison", () => {
    test("trailing whitespace and line endings are ignored", () => {
        expect(outputsMatch("3\n", "3")).toBe(true);
        expect(outputsMatch("3  \r\n\r\n", "3\n")).toBe(true);
        expect(outputsMatch("a  \nb\t\n", "a\nb")).toBe(true);
        expect(normalizeOutput("x\r\ny\r\n")).toBe("x\ny");
    });

    test("leading whitespace and different content are not ignored", () => {
        expect(outputsMatch(" 3", "3")).toBe(false);
        expect(outputsMatch("4", "3")).toBe(false);
        expect(outputsMatch("1\n2", "1 2")).toBe(false);
    });
});

describe("verdict logic (fake executor, no Docker)", () => {
    const problem = makeProblem();

    test("Accepted when every test passes", async () => {
        const r = await judge(fakeExecutor({ run: addRun }), problem, "python", "x");
        expect(r).toEqual({ verdict: "Accepted", failedTest: null, detail: null });
    });

    test("Wrong Answer reports the failing test number", async () => {
        const run = (input: string) => (input.startsWith("10") ? ok("999\n") : addRun(input));
        const r = await judge(fakeExecutor({ run }), problem, "python", "x");
        expect(r).toMatchObject({ verdict: "WrongAnswer", failedTest: 2 });
    });

    test("Time Limit Exceeded", async () => {
        const run = () => ({ kind: "timeout" as const, stdout: "", stderr: "", exitCode: null });
        const r = await judge(fakeExecutor({ run }), problem, "javascript", "x");
        expect(r).toMatchObject({ verdict: "TimeLimitExceeded", failedTest: 1 });
    });

    test("Runtime Error on a non-zero exit code, with stderr in the detail", async () => {
        const run = () => ({ kind: "ok" as const, stdout: "", stderr: "Traceback: boom", exitCode: 1 });
        const r = await judge(fakeExecutor({ run }), problem, "python", "x");
        expect(r).toMatchObject({ verdict: "RuntimeError", failedTest: 1 });
        expect(r.detail).toContain("boom");
    });

    test("exit code 137 is reported as a likely out-of-memory kill", async () => {
        const run = () => ({ kind: "ok" as const, stdout: "", stderr: "", exitCode: 137 });
        const r = await judge(fakeExecutor({ run }), problem, "python", "x");
        expect(r.verdict).toBe("RuntimeError");
        expect(r.detail).toContain("memory");
    });

    test("exceeding the output limit is a Runtime Error", async () => {
        const run = () => ({ kind: "output_limit" as const, stdout: "", stderr: "", exitCode: null });
        const r = await judge(fakeExecutor({ run }), problem, "javascript", "x");
        expect(r).toMatchObject({ verdict: "RuntimeError", failedTest: 1, detail: "Output limit exceeded" });
    });

    test("Compilation Error carries the compiler log and no test number", async () => {
        const executor = fakeExecutor({ compile: { ok: false, log: "main.cpp:1: error: expected ')'" }, run: addRun });
        const r = await judge(executor, problem, "cpp", "x");
        expect(r).toEqual({ verdict: "CompilationError", failedTest: null, detail: "main.cpp:1: error: expected ')'" });
    });

    test("stops at the first failing test and always disposes the sandbox", async () => {
        let runs = 0;
        let disposed = false;
        const executor = {
            async prepare() {
                return {
                    compile: async () => ({ ok: true as const }),
                    run: async () => {
                        runs++;
                        return ok("wrong\n");
                    },
                    dispose: async () => {
                        disposed = true;
                    },
                };
            },
        };
        await judge(executor, problem, "python", "x");
        expect(runs).toBe(1);
        expect(disposed).toBe(true);
    });

    test("passes the problem's time limit to the sandbox", async () => {
        const seen: number[] = [];
        const run = (input: string, limit: number) => {
            seen.push(limit);
            return addRun(input);
        };
        await judge(fakeExecutor({ run }), makeProblem({ timeLimitMs: 1234 }), "python", "x");
        expect(seen).toEqual([1234, 1234]);
    });
});
