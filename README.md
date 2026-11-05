# Online Judge (problem submission queue)

A small LeetCode-style online judge. You pick a problem in the browser, submit code in C++, JavaScript or Python, and a worker runs it against the problem's test cases inside a locked-down Docker container and reports a verdict.

> **This is a learning project.** The sandbox uses sensible Docker limits, but it is not hardened against a determined attacker. See [Known limits](#known-limits).

## Architecture

```mermaid
flowchart LR
    B["Browser<br/>React (Vite)"] -- "POST /submit<br/>GET /submissions/:id<br/>GET /problems" --> API["API server<br/>Express :3000"]
    API -- "INSERT status=queued" --> PG[("PostgreSQL<br/>Submission")]
    API -- "LPUSH submission id" --> R[("Redis<br/>judge:queue")]
    R -- "BRPOP" --> W["Worker<br/>(on the host)"]
    W -- "status=running, then verdict" --> PG
    W -- "docker run (per test)" --> C["Sandbox container<br/>no network, read-only,<br/>memory / CPU / pids limits"]
    P["shared/problems/*.json<br/>statements + test cases"] --> API
    P --> W
```

1. `POST /submit` validates the body, stores the submission (`queued`) in Postgres, pushes its id onto a Redis list and returns `submissionId` straight away.
2. The worker pops ids one at a time, marks the row `running`, and judges it.
3. Judging: the code is written to a temp folder. C++ is compiled in one container; then **every test case runs in its own fresh container** with the input on stdin. The first failing test decides the verdict.
4. The worker writes `done` plus the verdict and failing test number. The browser polls `GET /submissions/:id` once a second.

Verdicts: `Accepted`, `WrongAnswer`, `TimeLimitExceeded`, `RuntimeError`, `CompilationError`. Outputs are compared after trimming trailing whitespace on every line and at the end (and ignoring `\r\n` vs `\n`). If the judge itself fails (for example Docker is down), the submission ends as `done` with no verdict and a "Judge error" message.

## Run it on Windows

Prerequisites: Node 18+, npm, and **Docker Desktop running** (Linux containers). Everything below works in PowerShell or cmd; no bash is needed.

```powershell
git clone https://github.com/TejasGaikwad07/problem-submission-queue-similar-to-leetcode-.git
cd problem-submission-queue-similar-to-leetcode-
npm install
copy .env.example .env

# 1. Redis + Postgres (development only)
docker compose up -d

# 2. Pre-pull the sandbox images (one time; gcc is large, ~1.3 GB)
npm run judge:pull-images

# 3. Create the tables
npm run db:migrate
```

Then start three things, each in its own terminal:

```powershell
npm run dev:api      # http://localhost:3000
npm run dev:worker   # needs Docker running
npm run dev:web      # http://localhost:5173
```

Open http://localhost:5173, choose a problem, write a solution that reads stdin and prints to stdout, and press Submit.

The API and the worker run directly on your machine. The worker calls the `docker` CLI to start one short-lived container per run; it does **not** use Docker-in-Docker.

### Build the front end to static files

```powershell
npm run build:web      # output: web/dist
```

If `web/dist` exists, the API also serves it at http://localhost:3000. Nothing is deployed anywhere by this repo.

### Images used

| Language | Image | Notes |
| --- | --- | --- |
| C++ (g++, C++17, `-O2`) | `gcc:13` | the largest, ~1.3 GB; there is no small official gcc image |
| JavaScript | `node:20-alpine` | small |
| Python 3 | `python:3.12-alpine` | small |

`npm run judge:pull-images` pulls all three. Containers are started with `--pull never` so a missing image fails fast instead of downloading during a submission. Override images with `JUDGE_IMAGE_CPP`, `JUDGE_IMAGE_JAVASCRIPT`, `JUDGE_IMAGE_PYTHON`.

## API

| Route | Description |
| --- | --- |
| `POST /submit` | body `{ problemId, language: "cpp" \| "javascript" \| "python", code }`; code is limited to 50,000 bytes; returns `201 { submissionId }` |
| `GET /submissions/:id` | `{ status: queued \| running \| done, verdict, failedTest, detail, timestamps }` |
| `GET /problems` | list of problems |
| `GET /problems/:id` | statement, time limit and the **example** tests only; hidden tests are never returned |

Problems are JSON files in `shared/problems/`: id, title, statement, time limit and test cases (`input`, `output`, `hidden`). There are four: Two Sum, Reverse String, Valid Palindrome, Maximum Subarray.

## Security limits used

Every run (and the C++ compile step) is `docker run` with:

| Limit | Setting |
| --- | --- |
| Network | `--network none` |
| Memory | `--memory 256m --memory-swap 256m` (compile: 1g) |
| CPU | `--cpus 1` |
| Processes | `--pids-limit 64` (compile: 128) |
| Filesystem | `--read-only` root; only `/tmp` is writable (64 MB tmpfs) |
| Privileges | `--cap-drop ALL`, `no-new-privileges`, runs as `nobody` (65534) |
| Wall-clock time | enforced by the **worker**: the problem's time limit plus 2 s of container start-up allowance; on timeout the container is killed by name (`docker kill`) |
| Output size | stdout over 64 KiB kills the container (reported as Runtime Error) |
| Source code | at most 50,000 bytes |

The submitted source is mounted read-only. The one writable bind mount is the compile output folder, used only in the C++ compile container; test runs mount it read-only. All values can be tuned with `JUDGE_*` variables (see `.env.example`).

## Tests

```powershell
# a throwaway Postgres database with the migrations applied (the tests TRUNCATE the Submission table)
$env:DATABASE_URL_TEST = "postgresql://postgres:postgres@localhost:5432/judge_test"
$env:DATABASE_URL = $env:DATABASE_URL_TEST
npm run db:migrate
npm test
```

- Always run: output comparison, verdict logic for every outcome (with a fake executor), problem data checked against reference solutions, hidden tests never exposed, and the API flow (validation, size limit, submit -> queued -> done) against a real Postgres.
- Run only when Docker is available (otherwise skipped with a message): real C++/JavaScript/Python programs for every verdict, compile errors, an infinite loop ending as Time Limit Exceeded (and its container being removed), network access failing, read-only filesystem, memory limit, output cap, and the API end to end through the real sandbox. Set `REDIS_URL_TEST` to also run the Redis queue test.

GitHub Actions (`.github/workflows/ci.yml`) starts Postgres and Redis services, pre-pulls the images, runs the migrations, type-checks, builds the front end and runs all tests with Docker available on every push and pull request.

## Known limits

- **This is a learning project, not a hardened judge.** Docker containers share the host kernel; a kernel or container-runtime vulnerability could let hostile code escape. Real judges add layers such as gVisor/Firecracker, seccomp profiles and a dedicated machine. Do not run this on a machine with anything valuable on it, and do not expose it to untrusted users.
- No authentication, rate limiting or per-user quotas: anyone who can reach the API can fill the queue.
- The worker handles one submission at a time. If it crashes mid-judge, that submission stays `running` forever (no retry or recovery of stuck jobs).
- Time limits are wall-clock, include container start-up variation, and are not CPU-time measurements, so a slow or busy machine changes results.
- Memory is limited per container, but there is no total disk or CPU-time accounting beyond the settings above.
- Compilation runs in a container too, but compiler output and diagnostics are returned to the user as they are (truncated).
- The tmp and compile folders are on the host's temp directory and are deleted after judging; a hard crash can leave some behind.
- Only 4 problems, and each test case is a stdin/stdout comparison (no special checkers, so problems must have a unique correct output).
- The Docker-dependent tests pass in CI on Linux. I also ran the whole stack end to end on Windows with Docker Desktop (compose, migrations, API, worker, real submissions with the expected verdicts, and the full test suite), but only on one machine and one Docker version (27.1.1); it has not been tried on macOS or other Windows setups.

## What was already here vs what I added

**Already here (the original repo):** a README describing the idea, a tiny Express server whose `POST /submit` pushed `{ code, language, problemId }` onto a Redis list called `problems`, and a worker that popped from that list, logged the submission and waited one second. No database, no problems, no validation, no sandbox, no UI, no tests.

**Added on the `feature/real-judge` branch:**

- npm workspaces layout (`shared`, `express-server`, `worker`, `web`), `docker-compose.yml` for Redis + Postgres, `.env.example`, helper script to pre-pull images.
- Prisma schema and migration for `Submission`.
- `shared/`: problem loader, the verdict logic, the Docker sandbox executor, Redis/in-memory queues, and the submission processor.
- Four sample problems as JSON.
- API rewrite: zod validation, code size limit, `GET /submissions/:id`, `GET /problems`, `GET /problems/:id`.
- Worker rewrite: real judging in Docker containers.
- `web/`: the Vite + React + TypeScript front end.
- Jest tests, the GitHub Actions workflow, and this README.
- Removed the per-package `package-lock.json` and `tsconfig.json` files (replaced by a root lockfile and tsconfig).
