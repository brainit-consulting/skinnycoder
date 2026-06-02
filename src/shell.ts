import { spawn } from "node:child_process";
import { amber, error } from "./theme.js";

export function runShell(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = process.platform === "win32"
      ? spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd })
      : spawn(command, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (err) => {
      resolve(error(err instanceof Error ? err.message : String(err)));
    });
    child.on("close", (code) => {
      const text = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      resolve(code === 0 ? amber(text || "command completed") : error(text || `command exited with ${code}`));
    });
  });
}
