import { spawn } from "node:child_process";
export type ShellResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export function runShell(command: string, cwd: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = process.platform === "win32"
      ? spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd })
      : spawn(command, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: ShellResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (err) => {
      const bounded = boundOutput(stdout, err.message);
      finish({ ok: false, exitCode: null, ...bounded });
    });
    child.on("close", (code) => {
      const bounded = boundOutput(stdout, stderr);
      finish({
        ok: code === 0,
        exitCode: code,
        ...bounded
      });
    });
  });
}

function boundOutput(stdout: string, stderr: string): { stdout: string; stderr: string } {
  const cleanStdout = stdout.trim();
  const cleanStderr = stderr.trim();
  const stdoutLimit = cleanStderr ? 6_000 : 12_000;
  const stderrLimit = cleanStdout ? 6_000 : 12_000;
  return {
    stdout: capOutput(cleanStdout, stdoutLimit),
    stderr: capOutput(cleanStderr, stderrLimit)
  };
}

export function formatShellResult(result: ShellResult): string {
  const exit = result.exitCode === null ? "unavailable" : String(result.exitCode);
  const sections = [`command ${result.ok ? "succeeded" : "failed"} (exit ${exit})`];
  if (result.stdout) sections.push(`stdout:\n${result.stdout}`);
  if (result.stderr) sections.push(`stderr:\n${result.stderr}`);
  return sections.join("\n");
}

function capOutput(text: string, limit = 12_000): string {
  if (text.length <= limit) return text;
  const omitted = text.length - limit;
  return `${text.slice(0, limit)}\n...[${omitted} characters omitted; refine the command to see less output]`;
}
