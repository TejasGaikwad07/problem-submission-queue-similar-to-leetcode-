import { getProblems, outputsMatch, toPublicProblem } from "@judge/shared";

// Reference solutions, run on the host (trusted test code) to check the stored expected outputs.
const reference: Record<string, (input: string) => string> = {
    "two-sum": (input) => {
        const [first, second] = input.trim().split("\n");
        const [, target] = first!.split(" ").map(Number);
        const a = second!.split(" ").map(Number);
        for (let i = 0; i < a.length; i++)
            for (let j = i + 1; j < a.length; j++) if (a[i]! + a[j]! === target) return `${i} ${j}\n`;
        throw new Error("no pair");
    },
    "reverse-string": (input) => input.replace(/\n$/, "").split("").reverse().join("") + "\n",
    "valid-palindrome": (input) => {
        const s = input.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (s === s.split("").reverse().join("") ? "true" : "false") + "\n";
    },
    "max-subarray": (input) => {
        const a = input.trim().split("\n")[1]!.split(" ").map(Number);
        let best = a[0]!;
        let cur = a[0]!;
        for (const x of a.slice(1)) {
            cur = Math.max(x, cur + x);
            best = Math.max(best, cur);
        }
        return `${best}\n`;
    },
};

const problems = getProblems();

test("there are 4 sample problems", () => {
    expect(problems.map((p) => p.id).sort()).toEqual(["max-subarray", "reverse-string", "two-sum", "valid-palindrome"]);
});

describe.each(problems.map((p) => [p.id, p] as const))("%s", (id, problem) => {
    test("has a statement, a time limit and several tests, some of them hidden", () => {
        expect(problem.statement.length).toBeGreaterThan(20);
        expect(problem.timeLimitMs).toBeGreaterThan(0);
        expect(problem.tests.length).toBeGreaterThanOrEqual(4);
        expect(problem.tests.some((t) => t.hidden)).toBe(true);
        expect(problem.tests.some((t) => !t.hidden)).toBe(true);
    });

    test("every stored expected output matches the reference solution", () => {
        for (const t of problem.tests) {
            expect(outputsMatch(reference[id]!(t.input), t.output)).toBe(true);
        }
    });

    test("the public view contains no hidden test case", () => {
        const pub = toPublicProblem(problem);
        const hidden = problem.tests.filter((t) => t.hidden);
        expect(pub.examples).toHaveLength(problem.tests.length - hidden.length);
        const text = JSON.stringify(pub);
        for (const t of hidden) expect(text).not.toContain(JSON.stringify(t.input));
        expect(text).not.toContain("hidden");
    });
});
