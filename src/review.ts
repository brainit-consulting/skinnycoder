import { execFile, spawn } from "node:child_process";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import { safePath } from "./tools.js";

const execFileAsync = promisify(execFile);
const DIFF_LIMIT = 30_000;
const UNTRACKED_FILE_LIMIT = 12_000;
const UNTRACKED_ENTRY_LIMIT = 500;
const EMPTY_GIT_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GIT_TIMEOUT_MS = 30_000;
const SAFE_GIT_CONFIG = ["-c", "core.fsmonitor=false"];

export async function collectReviewDiff(cwd: string, scope: string[]): Promise<string> {
  const targets = scope.length ? scope : ["."];
  await requireGitRepository(cwd);

  const base = await hasHead(cwd) ? "HEAD" : EMPTY_GIT_TREE;
  const chunks: string[] = [];
  await appendTrackedSection(chunks, cwd, "staged changes", [
    "diff", "--cached", "--no-ext-diff", "--no-textconv", "--unified=3", base, "--", ...targets
  ]);
  if (combinedChunks(chunks).length > DIFF_LIMIT) return capReviewDiff(combinedChunks(chunks));

  await appendTrackedSection(chunks, cwd, "unstaged changes", [
    "diff", "--no-ext-diff", "--no-textconv", "--unified=3", "--", ...targets
  ]);
  if (combinedChunks(chunks).length > DIFF_LIMIT) return capReviewDiff(combinedChunks(chunks));

  let untrackedCount = 0;
  for await (const path of gitNullPaths(
    cwd,
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...targets]
  )) {
    if (untrackedCount >= UNTRACKED_ENTRY_LIMIT) {
      chunks.push(`[additional untracked files omitted after ${UNTRACKED_ENTRY_LIMIT} entries]`);
      break;
    }
    untrackedCount += 1;
    chunks.push(await untrackedPatch(cwd, path, scope));
    const partial = combinedChunks(chunks);
    if (partial.length > DIFF_LIMIT) return capReviewDiff(partial);
  }

  return combinedChunks(chunks);
}

async function untrackedPatch(cwd: string, path: string, scope: string[]): Promise<string> {
  const file = safePath(cwd, path, scope);
  try {
    const entry = await lstat(file);
    if (entry.isSymbolicLink()) return `[untracked symbolic link omitted: ${path}]`;
    if (!entry.isFile()) return `[untracked non-regular file omitted: ${path}]`;
    if (entry.size === 0) return `[untracked empty file: ${path}]`;

    const handle = await open(file, "r");
    try {
      const opened = await handle.stat();
      const current = await lstat(file);
      if (!current.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) {
        return `[untracked file changed during review and was omitted: ${path}]`;
      }
      const resolvedFile = await realpath(file);
      const resolvedEntry = await lstat(resolvedFile);
      if (opened.dev !== resolvedEntry.dev || opened.ino !== resolvedEntry.ino) {
        return `[untracked file changed during review and was omitted: ${path}]`;
      }
      await requireResolvedScope(cwd, resolvedFile, scope);

      const result = await gitOutput(
        cwd,
        ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--unified=3", "--", "/dev/null", "-"],
        UNTRACKED_FILE_LIMIT + 1,
        [0, 1],
        handle.createReadStream({ autoClose: false })
      );
      if (/^Binary files .+ differ\s*$/m.test(result.text)) {
        return `[untracked binary file omitted: ${path}]`;
      }
      const labeled = `[untracked file: ${path}]\n${result.text.trim()}`;
      if (result.truncated || labeled.length > UNTRACKED_FILE_LIMIT) {
        return `${labeled.slice(0, UNTRACKED_FILE_LIMIT)}\n...[untracked file patch truncated]`;
      }
      return labeled;
    } finally {
      await handle.close();
    }
  } catch {
    return `[untracked unreadable file omitted: ${path}]`;
  }
}

async function appendTrackedSection(
  chunks: string[],
  cwd: string,
  label: string,
  args: string[]
): Promise<void> {
  const remaining = Math.max(1, DIFF_LIMIT + 1 - combinedChunks(chunks).length);
  const result = await gitOutput(cwd, args, remaining);
  if (result.text.trim()) chunks.push(`[${label}]\n${result.text.trim()}`);
  if (result.truncated) chunks.push(`[${label} truncated]`);
}

function combinedChunks(chunks: string[]): string {
  return chunks.filter(Boolean).join("\n\n");
}

async function requireResolvedScope(cwd: string, resolvedFile: string, scope: string[]): Promise<void> {
  const resolvedCwd = await realpath(cwd);
  if (!isWithin(resolvedCwd, resolvedFile)) throw new Error("resolved path escapes cwd");
  if (scope.length === 0) return;

  const roots = await Promise.all(scope.map((entry) => realpath(resolve(cwd, entry))));
  if (!roots.some((root) => isWithin(root, resolvedFile))) {
    throw new Error("resolved path is outside active scope");
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function requireGitRepository(cwd: string): Promise<void> {
  try {
    const result = await execFileAsync("git", [...SAFE_GIT_CONFIG, "rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS
    });
    if (result.stdout.trim() === "true") return;
  } catch {
    // The stable user-facing error below is more useful than Git's stderr.
  }
  throw new Error("/review requires a Git repository");
}

async function hasHead(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", [...SAFE_GIT_CONFIG, "rev-parse", "--verify", "--quiet", "HEAD"], {
      cwd,
      timeout: GIT_TIMEOUT_MS
    });
    return true;
  } catch {
    return false;
  }
}

function capReviewDiff(diff: string): string {
  return `${diff.slice(0, DIFF_LIMIT)}\n...[review diff truncated after ${DIFF_LIMIT} characters]`;
}

function gitOutput(
  cwd: string,
  args: string[],
  captureLimit: number,
  allowedCodes: number[] = [0],
  input?: Readable
): Promise<{ text: string; truncated: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", [...SAFE_GIT_CONFIG, ...args], { cwd, shell: false });
    let text = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, GIT_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const remaining = captureLimit - text.length;
      if (remaining > 0) text += chunk.slice(0, remaining);
      if (chunk.length > remaining) {
        truncated = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 2_000) stderr += chunk.slice(0, 2_000 - stderr.length);
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (!truncated && !timedOut && error.code !== "EPIPE") reject(error);
    });
    if (input) input.pipe(child.stdin);
    else child.stdin.end();
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      input?.destroy();
      if (timedOut) reject(new Error(`git timed out after ${GIT_TIMEOUT_MS / 1_000} seconds`));
      else if (truncated || (code !== null && allowedCodes.includes(code))) {
        resolvePromise({ text, truncated });
      }
      else reject(new Error(stderr.trim() || `git exited with ${code}`));
    });
  });
}

async function* gitNullPaths(cwd: string, args: string[]): AsyncGenerator<string> {
  const child = spawn("git", [...SAFE_GIT_CONFIG, ...args], { cwd, shell: false });
  let stderr = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, GIT_TIMEOUT_MS);
  const completed = new Promise<number | null>((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", resolvePromise);
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 2_000) stderr += chunk.slice(0, 2_000 - stderr.length);
  });

  let pending = "";
  try {
    for await (const chunk of child.stdout) {
      pending += String(chunk);
      let separator = pending.indexOf("\0");
      while (separator >= 0) {
        const path = pending.slice(0, separator);
        pending = pending.slice(separator + 1);
        if (path) yield path;
        separator = pending.indexOf("\0");
      }
    }
    const code = await completed;
    if (timedOut) throw new Error(`git timed out after ${GIT_TIMEOUT_MS / 1_000} seconds`);
    if (code !== 0) throw new Error(stderr.trim() || `git exited with ${code}`);
    if (pending) throw new Error("git returned an incomplete path list");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) {
      child.kill();
      await completed.catch(() => undefined);
    }
  }
}
