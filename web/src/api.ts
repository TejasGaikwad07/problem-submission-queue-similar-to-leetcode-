export type Language = "cpp" | "javascript" | "python";

export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: string;
  timeLimitMs: number;
}

export interface Problem extends ProblemSummary {
  statement: string;
  examples: { input: string; output: string }[];
}

export type Verdict =
  | "Accepted"
  | "WrongAnswer"
  | "TimeLimitExceeded"
  | "RuntimeError"
  | "CompilationError";

export interface SubmissionResult {
  id: string;
  status: "queued" | "running" | "done";
  verdict: Verdict | null;
  failedTest: number | null;
  detail: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const getProblems = () => request<ProblemSummary[]>("/problems");
export const getProblem = (id: string) => request<Problem>(`/problems/${encodeURIComponent(id)}`);
export const getSubmission = (id: string) => request<SubmissionResult>(`/submissions/${id}`);
export const submit = (problemId: string, language: Language, code: string) =>
  request<{ submissionId: string }>("/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problemId, language, code }),
  });
