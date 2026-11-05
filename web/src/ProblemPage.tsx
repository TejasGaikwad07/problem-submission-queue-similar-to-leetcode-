import { useEffect, useRef, useState } from "react";
import { getProblem, getSubmission, submit, type Language, type Problem, type SubmissionResult } from "./api";
import { VerdictBanner } from "./VerdictBanner";

const TEMPLATES: Record<Language, string> = {
  python: "import sys\n\ndata = sys.stdin.read()\n# read the input above and print the answer\nprint(data)\n",
  javascript: "const data = require('fs').readFileSync(0, 'utf8');\n// read the input above and print the answer\nconsole.log(data);\n",
  cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // read from cin, print the answer to cout\n    return 0;\n}\n",
};

const LABELS: Record<Language, string> = { python: "Python 3", javascript: "JavaScript (Node)", cpp: "C++17" };

export function ProblemPage({ id }: { id: string }) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>("python");
  const [code, setCode] = useState(TEMPLATES.python);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setProblem(null);
    setResult(null);
    getProblem(id).then(setProblem).catch((e: Error) => setLoadError(e.message));
    return () => window.clearTimeout(timer.current);
  }, [id]);

  function changeLanguage(next: Language) {
    // only replace the editor content if the user has not typed anything of their own
    if (code === TEMPLATES[language]) setCode(TEMPLATES[next]);
    setLanguage(next);
  }

  // Poll once a second until the submission is done.
  function poll(submissionId: string) {
    getSubmission(submissionId)
      .then((s) => {
        setResult(s);
        if (s.status === "done") setBusy(false);
        else timer.current = window.setTimeout(() => poll(submissionId), 1000);
      })
      .catch((e: Error) => {
        setSubmitError(e.message);
        setBusy(false);
      });
  }

  async function onSubmit() {
    window.clearTimeout(timer.current);
    setSubmitError(null);
    setResult(null);
    setBusy(true);
    try {
      const { submissionId } = await submit(id, language, code);
      setResult({ id: submissionId, status: "queued", verdict: null, failedTest: null, detail: null });
      timer.current = window.setTimeout(() => poll(submissionId), 1000);
    } catch (e) {
      setSubmitError((e as Error).message);
      setBusy(false);
    }
  }

  if (loadError) return <p className="error">Could not load problem: {loadError}</p>;
  if (!problem) return <p>Loading...</p>;

  return (
    <>
      <p><a href="#/">&larr; All problems</a></p>
      <h1>{problem.title}</h1>
      <p className="meta">
        <span className={`tag ${problem.difficulty.toLowerCase()}`}>{problem.difficulty}</span>
        {" "}Time limit {problem.timeLimitMs / 1000}s
      </p>
      <pre className="statement">{problem.statement}</pre>

      {problem.examples.map((ex, i) => (
        <div className="example" key={i}>
          <div><strong>Example {i + 1} input</strong><pre>{ex.input}</pre></div>
          <div><strong>Output</strong><pre>{ex.output}</pre></div>
        </div>
      ))}

      <div className="editor">
        <label>
          Language{" "}
          <select value={language} onChange={(e) => changeLanguage(e.target.value as Language)} disabled={busy}>
            {(Object.keys(LABELS) as Language[]).map((l) => <option key={l} value={l}>{LABELS[l]}</option>)}
          </select>
        </label>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          rows={16}
          aria-label="Code"
        />
        <button onClick={onSubmit} disabled={busy || !code.trim()}>
          {busy ? "Judging..." : "Submit"}
        </button>
      </div>

      {submitError && <p className="error">{submitError}</p>}
      {result && <VerdictBanner result={result} />}
    </>
  );
}
