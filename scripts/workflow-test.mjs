import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../dist/session.js";
import { formatShellResult, runShell } from "../dist/shell.js";
import { actionSkillState, skillContinuationPrompt, skillProgressNeedsInput } from "../dist/workflow.js";

testSkillSemantics();
await testStructuredShellResults();

console.log("workflow tests passed");

function testSkillSemantics() {
  const skill = { name: "start-an-app", path: "C:/skills/start-an-app/SKILL.md", source: "trusted", state: "phase: build" };
  assert.match(skillContinuationPrompt(skill), /Do not repeat confirmed questions, decisions, or approvals/);
  assert.equal(skillProgressNeedsInput({ type: "skill_progress", message: "working", state: "phase: build", requiresInput: false }), false);
  assert.equal(skillProgressNeedsInput({ type: "skill_progress", message: "question", state: "phase: design" }), true);
  assert.equal(actionSkillState({ type: "run_command", command: "npm test", state: "phase: verify" }), "phase: verify");

  const session = new Session("C:/work");
  session.setActiveSkill(skill);
  session.addTurn("continue", { type: "create_file", path: "a.txt", content: "a", state: "transient tool state" }, "wrote a.txt");
  session.updateActiveSkillCheckpoint({ type: "create_file", path: "a.txt", content: "secret source text" }, "wrote a.txt");
  const context = session.contextForModel();
  assert.equal(session.getActiveSkill()?.state, "phase: build");
  assert.equal(session.getActiveSkill()?.checkpoint, "create_file a.txt: wrote a.txt");
  assert.doesNotMatch(session.getActiveSkill()?.checkpoint ?? "", /secret source text/);
  session.updateActiveSkillCheckpoint({ type: "read_file", path: "secret.txt" }, "private first line\nprivate second line");
  assert.equal(session.getActiveSkill()?.checkpoint, "read_file secret.txt: completed");
  assert.doesNotMatch(context, /transient tool state/);
}

async function testStructuredShellResults() {
  const cwd = await mkdtemp(join(tmpdir(), "skinnycoder-shell-test-"));
  try {
    const successCommand = process.platform === "win32" ? "Write-Output shell-ok" : "printf shell-ok";
    const failureCommand = process.platform === "win32" ? "Write-Error shell-bad; exit 7" : "echo shell-bad >&2; exit 7";
    const success = await runShell(successCommand, cwd);
    assert.equal(success.ok, true);
    assert.equal(success.exitCode, 0);
    assert.match(success.stdout, /shell-ok/);
    assert.match(formatShellResult(success), /command succeeded \(exit 0\)/);

    const failure = await runShell(failureCommand, cwd);
    assert.equal(failure.ok, false);
    assert.equal(failure.exitCode, 7);
    assert.match(failure.stderr, /shell-bad/);
    assert.match(formatShellResult(failure), /command failed \(exit 7\)/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
