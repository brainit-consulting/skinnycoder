import { createPatch } from "diff";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, relative, sep } from "node:path";
import type { Session } from "./session.js";
import type { AgentAction } from "./types.js";
import { amber, dim } from "./theme.js";

type ToolContext = {
  cwd: string;
  session: Session;
  dryRun: boolean;
};

export async function applyAction(action: AgentAction, ctx: ToolContext): Promise<string> {
  const scope = ctx.session.listScope();
  switch (action.type) {
    case "answer":
    case "skill_progress":
    case "complete_skill":
      return action.message;
    case "list_files":
      return listFiles(ctx.cwd, action.path ?? ".", scope);
    case "read_file":
      return readFilePage(ctx.cwd, action.path, scope, action.startLine, action.lineCount);
    case "create_file":
      return writeChanged(ctx, action.path, null, action.content);
    case "replace_in_file": {
      const file = safePath(ctx.cwd, action.path, scope);
      const before = await readFile(file, "utf8");
      const index = before.indexOf(action.oldText);
      if (index < 0) throw new Error(`oldText not found in ${action.path}`);
      const after = before.slice(0, index) + action.newText + before.slice(index + action.oldText.length);
      return writeChanged(ctx, action.path, before, after);
    }
    case "append_file": {
      const file = safePath(ctx.cwd, action.path, scope);
      const before = await readFile(file, "utf8");
      return writeChanged(ctx, action.path, before, before + action.content);
    }
    case "run_command":
      return dim(`$ ${action.command}`);
  }
}

export async function listFiles(cwd: string, path: string, scope: string[] = []): Promise<string> {
  const dir = safePath(cwd, path, scope);
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .slice(0, 80)
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
    .join("\n");
}

export async function readCapped(cwd: string, path: string, scope: string[] = []): Promise<string> {
  return readFilePage(cwd, path, scope);
}

export async function readFilePage(
  cwd: string,
  path: string,
  scope: string[] = [],
  startLine = 1,
  lineCount = 200
): Promise<string> {
  if (!Number.isInteger(startLine) || startLine < 1) throw new Error("read start line must be a positive integer");
  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 400) {
    throw new Error("read line count must be between 1 and 400");
  }
  const file = safePath(cwd, path, scope);
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);
  if (startLine > lines.length) throw new Error(`start line ${startLine} is beyond ${path} (${lines.length} lines)`);

  const requested = lines.slice(startLine - 1, startLine - 1 + lineCount);
  let shown = requested;
  let rendered = shown.join("\n");
  while (shown.length > 1 && rendered.length > 12_000) {
    shown = shown.slice(0, -1);
    rendered = shown.join("\n");
  }
  let longLineCapped = false;
  if (rendered.length > 12_000) {
    rendered = rendered.slice(0, 12_000);
    longLineCapped = true;
  }

  const lastShownLine = startLine + shown.length - 1;
  const hasMore = lastShownLine < lines.length;
  const notices: string[] = [];
  if (longLineCapped) notices.push(`[line ${startLine} was capped at 12,000 characters]`);
  if (hasMore) {
    const quotedPath = /\s/.test(path) ? JSON.stringify(path) : path;
    notices.push(`[showing lines ${startLine}-${lastShownLine} of ${lines.length}; continue with /read ${quotedPath} --from ${lastShownLine + 1} --lines ${lineCount}]`);
  }
  return amber([rendered, ...notices].filter(Boolean).join("\n"));
}

async function writeChanged(ctx: ToolContext, path: string, before: string | null, after: string): Promise<string> {
  const file = safePath(ctx.cwd, path, ctx.session.listScope());
  const patch = createPatch(path, before ?? "", after, "before", "after");
  if (ctx.dryRun) return amber(patch);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, after, "utf8");
  ctx.session.addChange({ path, before, after });
  return amber(`wrote ${path}`);
}

export function safePath(cwd: string, path: string, scope: string[] = []): string {
  const full = resolve(cwd, path);
  const rel = relative(cwd, full);
  if (rel.startsWith("..") || resolve(full) === resolve(cwd)) {
    if (resolve(full) !== resolve(cwd)) throw new Error(`path escapes cwd: ${path}`);
  }
  if (scope.length > 0 && !scope.some((entry) => isWithin(resolve(cwd, entry), full))) {
    throw new Error(`path is outside active scope: ${path}`);
  }
  return full;
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
