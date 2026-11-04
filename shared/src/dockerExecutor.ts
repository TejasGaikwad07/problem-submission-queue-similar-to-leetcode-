import { spawn, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Executor, RunResult, Sandbox } from "./judge";
import { getLanguageSpec, type Language } from "./languages";

export interface DockerExecutorOptions {
    dockerBin?: string;
    memory?: string;
    cpus?: string;
    pidsLimit?: number;
    /** stdout beyond this many bytes kills the container */
    outputLimitBytes?: number;
    /** added to each problem's time limit to cover container start-up */
    startupAllowanceMs?: number;
    compileTimeoutMs?: number;
}

const num = (v: string | undefined, fallback: number) => (v && Number(v) > 0 ? Number(v) : fallback);

function resolveOptions(o: DockerExecutorOptions) {
    return {
        dockerBin: o.dockerBin ?? "docker",
        memory: o.memory ?? process.env.JUDGE_MEMORY ?? "256m",
        cpus: o.cpus ?? process.env.JUDGE_CPUS ?? "1",
        pidsLimit: o.pidsLimit ?? num(process.env.JUDGE_PIDS_LIMIT, 64),
        outputLimitBytes: o.outputLimitBytes ?? num(process.env.JUDGE_OUTPUT_LIMIT_BYTES, 64 * 1024),
        startupAllowanceMs: o.startupAllowanceMs ?? num(process.env.JUDGE_STARTUP_ALLOWANCE_MS, 2000),
        compileTimeoutMs: o.compileTimeoutMs ?? 30_000,
    };
}

/** Synchronous so test files can decide at import time whether to skip. */
export function isDockerAvailable(dockerBin = "docker"): boolean {
    try {
        // `docker info --format` can exit 0 with an empty value while the engine is down, so require a real version.
        const r = spawnSync(dockerBin, ["info", "--format", "{{.ServerVersion}}"], { timeout: 20_000, encoding: "utf8" });
        return r.status === 0 && /^\d+\./.test((r.stdout ?? "").trim());
    } catch {
        return false;
    }
}

interface ContainerSpec {
    image: string;
    cmd: string[];
    memory: string;
    cpus: string;
    pidsLimit: number;
    /** [hostPath, containerPath, readOnly] */
    mounts: [string, string, boolean][];
}

function buildDockerArgs(name: string, c: ContainerSpec): string[] {
    return [
        "run", "--rm", "-i",
        "--name", name,
        "--pull", "never",
        "--network", "none",
        "--memory", c.memory,
        "--memory-swap", c.memory,
        "--cpus", c.cpus,
        "--pids-limit", String(c.pidsLimit),
        "--read-only",
        "--tmpfs", "/tmp:rw,size=64m,mode=1777",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--user", "65534:65534",
        "-e", "HOME=/tmp",
        "-w", "/tmp",
        // --mount (not -v) so Windows paths like C:\Users\... are not confused with the ':' separator
        ...c.mounts.flatMap(([host, target, ro]) => [
            "--mount",
            `type=bind,source=${host},target=${target}${ro ? ",readonly" : ""}`,
        ]),
        c.image,
        ...c.cmd,
    ];
}

function runContainer(
    dockerBin: string,
    spec: ContainerSpec,
    stdin: string,
    timeoutMs: number,
    outputLimitBytes: number
): Promise<RunResult> {
    const name = `judge-${randomUUID()}`;
    return new Promise((resolve) => {
        const child = spawn(dockerBin, buildDockerArgs(name, spec), {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let outBytes = 0;
        let errBytes = 0;
        let kind: RunResult["kind"] = "ok";
        let settled = false;

        // The docker CLI process being killed does not stop the container, so kill it by name.
        const killContainer = () => {
            spawn(dockerBin, ["kill", name], { stdio: "ignore", windowsHide: true }).on("error", () => {});
            setTimeout(() => child.kill(), 3000).unref();
        };
        const timer = setTimeout(() => {
            if (kind === "ok") kind = "timeout";
            killContainer();
        }, timeoutMs);

        const finish = (exitCode: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            // best-effort cleanup in case --rm did not run (e.g. the CLI was killed)
            spawn(dockerBin, ["rm", "-f", name], { stdio: "ignore", windowsHide: true }).on("error", () => {});
            resolve({
                kind,
                stdout: Buffer.concat(out).toString("utf8"),
                stderr: Buffer.concat(err).toString("utf8"),
                exitCode,
            });
        };

        child.stdout.on("data", (chunk: Buffer) => {
            outBytes += chunk.length;
            if (outBytes > outputLimitBytes) {
                if (kind === "ok") {
                    kind = "output_limit";
                    killContainer();
                }
                return;
            }
            out.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
            if (errBytes < 8192) {
                errBytes += chunk.length;
                err.push(chunk);
            }
        });
        child.on("error", (e) => {
            kind = "error";
            err.push(Buffer.from(`Failed to start docker: ${e.message}`));
            finish(null);
        });
        child.on("close", (code) => finish(code));

        child.stdin.on("error", () => {}); // the program may exit without reading its input
        child.stdin.end(stdin);
    });
}

export function createDockerExecutor(options: DockerExecutorOptions = {}): Executor {
    const o = resolveOptions(options);

    return {
        async prepare(language: Language, code: string): Promise<Sandbox> {
            const spec = getLanguageSpec(language);
            const root = await fs.mkdtemp(path.join(os.tmpdir(), "judge-"));
            const srcDir = path.join(root, "src");
            const binDir = path.join(root, "bin");
            await fs.mkdir(srcDir);
            await fs.mkdir(binDir);
            // The container runs as an unprivileged user (nobody): it must be able to read the source
            // and, for the compile step only, write to bin. (No-ops on Windows.)
            await fs.chmod(root, 0o755);
            await fs.chmod(srcDir, 0o755);
            await fs.chmod(binDir, 0o777);
            await fs.writeFile(path.join(srcDir, spec.fileName), code, { mode: 0o644 });

            return {
                async compile() {
                    if (!spec.compile) return { ok: true };
                    const result = await runContainer(
                        o.dockerBin,
                        {
                            image: spec.image,
                            cmd: spec.compile,
                            memory: "1g",
                            cpus: o.cpus,
                            pidsLimit: 128,
                            mounts: [
                                [srcDir, "/judge/src", true],
                                [binDir, "/judge/bin", false],
                            ],
                        },
                        "",
                        o.compileTimeoutMs,
                        o.outputLimitBytes
                    );
                    if (result.kind === "timeout") return { ok: false, log: "Compilation timed out" };
                    if (result.exitCode !== 0 || result.kind === "error") {
                        return { ok: false, log: (result.stderr || result.stdout || "Compilation failed").trim() };
                    }
                    return { ok: true };
                },

                run(input: string, timeLimitMs: number) {
                    return runContainer(
                        o.dockerBin,
                        {
                            image: spec.image,
                            cmd: spec.run,
                            memory: o.memory,
                            cpus: o.cpus,
                            pidsLimit: o.pidsLimit,
                            mounts: [
                                [srcDir, "/judge/src", true],
                                [binDir, "/judge/bin", true],
                            ],
                        },
                        input,
                        timeLimitMs + o.startupAllowanceMs,
                        o.outputLimitBytes
                    );
                },

                async dispose() {
                    await fs.rm(root, { recursive: true, force: true });
                },
            };
        },
    };
}
