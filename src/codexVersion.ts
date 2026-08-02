import { spawn } from "node:child_process";

const CODEX_PACKAGE = "@openai/codex";
const UPDATE_COMMAND = `npm install -g ${CODEX_PACKAGE}@latest`;

export type CodexVersionStatus =
  | { kind: "current"; installed: string; latest: string }
  | { kind: "outdated"; installed: string; latest: string }
  | { kind: "missing" }
  | { kind: "unknown"; installed?: string; reason: string };

export async function checkCodexVersion(): Promise<CodexVersionStatus> {
  const installedResult = await runCaptured("codex", ["--version"], 5_000);
  if (installedResult.code !== 0) return { kind: "missing" };

  const installed = parseVersion(installedResult.stdout || installedResult.stderr);
  if (!installed) {
    return { kind: "unknown", reason: "could not read the installed Codex version" };
  }

  const latestResult = await runCaptured("npm", ["view", CODEX_PACKAGE, "version", "--json"], 8_000);
  if (latestResult.code !== 0) {
    return { kind: "unknown", installed, reason: "could not reach the npm registry" };
  }

  const latest = parseVersion(latestResult.stdout);
  if (!latest) {
    return { kind: "unknown", installed, reason: "npm returned an unrecognized version" };
  }

  return compareVersions(installed, latest) < 0
    ? { kind: "outdated", installed, latest }
    : { kind: "current", installed, latest };
}

export async function updateCodex(): Promise<{ ok: boolean; output: string }> {
  const result = await runCaptured("npm", ["install", "-g", `${CODEX_PACKAGE}@latest`], 120_000);
  return {
    ok: result.code === 0,
    output: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n")
  };
}

export function codexUpdateCommand(): string {
  return UPDATE_COMMAND;
}

export function parseVersion(text: string): string | undefined {
  return text.match(/\bv?(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\b/)?.[1];
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function runCaptured(command: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: process.platform === "win32", windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", () => finish(1));
    child.on("close", (code) => finish(code ?? 1));

    const timer = setTimeout(() => {
      child.kill();
      stderr ||= `${command} timed out`;
      finish(1);
    }, timeoutMs);
  });
}
