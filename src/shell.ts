import { spawn } from "node:child_process";
import { amber, error } from "./theme.js";

export function runShell(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => {
      const text = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      resolve(code === 0 ? amber(text || "command completed") : error(text || `command exited with ${code}`));
    });
  });
}
