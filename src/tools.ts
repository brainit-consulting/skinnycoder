import { createPatch } from "diff";
import { lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, relative, sep } from "node:path";
import type { Session } from "./session.js";
import type { AgentAction, Change, FileMutation } from "./types.js";
import { amber, dim } from "./theme.js";

type ToolContext = {
  cwd: string;
  session: Session;
  dryRun: boolean;
};

type PlannedChange = Change & { file: string };

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
    case "replace_in_file":
    case "append_file":
      return applyMutations(ctx, [action], false);
    case "patch_files":
      return applyMutations(ctx, action.changes, true);
    case "run_command":
      return dim(`$ ${action.command}`);
  }
}

export async function listFiles(cwd: string, path: string, scope: string[] = []): Promise<string> {
  const dir = safePath(cwd, path, scope);
  await assertNoSymbolicPath(cwd, dir);
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
  await assertNoSymbolicPath(cwd, file);
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

async function applyMutations(ctx: ToolContext, mutations: FileMutation[], grouped: boolean): Promise<string> {
  if (grouped && (mutations.length < 2 || mutations.length > 20)) {
    throw new Error("patch_files requires between 2 and 20 file operations");
  }
  if (!grouped && mutations.length !== 1) throw new Error("single file actions require exactly one operation");
  const changes = await planMutations(ctx.cwd, ctx.session.listScope(), mutations);
  const preview = changes
    .map((change) => createPatch(change.path, change.before ?? "", change.after, "before", "after"))
    .join("\n");
  if (grouped && preview.length > 60_000) {
    throw new Error("grouped patch preview exceeds 60,000 characters; split it into smaller patch_files actions");
  }
  if (ctx.dryRun) return amber(preview);

  const written: PlannedChange[] = [];
  try {
    for (const change of changes) {
      await mkdir(dirname(change.file), { recursive: true });
      await writeFile(change.file, change.after, "utf8");
      written.push(change);
    }
  } catch (err) {
    const rollbackErrors = await rollbackWrites(written);
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`file write failed and ${rollbackErrors.length ? "rollback was incomplete" : "was rolled back"}: ${detail}${rollbackErrors.length ? `; ${rollbackErrors.join("; ")}` : ""}`);
  }

  const recorded = changes.map(({ path, before, after }) => ({ path, before, after }));
  if (grouped) ctx.session.addChangeSet(recorded);
  else ctx.session.addChange(recorded[0]);
  return amber(grouped
    ? `wrote ${changes.length} files:\n${changes.map((change) => `- ${change.path}`).join("\n")}`
    : `wrote ${changes[0].path}`);
}

async function planMutations(cwd: string, scope: string[], mutations: FileMutation[]): Promise<PlannedChange[]> {
  const working = new Map<string, { path: string; file: string; before: string | null; current: string | null }>();

  for (const mutation of mutations) {
    const file = safePath(cwd, mutation.path, scope);
    await assertNoSymbolicPath(cwd, file);
    const key = process.platform === "win32" ? file.toLowerCase() : file;
    let entry = working.get(key);
    if (!entry) {
      const before = await readOptional(file);
      entry = { path: mutation.path, file, before, current: before };
      working.set(key, entry);
    }

    if (mutation.type === "create_file") {
      if (entry.current !== null) throw new Error(`create_file target already exists: ${mutation.path}`);
      entry.current = mutation.content;
      continue;
    }
    if (entry.current === null) throw new Error(`${mutation.type} target does not exist: ${mutation.path}`);
    if (mutation.type === "append_file") {
      entry.current += mutation.content;
      continue;
    }
    if (!mutation.oldText) throw new Error(`oldText must not be empty in ${mutation.path}`);
    const index = entry.current.indexOf(mutation.oldText);
    if (index < 0) throw new Error(`oldText not found in ${mutation.path}`);
    if (entry.current.indexOf(mutation.oldText, index + 1) >= 0) {
      throw new Error(`oldText is ambiguous in ${mutation.path}; include more surrounding text`);
    }
    entry.current = entry.current.slice(0, index) + mutation.newText + entry.current.slice(index + mutation.oldText.length);
  }

  return [...working.values()].map((entry) => {
    if (entry.current === null) throw new Error(`no content produced for ${entry.path}`);
    if (entry.current === entry.before) throw new Error(`patch produces no change in ${entry.path}`);
    return { path: entry.path, file: entry.file, before: entry.before, after: entry.current };
  });
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function rollbackWrites(written: PlannedChange[]): Promise<string[]> {
  const errors: string[] = [];
  for (const change of [...written].reverse()) {
    try {
      if (change.before === null) await unlink(change.file);
      else await writeFile(change.file, change.before, "utf8");
    } catch (err) {
      errors.push(`${change.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}

export async function undoLastChangeSet(cwd: string, session: Session): Promise<string | undefined> {
  const changes = session.popChangeSet();
  if (!changes) return undefined;

  const planned: PlannedChange[] = [];
  try {
    for (const change of changes) {
      const file = safePath(cwd, change.path);
      await assertNoSymbolicPath(cwd, file);
      planned.push({ ...change, file });
    }
    for (const change of planned) {
      const current = await readOptional(change.file);
      if (current !== change.after) throw new Error(`${change.path} changed after SkinnyCoder wrote it; undo refused`);
    }

    const undone: PlannedChange[] = [];
    try {
      for (const change of [...planned].reverse()) {
        if (change.before === null) await unlink(change.file);
        else await writeFile(change.file, change.before, "utf8");
        undone.push(change);
      }
    } catch (err) {
      for (const change of undone.reverse()) {
        await mkdir(dirname(change.file), { recursive: true });
        await writeFile(change.file, change.after, "utf8");
      }
      throw err;
    }
  } catch (err) {
    session.addChangeSet(changes);
    throw err;
  }

  return planned.map((change) => change.path).join(", ");
}

export function safePath(cwd: string, path: string, scope: string[] = []): string {
  const root = resolve(cwd);
  const full = resolve(root, path);
  if (!isWithin(root, full)) throw new Error(`path escapes cwd: ${path}`);
  if (scope.length > 0 && !scope.some((entry) => {
    const scopeRoot = resolve(root, entry);
    return isWithin(root, scopeRoot) && isWithin(scopeRoot, full);
  })) {
    throw new Error(`path is outside active scope: ${path}`);
  }
  return full;
}

async function assertNoSymbolicPath(cwd: string, candidate: string): Promise<void> {
  const rel = relative(cwd, candidate);
  if (!rel) return;
  let current = resolve(cwd);
  for (const segment of rel.split(sep)) {
    current = resolve(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error(`symbolic links and junctions are not allowed in file paths: ${relative(cwd, current)}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
