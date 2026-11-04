import type { PrismaClient } from "@prisma/client";
import { judge, type Executor } from "./judge";
import { LANGUAGES, type Language } from "./languages";
import { getProblem, type Problem } from "./problems";

/**
 * Judges one stored submission and writes the outcome back. Never throws: an internal failure
 * (docker missing, unknown problem, ...) is recorded as status "done" with no verdict and a detail message.
 */
export async function processSubmission(
    db: PrismaClient,
    executor: Executor,
    submissionId: string,
    lookupProblem: (id: string) => Problem | undefined = getProblem
): Promise<void> {
    const submission = await db.submission.findUnique({ where: { id: submissionId } });
    if (!submission || submission.status !== "queued") return; // unknown, or already taken

    // Claim it: only one worker can move queued -> running.
    const claimed = await db.submission.updateMany({
        where: { id: submissionId, status: "queued" },
        data: { status: "running", startedAt: new Date() },
    });
    if (claimed.count !== 1) return;

    try {
        const problem = lookupProblem(submission.problemId);
        if (!problem) throw new Error(`Unknown problem ${submission.problemId}`);
        if (!(LANGUAGES as readonly string[]).includes(submission.language)) {
            throw new Error(`Unsupported language ${submission.language}`);
        }

        const result = await judge(executor, problem, submission.language as Language, submission.code);
        await db.submission.update({
            where: { id: submissionId },
            data: {
                status: "done",
                verdict: result.verdict,
                failedTest: result.failedTest,
                detail: result.detail,
                finishedAt: new Date(),
            },
        });
    } catch (e) {
        console.error(`Internal error judging ${submissionId}:`, e);
        await db.submission.update({
            where: { id: submissionId },
            data: {
                status: "done",
                verdict: null,
                detail: `Internal judge error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 2000),
                finishedAt: new Date(),
            },
        });
    }
}
