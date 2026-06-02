import { createPatch } from "diff";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import type { Session } from "./session.js";
import type { AgentAction } from "./types.js";
import { amber, dim } from "./theme.js";

type ToolContext = {
  cwd: string;
  session: Session;
  dryRun: boolean;
};

export async function applyAction(action: AgentAction, ctx: ToolContext): Promise<string> {
  switch (action.type) {
    case "answer":
      return action.message;
    case "list_files":
      return listFiles(ctx.cwd, action.path ?? ".");
    case "read_file":
      return readCapped(ctx.cwd, action.path);
    case "create_file":
      return writeChanged(ctx, action.path, null, action.content);
    case "replace_in_file": {
      const file = safePath(ctx.cwd, action.path);
      const before = await readFile(file, "utf8");
      const index = before.indexOf(action.oldText);
      if (index < 0) throw new Error(`oldText not found in ${action.path}`);
      const after = before.slice(0, index) + action.newText + before.slice(index + action.oldText.length);
      return writeChanged(ctx, action.path, before, after);
    }
    case "append_file": {
      const file = safePath(ctx.cwd, action.path);
      const before = await readFile(file, "utf8");
      return writeChanged(ctx, action.path, before, before + action.content);
    }
    case "run_command":
      return dim(`$ ${action.command}`);
  }
}

export async function listFiles(cwd: string, path: string): Promise<string> {
  const dir = safePath(cwd, path);
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .slice(0, 80)
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
    .join("\n");
}

export async function readCapped(cwd: string, path: string): Promise<string> {
  const file = safePath(cwd, path);
  const content = await readFile(file, "utf8");
  const capped = content.length > 12000 ? `${content.slice(0, 12000)}\n...[truncated]` : content;
  return amber(capped);
}

async function writeChanged(ctx: ToolContext, path: string, before: string | null, after: string): Promise<string> {
  const file = safePath(ctx.cwd, path);
  const patch = createPatch(path, before ?? "", after, "before", "after");
  if (ctx.dryRun) return amber(patch);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, after, "utf8");
  ctx.session.addChange({ path, before, after });
  return amber(`wrote ${path}`);
}

export function safePath(cwd: string, path: string): string {
  const full = resolve(cwd, path);
  const rel = relative(cwd, full);
  if (rel.startsWith("..") || resolve(full) === resolve(cwd)) {
    if (resolve(full) !== resolve(cwd)) throw new Error(`path escapes cwd: ${path}`);
  }
  return full;
}
