import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillManager, SKILLS_CLI_VERSION } from "../dist/skillManager.js";
import { Session } from "../dist/session.js";

const home = await mkdtemp(join(tmpdir(), "skinnycoder-skills-test-"));

try {
  const manager = new SkillManager(process.cwd(), "codex", { home });
  assert.equal((await manager.status("start-an-app")).kind, "missing");

  const skillDir = join(home, ".codex", "skills", "start-an-app");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), "---\nname: start-an-app\ndescription: test\n---\n", "utf8");
  assert.equal((await manager.status("start-an-app")).kind, "unverified");

  const lockDir = join(home, ".agents");
  await mkdir(lockDir, { recursive: true });
  await writeFile(join(lockDir, ".skill-lock.json"), JSON.stringify({
    version: 3,
    skills: { "start-an-app": { source: "brainit-consulting/DreamForgeSoftwareAgentSkills" } }
  }), "utf8");

  const installed = await manager.status("start-an-app");
  assert.equal(installed.kind, "installed");
  assert.equal(installed.path, join(skillDir, "SKILL.md"));

  const command = manager.installCommand("security-scanner");
  assert.match(command, new RegExp(`skills@${SKILLS_CLI_VERSION.replaceAll(".", "\\.")}`));
  assert.match(command, /--skill security-scanner --global --agent codex --yes$/);

  const session = new Session(process.cwd());
  session.setActiveSkill({ name: "start-an-app", path: installed.path, source: installed.skill.source });
  session.updateActiveSkillState("x".repeat(4000));
  assert.equal(session.getActiveSkill().state.length, 3000);
  assert.equal(session.contextStats().skillStateChars, 3000);
  console.log("skill manager tests passed");
} finally {
  await rm(home, { recursive: true, force: true });
}
