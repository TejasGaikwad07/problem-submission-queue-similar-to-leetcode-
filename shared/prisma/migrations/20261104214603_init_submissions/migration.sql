-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('queued', 'running', 'done');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('Accepted', 'WrongAnswer', 'TimeLimitExceeded', 'RuntimeError', 'CompilationError');

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'queued',
    "verdict" "Verdict",
    "failedTest" INTEGER,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Submission_status_createdAt_idx" ON "Submission"("status", "createdAt");
