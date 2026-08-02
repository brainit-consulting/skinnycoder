import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const SKILLS_CLI_VERSION = "1.5.21";

export type TrustedSkillName = "start-an-app" | "security-scanner";
export type SkillAgent = "codex" | "cursor";

export type TrustedSkill = {
  name: TrustedSkillName;
  command: `/${TrustedSkillName}`;
  description: string;
  source: string;
  acceptedSources: string[];
};

export type SkillStatus = {
  skill: TrustedSkill;
  kind: "installed" | "missing" | "unverified" | "invalid";
  path?: string;
  detail?: string;
};

type SkillLock = {
  skills?: Record<string, { source?: string; sourceUrl?: string }>;
};

type RunResult = { stdout: string; stderr: string };
type ProcessRunner = (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<RunResult>;

const DREAMFORGE_SOURCE = "brainit-consulting/DreamForgeSoftwareAgentSkills";

export const TRUSTED_SKILLS: Record<TrustedSkillName, TrustedSkill> = {
  "start-an-app": {
    name: "start-an-app",
    command: "/start-an-app",
    description: "Interview the user, agree a build sheet, and scaffold a new app",
    source: DREAMFORGE_SOURCE,
    acceptedSources: [DREAMFORGE_SOURCE, "brainit-consulting/skills"]
  },
  "security-scanner": {
    name: "security-scanner",
    command: "/security-scanner",
    description: "Audit an application against the OWASP Top 10:2025",
    source: DREAMFORGE_SOURCE,
    acceptedSources: [DREAMFORGE_SOURCE, "brainit-consulting/skills"]
  }
};

export class SkillManager {
  private readonly home: string;
  private readonly runner: ProcessRunner;

  constructor(
    private readonly cwd: string,
    private readonly agent: SkillAgent = "codex",
    options: { home?: string; runner?: ProcessRunner } = {}
  ) {
    this.home = options.home ?? homedir();
    this.runner = options.runner ?? runProcess;
  }

  async list(): Promise<SkillStatus[]> {
    return Promise.all(Object.values(TRUSTED_SKILLS).map((skill) => this.status(skill.name)));
  }

  async status(name: TrustedSkillName): Promise<SkillStatus> {
    const skill = TRUSTED_SKILLS[name];
    const candidates = this.skillCandidates(name);
    let invalidPath: string | undefined;

    for (const path of candidates) {
      const declaredName = await readDeclaredSkillName(path);
      if (declaredName === undefined) continue;
      if (declaredName !== name) {
        invalidPath ??= path;
        continue;
      }

      const source = await this.lockedSource(name);
      if (!source) {
        return {
          skill,
          kind: "unverified",
          path,
          detail: "installed skill has no source record"
        };
      }
      if (!skill.acceptedSources.some((accepted) => sameSource(source, accepted))) {
        return {
          skill,
          kind: "unverified",
          path,
          detail: `installed source is ${source}`
        };
      }
      return { skill, kind: "installed", path, detail: `trusted source ${source}` };
    }

    if (invalidPath) {
      return {
        skill,
        kind: "invalid",
        path: invalidPath,
        detail: `SKILL.md does not declare name: ${name}`
      };
    }
    return { skill, kind: "missing" };
  }

  installCommand(name: TrustedSkillName): string {
    return ["npx", "--yes", `skills@${SKILLS_CLI_VERSION}`, "add", TRUSTED_SKILLS[name].source,
      "--skill", name, "--global", "--agent", this.agent, "--yes"].join(" ");
  }

  async install(name: TrustedSkillName): Promise<SkillStatus> {
    const skill = TRUSTED_SKILLS[name];
    const args = [
      "--yes",
      `skills@${SKILLS_CLI_VERSION}`,
      "add",
      skill.source,
      "--skill",
      name,
      "--global",
      "--agent",
      this.agent,
      "--yes"
    ];
    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    const result = await this.runner(command, args, {
      ...process.env,
      DISABLE_TELEMETRY: "1",
      DO_NOT_TRACK: "1"
    });
    const status = await this.status(name);
    if (status.kind !== "installed") {
      const output = `${result.stderr}\n${result.stdout}`.trim();
      throw new Error(`skill installation completed but ${name} could not be verified${output ? `: ${output.slice(0, 800)}` : ""}`);
    }
    return status;
  }

  private skillCandidates(name: TrustedSkillName): string[] {
    const providerRoot = this.agent === "cursor" ? ".cursor" : ".codex";
    return [
      join(this.home, providerRoot, "skills", name, "SKILL.md"),
      join(this.home, ".agents", "skills", name, "SKILL.md"),
      join(this.cwd, ".agents", "skills", name, "SKILL.md")
    ];
  }

  private async lockedSource(name: TrustedSkillName): Promise<string | undefined> {
    const lockPath = join(this.home, ".agents", ".skill-lock.json");
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as SkillLock;
      const entry = lock.skills?.[name];
      return entry?.source ?? entry?.sourceUrl;
    } catch {
      return undefined;
    }
  }
}

async function readDeclaredSkillName(path: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, "utf8");
    const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    const name = frontmatter?.[1].match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1].trim();
    return name || "";
  } catch {
    return undefined;
  }
}

function sameSource(actual: string, expected: string): boolean {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  return normalize(actual) === normalize(expected);
}

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: process.platform === "win32",
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited with ${code}`));
    });
  });
}
