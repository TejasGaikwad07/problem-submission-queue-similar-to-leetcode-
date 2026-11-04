import { useEffect, useState } from "react";
import { ProblemList } from "./ProblemList";
import { ProblemPage } from "./ProblemPage";

// Hash routing: "#/" is the list, "#/problems/<id>" is a problem. Keeps URLs from clashing with API paths.
function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

export function App() {
  const route = useHashRoute();
  const match = route.match(/^\/problems\/([a-z0-9-]+)$/);

  return (
    <div className="app">
      <header>
        <a href="#/" className="brand">Online Judge</a>
      </header>
      <main>{match ? <ProblemPage id={match[1]!} /> : <ProblemList />}</main>
    </div>
  );
}
