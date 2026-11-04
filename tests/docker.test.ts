import { spawnSync } from "child_process";
import request from "supertest";
import {
    createDockerExecutor,
    createMemoryQueue,
    getLanguageSpec,
    isDockerAvailable,
    judge,
    LANGUAGES,
    prisma,
    processSubmission,
} from "@judge/shared";
import type { Language, Verdict } from "@judge/shared";
import { createApp } from "../express-server/src/app";
import { makeProblem, resetDb } from "./helpers";

// These tests run real code in real containers. Without a Docker engine they are skipped (not failed).
const dockerOk = isDockerAvailable();
if (!dockerOk) {
    console.warn(
        "\n[docker.test.ts] SKIPPED: Docker is not available (is Docker Desktop running?). " +
            "Verdict, timeout, network and end-to-end sandbox tests did not run.\n"
    );
}
const dockerDescribe = dockerOk ? describe : describe.skip;

const executor = createDockerExecutor();

function ensureImages() {
    for (const lang of LANGUAGES) {
        const { image } = getLanguageSpec(lang);
        if (spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status !== 0) {
            const pulled = spawnSync("docker", ["pull", image], { stdio: "inherit" });
            if (pulled.status !== 0) throw new Error(`Could not pull ${image}`);
        }
    }
}

async function run(language: Language, code: string, problem = makeProblem()) {
    return judge(executor, problem, language, code);
}

type Case = [Language, string];

const programs: Record<string, Case[]> = {
    accepted: [
        ["python", "a, b = map(int, input().split())\nprint(a + b)\n"],
        ["javascript", "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(a + b);\n"],
        ["cpp", "#include <iostream>\nint main() { long long a, b; std::cin >> a >> b; std::cout << a + b << \"\\n\"; }\n"],
    ],
    wrongAnswer: [
        ["python", "a, b = map(int, input().split())\nprint(a - b)\n"],
        ["javascript", "console.log('nope');\n"],
        ["cpp", "#include <iostream>\nint main() { std::cout << 42 << \"\\n\"; }\n"],
    ],
    runtimeError: [
        ["python", "raise RuntimeError('boom')\n"],
        ["javascript", "throw new Error('boom');\n"],
        ["cpp", "#include <cstdlib>\nint main() { std::abort(); }\n"],
    ],
    timeLimit: [
        ["python", "while True:\n    pass\n"],
        ["javascript", "while (true) {}\n"],
        ["cpp", "int main() { volatile int x = 0; while (true) { x = x + 1; } }\n"],
    ],
};

const expectations: [string, Verdict][] = [
    ["accepted", "Accepted"],
    ["wrongAnswer", "WrongAnswer"],
    ["runtimeError", "RuntimeError"],
    ["timeLimit", "TimeLimitExceeded"],
];

dockerDescribe("sandboxed judging (real Docker)", () => {
    jest.setTimeout(180_000);

    beforeAll(() => ensureImages(), 1_200_000);

    describe.each(expectations)("%s programs", (key, verdict) => {
        test.each(programs[key]!)(`%s -> ${verdict}`, async (language, code) => {
            const result = await run(language, code);
            expect(result.verdict).toBe(verdict);
            if (verdict === "Accepted") expect(result.failedTest).toBeNull();
            else expect(result.failedTest).toBe(1);
        });
    });

    test("C++ compile errors are reported with the compiler output", async () => {
        const result = await run("cpp", "int main( { return 0 }\n");
        expect(result.verdict).toBe("CompilationError");
        expect(result.failedTest).toBeNull();
        expect(result.detail).toMatch(/error/i);
    });

    test("reports the number of the first failing test case", async () => {
        // correct for the first test, wrong from then on
        const code = "import sys\na, b = map(int, sys.stdin.read().split())\nprint(3 if a == 1 else 0)\n";
        const result = await run("python", code);
        expect(result).toMatchObject({ verdict: "WrongAnswer", failedTest: 2 });
    });

    test("an infinite loop ends as Time Limit Exceeded, near the limit rather than hanging", async () => {
        const started = Date.now();
        const result = await run("python", "while True:\n    pass\n", makeProblem({ timeLimitMs: 1000 }));
        expect(result.verdict).toBe("TimeLimitExceeded");
        expect(Date.now() - started).toBeLessThan(20_000);
    });

    test("the timed-out container is really gone", async () => {
        await run("python", "while True:\n    pass\n", makeProblem({ timeLimitMs: 500 }));
        await new Promise((r) => setTimeout(r, 1500));
        const ps = spawnSync("docker", ["ps", "-q", "--filter", "name=judge-"], { encoding: "utf8" });
        expect(ps.stdout.trim()).toBe("");
    });

    describe("isolation", () => {
        const networkProblem = makeProblem({
            tests: [{ input: "", output: "blocked\n", hidden: false }],
            timeLimitMs: 8000,
        });

        test("JavaScript cannot reach the network", async () => {
            const code =
                "const net = require('net');\n" +
                "const s = net.connect({ host: '1.1.1.1', port: 80 });\n" +
                "s.setTimeout(3000);\n" +
                "s.on('connect', () => { console.log('connected'); process.exit(0); });\n" +
                "s.on('error', () => { console.log('blocked'); process.exit(0); });\n" +
                "s.on('timeout', () => { console.log('blocked'); process.exit(0); });\n";
            expect((await run("javascript", code, networkProblem)).verdict).toBe("Accepted");
        });

        test("Python cannot reach the network", async () => {
            const code =
                "import socket\n" +
                "try:\n" +
                "    socket.create_connection(('1.1.1.1', 80), timeout=3)\n" +
                "    print('connected')\n" +
                "except OSError:\n" +
                "    print('blocked')\n";
            expect((await run("python", code, networkProblem)).verdict).toBe("Accepted");
        });

        test("the root filesystem is read-only but /tmp is writable", async () => {
            const code =
                "try:\n" +
                "    open('/etc/pwned', 'w').write('x')\n" +
                "    print('wrote-root')\n" +
                "except OSError:\n" +
                "    print('readonly')\n" +
                "open('/tmp/ok', 'w').write('x')\n" +
                "print('tmp-ok')\n";
            const problem = makeProblem({ tests: [{ input: "", output: "readonly\ntmp-ok\n", hidden: false }] });
            expect((await run("python", code, problem)).verdict).toBe("Accepted");
        });

        test("using more memory than the limit is a Runtime Error", async () => {
            const result = await run("python", "x = b'a' * (1 << 30)\nprint(len(x))\n");
            expect(result.verdict).toBe("RuntimeError");
        });

        test("endless output is cut off as a Runtime Error", async () => {
            const result = await run("javascript", "while (true) console.log('x'.repeat(1000));\n");
            expect(result.verdict).toBe("RuntimeError");
            expect(result.detail).toContain("Output limit");
        });
    });

    test("API end to end with the real sandbox: submit, queue, judge, read the verdict", async () => {
        await resetDb();
        const queue = createMemoryQueue();
        const app = createApp({ db: prisma, queue });
        const code = [
            "import sys",
            "lines = sys.stdin.read().split('\\n')",
            "target = int(lines[0].split()[1])",
            "a = list(map(int, lines[1].split()))",
            "for i in range(len(a)):",
            "    for j in range(i + 1, len(a)):",
            "        if a[i] + a[j] == target:",
            "            print(i, j)",
            "            sys.exit(0)",
        ].join("\n");

        const res = await request(app).post("/submit").send({ problemId: "two-sum", language: "python", code });
        expect(res.status).toBe(201);
        const id = res.body.submissionId;

        expect((await request(app).get(`/submissions/${id}`)).body.status).toBe("queued");
        await processSubmission(prisma, executor, (await queue.dequeue(0))!);

        const done = await request(app).get(`/submissions/${id}`);
        expect(done.body).toMatchObject({ status: "done", verdict: "Accepted" });
    });
});

afterAll(async () => {
    await prisma.$disconnect();
});
