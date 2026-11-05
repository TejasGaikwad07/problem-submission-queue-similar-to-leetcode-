import fs from "fs";
import path from "path";
import { z } from "zod";

const testCaseSchema = z.object({
    input: z.string(),
    output: z.string(),
    hidden: z.boolean(),
});

const problemSchema = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    difficulty: z.enum(["Easy", "Medium", "Hard"]),
    statement: z.string().min(1),
    timeLimitMs: z.number().int().positive(),
    tests: z.array(testCaseSchema).min(1),
});

export type TestCase = z.infer<typeof testCaseSchema>;
export type Problem = z.infer<typeof problemSchema>;

const PROBLEMS_DIR = path.resolve(__dirname, "../problems");

export function loadProblems(dir: string = PROBLEMS_DIR): Problem[] {
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => problemSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))));
}

let cache: Problem[] | undefined;

export function getProblems(): Problem[] {
    return (cache ??= loadProblems());
}

export function getProblem(id: string): Problem | undefined {
    return getProblems().find((p) => p.id === id);
}

export function toSummary(p: Problem) {
    return { id: p.id, title: p.title, difficulty: p.difficulty, timeLimitMs: p.timeLimitMs };
}

/** What the API may return: the statement and the non-hidden examples. Hidden tests never leave the server. */
export function toPublicProblem(p: Problem) {
    return {
        ...toSummary(p),
        statement: p.statement,
        examples: p.tests.filter((t) => !t.hidden).map((t) => ({ input: t.input, output: t.output })),
    };
}
