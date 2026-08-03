import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { Session } from "../dist/session.js";
import { applyAction, readFilePage, safePath, undoLastChangeSet } from "../dist/tools.js";

const cwd = await mkdtemp(join(tmpdir(), "skinnycoder-patch-test-"));
try {
  await testAtomicPatchAndUndo(cwd);
  await testPatchValidation(cwd);
  await testCrossDrivePathRejection(cwd);
  await testSymbolicPathRejection(cwd);
  await testUndoConflict(cwd);
  console.log("patch tests passed");
} finally {
  await rm(cwd, { recursive: true, force: true });
}

async function testCrossDrivePathRejection(cwd) {
  if (process.platform !== "win32") return;

  const currentDrive = parse(cwd).root.slice(0, 2).toLowerCase();
  const otherRoot = currentDrive === "z:" ? "Y:\\" : "Z:\\";
  const outside = join(otherRoot, "skinnycoder-escape.txt");

  assert.throws(() => safePath(cwd, outside), /path escapes cwd/);
  assert.throws(() => safePath(cwd, outside, [otherRoot]), /path escapes cwd/);
  await assert.rejects(readFilePage(cwd, outside), /path escapes cwd/);
  await assert.rejects(
    applyAction(
      { type: "create_file", path: outside, content: "blocked" },
      { cwd, session: new Session(cwd), dryRun: true }
    ),
    /path escapes cwd/
  );
}

async function testSymbolicPathRejection(cwd) {
  const outside = await mkdtemp(join(tmpdir(), "skinnycoder-patch-outside-"));
  const linkPath = join(cwd, "linked-outside");
  try {
    await symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
    const session = new Session(cwd);
    await assert.rejects(
      applyAction({ type: "create_file", path: "linked-outside/escape.txt", content: "blocked" }, { cwd, session, dryRun: true }),
      /symbolic links and junctions are not allowed/
    );
    await assert.rejects(access(join(outside, "escape.txt")));
  } finally {
    await unlink(linkPath).catch(() => undefined);
    await rm(outside, { recursive: true, force: true });
  }
}

async function testAtomicPatchAndUndo(cwd) {
  const session = new Session(cwd);
  await writeFile(join(cwd, "existing.txt"), "alpha\nbeta\n", "utf8");
  const action = {
    type: "patch_files",
    changes: [
      { type: "replace_in_file", path: "existing.txt", oldText: "alpha", newText: "one" },
      { type: "replace_in_file", path: "existing.txt", oldText: "beta", newText: "two" },
      { type: "create_file", path: "nested/new.txt", content: "created\n" }
    ]
  };

  const preview = await applyAction(action, { cwd, session, dryRun: true });
  assert.match(preview, /existing\.txt/);
  assert.match(preview, /nested\/new\.txt/);
  assert.equal(session.listChanges().length, 0);

  const result = await applyAction(action, { cwd, session, dryRun: false });
  assert.match(result, /wrote 2 files/);
  assert.equal(await readFile(join(cwd, "existing.txt"), "utf8"), "one\ntwo\n");
  assert.equal(await readFile(join(cwd, "nested/new.txt"), "utf8"), "created\n");
  assert.equal(session.listChanges().length, 2);
  assert.doesNotMatch(session.contextForModel(), /created/);

  const undone = await undoLastChangeSet(cwd, session);
  assert.match(undone, /existing\.txt/);
  assert.match(undone, /nested\/new\.txt/);
  assert.equal(await readFile(join(cwd, "existing.txt"), "utf8"), "alpha\nbeta\n");
  await assert.rejects(access(join(cwd, "nested/new.txt")));
  assert.equal(session.listChanges().length, 0);
}

async function testPatchValidation(cwd) {
  const session = new Session(cwd);
  await assert.rejects(
    applyAction({ type: "patch_files", changes: [{ type: "create_file", path: "only-one.txt", content: "one" }] }, { cwd, session, dryRun: true }),
    /between 2 and 20/
  );
  await writeFile(join(cwd, "ambiguous.txt"), "same same", "utf8");
  await assert.rejects(
    applyAction({ type: "replace_in_file", path: "ambiguous.txt", oldText: "same", newText: "new" }, { cwd, session, dryRun: true }),
    /oldText is ambiguous/
  );
  await assert.rejects(
    applyAction({ type: "create_file", path: "ambiguous.txt", content: "overwrite" }, { cwd, session, dryRun: true }),
    /target already exists/
  );

  const firstPath = join(cwd, "not-written.txt");
  await assert.rejects(
    applyAction({
      type: "patch_files",
      changes: [
        { type: "create_file", path: "not-written.txt", content: "must stay absent" },
        { type: "replace_in_file", path: "missing.txt", oldText: "x", newText: "y" }
      ]
    }, { cwd, session, dryRun: false }),
    /target does not exist/
  );
  await assert.rejects(access(firstPath));

  await assert.rejects(
    applyAction({
      type: "patch_files",
      changes: [
        { type: "create_file", path: "large-a.txt", content: "a".repeat(40_000) },
        { type: "create_file", path: "large-b.txt", content: "b".repeat(40_000) }
      ]
    }, { cwd, session, dryRun: true }),
    /preview exceeds 60,000 characters/
  );
}

async function testUndoConflict(cwd) {
  const session = new Session(cwd);
  await applyAction({ type: "create_file", path: "conflict.txt", content: "skinnycoder" }, { cwd, session, dryRun: false });
  await writeFile(join(cwd, "conflict.txt"), "external change", "utf8");
  await assert.rejects(undoLastChangeSet(cwd, session), /changed after SkinnyCoder wrote it/);
  assert.equal(await readFile(join(cwd, "conflict.txt"), "utf8"), "external change");
  assert.equal(session.listChanges().length, 1);
}
