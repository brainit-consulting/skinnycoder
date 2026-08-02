import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function aboutPagePath(): string {
  return fileURLToPath(new URL("../skinnycoder.html", import.meta.url));
}

export async function openAboutPage(): Promise<string> {
  const path = aboutPagePath();
  if (!existsSync(path)) throw new Error(`about page not found: ${path}`);

  const { command, args } = openCommand(path);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

  return path;
}

function openCommand(path: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", path] };
  }
  if (process.platform === "darwin") return { command: "open", args: [path] };
  return { command: "xdg-open", args: [path] };
}
