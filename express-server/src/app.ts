import fs from "fs";
import path from "path";
import express, { type ErrorRequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
    LANGUAGES,
    config,
    getProblem,
    getProblems,
    toPublicProblem,
    toSummary,
    type SubmissionQueue,
} from "@judge/shared";

const submitBody = z.object({
    problemId: z.string().min(1).max(100),
    language: z.enum(LANGUAGES),
    code: z
        .string()
        .min(1, "code must not be empty")
        .refine((c) => Buffer.byteLength(c, "utf8") <= config.maxCodeBytes, {
            message: `code must be at most ${config.maxCodeBytes} bytes`,
        }),
});

const idParam = z.string().uuid();

export interface AppDeps {
    db: PrismaClient;
    queue: SubmissionQueue;
    /** optional folder with the built front end (web/dist) to serve at / */
    staticDir?: string;
}

export function createApp({ db, queue, staticDir }: AppDeps) {
    const app = express();
    // Generous enough for 50,000 bytes of code after JSON escaping; zod enforces the exact limit.
    app.use(express.json({ limit: "256kb" }));

    app.get("/problems", (_req, res) => {
        res.json(getProblems().map(toSummary));
    });

    app.get("/problems/:id", (req, res) => {
        const problem = getProblem(req.params.id);
        if (!problem) return res.status(404).json({ error: "Problem not found" });
        res.json(toPublicProblem(problem));
    });

    app.post("/submit", async (req, res, next) => {
        try {
            const parsed = submitBody.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
            }
            const { problemId, language, code } = parsed.data;
            if (!getProblem(problemId)) {
                return res.status(404).json({ error: "Problem not found" });
            }

            const submission = await db.submission.create({ data: { problemId, language, code } });
            try {
                await queue.enqueue(submission.id);
            } catch (e) {
                console.error("Failed to enqueue", e);
                await db.submission.update({
                    where: { id: submission.id },
                    data: { status: "done", detail: "Could not enqueue submission", finishedAt: new Date() },
                });
                return res.status(503).json({ error: "Queue unavailable, try again" });
            }
            res.status(201).json({ submissionId: submission.id });
        } catch (e) {
            next(e);
        }
    });

    app.get("/submissions/:id", async (req, res, next) => {
        try {
            if (!idParam.safeParse(req.params.id).success) {
                return res.status(404).json({ error: "Submission not found" });
            }
            const s = await db.submission.findUnique({ where: { id: req.params.id } });
            if (!s) return res.status(404).json({ error: "Submission not found" });
            res.json({
                id: s.id,
                problemId: s.problemId,
                language: s.language,
                status: s.status,
                verdict: s.verdict,
                failedTest: s.failedTest,
                detail: s.detail,
                createdAt: s.createdAt,
                startedAt: s.startedAt,
                finishedAt: s.finishedAt,
            });
        } catch (e) {
            next(e);
        }
    });

    if (staticDir && fs.existsSync(path.join(staticDir, "index.html"))) {
        app.use(express.static(staticDir));
    }

    const onError: ErrorRequestHandler = (err, _req, res, _next) => {
        if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
        if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    };
    app.use(onError);

    return app;
}
