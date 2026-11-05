import type { SubmissionResult, Verdict } from "./api";

const VERDICT_TEXT: Record<Verdict, string> = {
  Accepted: "Accepted",
  WrongAnswer: "Wrong Answer",
  TimeLimitExceeded: "Time Limit Exceeded",
  RuntimeError: "Runtime Error",
  CompilationError: "Compilation Error",
};

export function VerdictBanner({ result }: { result: SubmissionResult }) {
  if (result.status === "queued") return <div className="verdict pending">Queued...</div>;
  if (result.status === "running") return <div className="verdict pending">Running...</div>;

  if (!result.verdict) {
    return (
      <div className="verdict internal">
        <strong>Judge error</strong>
        <pre>{result.detail ?? "Something went wrong on our side."}</pre>
      </div>
    );
  }

  const ok = result.verdict === "Accepted";
  return (
    <div className={`verdict ${ok ? "accepted" : "failed"}`}>
      <strong>{VERDICT_TEXT[result.verdict]}</strong>
      {result.failedTest !== null && <span> on test case {result.failedTest}</span>}
      {result.detail && <pre>{result.detail}</pre>}
    </div>
  );
}
