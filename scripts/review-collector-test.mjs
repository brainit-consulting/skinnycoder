import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectReviewDiff } from "../dist/review.js";

const repo = mkdtempSync(join(tmpdir(), "skinnycoder-review-test-"));
const unbornRepo = mkdtempSync(join(tmpdir(), "skinnycoder-review-unborn-test-"));
const outside = mkdtempSync(join(tmpdir(), "skinnycoder-review-outside-test-"));

try {
  git("init", "-b", "main");
  git("config", "user.email", "review-test@example.invalid");
  git("config", "user.name", "SkinnyCoder Review Test");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "staged.txt"), "before staged\n");
  writeFileSync(join(repo, "src", "unstaged.txt"), "before unstaged\n");
  writeFileSync(join(repo, "src", "staged-then-reverted.txt"), "baseline\n");
  writeFileSync(join(repo, "outside.txt"), "outside baseline\n");
  git("add", ".");
  git("commit", "-m", "baseline");

  writeFileSync(join(repo, "src", "staged.txt"), "after staged\n");
  git("add", "src/staged.txt");
  writeFileSync(join(repo, "src", "staged-then-reverted.txt"), "temporary staged content\n");
  git("add", "src/staged-then-reverted.txt");
  writeFileSync(join(repo, "src", "staged-then-reverted.txt"), "baseline\n");
  writeFileSync(join(repo, "src", "unstaged.txt"), "after unstaged\n");
  writeFileSync(join(repo, "src", "new file.txt"), "untracked text\n");
  writeFileSync(join(repo, "src", "binary.bin"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(repo, "outside.txt"), "outside changed\n");
  writeFileSync(join(repo, ".gitattributes"), "src/staged.txt diff=evil\n");
  writeFileSync(
    join(repo, "textconv.mjs"),
    "import { writeFileSync } from 'node:fs'; writeFileSync('textconv-sentinel.txt', 'ran');\n"
  );
  git("config", "diff.evil.textconv", "node textconv.mjs");
  const fsmonitor = join(repo, process.platform === "win32" ? "fsmonitor.cmd" : "fsmonitor.sh");
  const fsmonitorSentinel = join(repo, "fsmonitor-sentinel.txt");
  writeFileSync(
    fsmonitor,
    process.platform === "win32"
      ? `@echo off\r\necho ran>"${fsmonitorSentinel}"\r\necho /\r\n`
      : `#!/bin/sh\nprintf ran > '${fsmonitorSentinel}'\nprintf /\n`
  );
  if (process.platform !== "win32") chmodSync(fsmonitor, 0o755);
  git("config", "core.fsmonitor", fsmonitor);

  const scoped = await collectReviewDiff(repo, ["src"]);
  assert.match(scoped, /after staged/);
  assert.match(scoped, /after unstaged/);
  assert.match(scoped, /temporary staged content/);
  assert.match(scoped, /\[staged changes\]/);
  assert.match(scoped, /\[unstaged changes\]/);
  assert.match(scoped, /untracked text/);
  assert.match(scoped, /untracked binary file omitted: src\/binary\.bin/);
  assert.doesNotMatch(scoped, /outside changed/);
  assert.equal(existsSync(join(repo, "textconv-sentinel.txt")), false, "textconv command executed");
  assert.equal(existsSync(fsmonitorSentinel), false, "fsmonitor command executed");

  const secret = "must-not-appear-in-review";
  const secretPath = join(outside, "secret.txt");
  writeFileSync(secretPath, secret);
  try {
    symlinkSync(secretPath, join(repo, "src", "secret-link.txt"));
    const withLink = await collectReviewDiff(repo, ["src"]);
    assert.match(withLink, /untracked symbolic link omitted: src\/secret-link\.txt/);
    assert.doesNotMatch(withLink, new RegExp(secret));
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
    console.log("review collector: symlink test skipped (Windows permission unavailable)");
  }

  writeFileSync(join(repo, "src", "very-large-a.txt"), "a".repeat(40_000));
  writeFileSync(join(repo, "src", "very-large-b.txt"), "b".repeat(40_000));
  writeFileSync(join(repo, "src", "very-large-c.txt"), "c".repeat(40_000));
  const capped = await collectReviewDiff(repo, ["src"]);
  assert.ok(capped.length < 30_100, `review diff was not capped: ${capped.length}`);
  assert.match(capped, /review diff truncated after 30000 characters/);

  for (let index = 0; index < 505; index += 1) {
    writeFileSync(join(repo, "src", `empty-${String(index).padStart(3, "0")}.txt`), "");
  }
  const manyEmpty = await collectReviewDiff(repo, ["src"]);
  assert.match(manyEmpty, /untracked empty file: src\/empty-000\.txt/);
  assert.match(manyEmpty, /additional untracked files omitted after 500 entries/);

  writeFileSync(join(repo, "src", "unstaged.txt"), "z".repeat(2_100_000));
  const largeTracked = await collectReviewDiff(repo, ["src"]);
  assert.ok(largeTracked.length < 30_100, `large tracked diff was not capped: ${largeTracked.length}`);
  assert.match(largeTracked, /review diff truncated after 30000 characters/);

  gitIn(unbornRepo, "init", "-b", "main");
  gitIn(unbornRepo, "config", "user.email", "review-test@example.invalid");
  gitIn(unbornRepo, "config", "user.name", "SkinnyCoder Review Test");
  writeFileSync(join(unbornRepo, "staged.txt"), "staged before first commit\n");
  gitIn(unbornRepo, "add", "staged.txt");
  writeFileSync(join(unbornRepo, "untracked.txt"), "untracked before first commit\n");
  const unborn = await collectReviewDiff(unbornRepo, []);
  assert.match(unborn, /staged before first commit/);
  assert.match(unborn, /untracked before first commit/);

  console.log("review collector tests passed");
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(unbornRepo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}

function git(...args) {
  gitIn(repo, ...args);
}

function gitIn(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
