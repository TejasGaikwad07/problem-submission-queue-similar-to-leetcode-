import { useEffect, useState } from "react";
import { getProblems, type ProblemSummary } from "./api";

export function ProblemList() {
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProblems().then(setProblems).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">Could not load problems: {error}</p>;
  if (!problems) return <p>Loading...</p>;

  return (
    <>
      <h1>Problems</h1>
      <table className="problems">
        <thead>
          <tr><th>Title</th><th>Difficulty</th><th>Time limit</th></tr>
        </thead>
        <tbody>
          {problems.map((p) => (
            <tr key={p.id}>
              <td><a href={`#/problems/${p.id}`}>{p.title}</a></td>
              <td><span className={`tag ${p.difficulty.toLowerCase()}`}>{p.difficulty}</span></td>
              <td>{p.timeLimitMs / 1000}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
