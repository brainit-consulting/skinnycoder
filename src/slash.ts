import { stat, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, relative } from "node:path";
import type { Interface } from "node:readline/promises";
import type { CodexProvider } from "./codexProvider.js";
import type { Session } from "./session.js";
import { TRUSTED_SKILLS, type SkillManager, type SkillStatus, type TrustedSkillName } from "./skillManager.js";
import { runShell } from "./shell.js";
import { listFiles, readCapped, safePath } from "./tools.js";
import { amber, dim, error, ok } from "./theme.js";
import { openAboutPage } from "./about.js";
import { collectReviewDiff } from "./review.js";
import { skinnyCoderVersion } from "./version.js";

const execFileAsync = promisify(execFile);

type SlashContext = {
  cwd: string;
  session: Session;
  provider: CodexProvider;
  skillManager: SkillManager;
  rl: Interface;
};

type SlashPrompt = { prompt: string };

export async function handleSlash(line: string, ctx: SlashContext): Promise<boolean | SlashPrompt> {
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd) {
    case "/help":
      console.log(amber(helpText()));
      return true;
    case "/about":
      console.log(ok(`opened ${await openAboutPage()}`));
      return true;
    case "/login":
      console.log(await ctx.provider.login());
      return true;
    case "/model":
      if (arg === "default" || arg === "reset") ctx.provider.setModel(undefined);
      else if (arg) ctx.provider.setModel(arg);
      console.log(dim(`model: ${ctx.provider.describeModel()}`));
      if (!arg) console.log(dim("usage: /model <name> | /model default"));
      return true;
    case "/reasoning":
      if (arg === "default" || arg === "reset") ctx.provider.setReasoningEffort(undefined);
      else if (arg) ctx.provider.setReasoningEffort(arg.toLowerCase());
      console.log(dim(`reasoning: ${ctx.provider.describeReasoning()}`));
      if (!arg) console.log(dim("usage: /reasoning <low|medium|high|xhigh|max|ultra> | /reasoning default"));
      return true;
    case "/status":
      console.log(dim(`cwd: ${ctx.cwd}\nmodel: ${ctx.provider.describeModel()}\nactive skill: ${ctx.session.getActiveSkill()?.name ?? "none"}\nscope: ${formatScope(ctx.session)}\nchanges: ${ctx.session.listChanges().length}`));
      return true;
    case "/context":
      console.log(formatContext(ctx));
      return true;
    case "/files":
      console.log(await listFiles(ctx.cwd, defaultScopedPath(ctx.session, arg), ctx.session.listScope()));
      return true;
    case "/read":
      console.log(await readCapped(ctx.cwd, arg, ctx.session.listScope()));
      return true;
    case "/run":
      if (!arg) {
        console.log(dim("usage: /run <command>"));
        return true;
      }
      console.log(amber(`$ ${arg}`));
      if (!await askYesNo(ctx.rl, "Run command?")) {
        console.log(dim("skipped"));
        return true;
      }
      console.log(await runShell(arg, ctx.cwd));
      return true;
    case "/scope":
      setOrShowScope(ctx, arg);
      return true;
    case "/web":
      if (!arg) {
        console.log(dim("usage: /web <query>"));
        return true;
      }
      console.log(dim("searching web..."));
      console.log(amber(await ctx.provider.webSearch(arg)));
      console.log(dim("web query and answer were not retained in conversation context"));
      return true;
    case "/review": {
      const diff = await collectReviewDiff(ctx.cwd, ctx.session.listScope());
      if (!diff) {
        console.log(dim("no uncommitted changes to review within the active scope"));
        return true;
      }
      console.log(dim(`reviewing ${diff.length.toLocaleString()} characters of scoped diff...`));
      console.log(amber(await ctx.provider.reviewDiff(diff)));
      console.log(dim("review diff and findings were not retained in conversation context"));
      return true;
    }
    case "/skills":
      if (arg === "stop") {
        const active = ctx.session.getActiveSkill();
        ctx.session.setActiveSkill(undefined);
        console.log(dim(active ? `stopped skill: ${active.name}` : "no active skill"));
        return true;
      }
      console.log(await formatSkills(ctx));
      return true;
    case "/start-an-app":
      if (await hasExistingProject(ctx.cwd)) {
        throw new Error("/start-an-app requires a new or empty folder; launch SkinnyCoder in the folder where the new app should be created");
      }
      return activateSkill(ctx, "start-an-app", arg || "Begin the workflow and ask the first discovery question.");
    case "/security-scanner":
      return activateSkill(ctx, "security-scanner", arg || "Begin a security scan of the current working directory. Start with read-only reconnaissance.");
    case "/diff":
      console.log(await gitDiff(ctx.cwd, ctx.session.listScope()));
      return true;
    case "/changes":
      console.log(ctx.session.listChanges().map((c, i) => `${i + 1}. ${c.path}`).join("\n") || dim("no skinnycoder changes"));
      return true;
    case "/undo": {
      const change = ctx.session.popChange();
      if (!change) {
        console.log(dim("nothing to undo"));
        return true;
      }
      const file = safePath(ctx.cwd, change.path);
      if (change.before === null) await unlink(file).catch(() => undefined);
      else await writeFile(file, change.before, "utf8");
      console.log(ok(`undid ${change.path}`));
      return true;
    }
    case "/clear":
      ctx.session.clear();
      console.log(dim("conversation cleared"));
      return true;
    case "/exit":
    case "/quit":
      return false;
    default:
      console.log(dim("unknown command; try /help"));
      return true;
  }
}

function formatContext(ctx: SlashContext): string {
  const stats = ctx.session.contextStats();
  const usage = ctx.provider.getLastUsage();
  const lines = [
    "skinnycoder retained context",
    `  active skill: ${ctx.session.getActiveSkill()?.name ?? "none"}`,
    `  retained turns: ${stats.retainedTurns} (${stats.modelTurns} sent to Codex)`,
    `  cwd: ${stats.cwdChars} chars`,
    `  scope: ${stats.scopeChars} chars (${formatScope(ctx.session)})`,
    `  skill state: ${stats.skillStateChars} chars`,
    `  user prompts: ${stats.userChars} chars`,
    `  action json: ${stats.actionChars} chars`,
    `  tool results: ${stats.resultChars} chars`,
    `  total local context: ${stats.totalChars} chars (~${stats.estimatedTokens} tokens)`
  ];

  if (usage) {
    lines.push(
      "",
      "last Codex call",
      `  input: ${usage.input_tokens ?? "?"} tokens`,
      `  cached input: ${usage.cached_input_tokens ?? "?"} tokens`,
      `  output: ${usage.output_tokens ?? "?"} tokens`,
      `  reasoning output: ${usage.reasoning_output_tokens ?? "?"} tokens`
    );
  } else {
    lines.push("", "last Codex call: none yet");
  }

  return dim(lines.join("\n"));
}

async function activateSkill(ctx: SlashContext, name: TrustedSkillName, request: string): Promise<boolean | SlashPrompt> {
  let status = await ctx.skillManager.status(name);
  if (status.kind !== "installed") {
    console.log(dim(skillStatusLine(status)));
    console.log(dim(`source: https://github.com/${TRUSTED_SKILLS[name].source}`));
    console.log(dim(`command: ${ctx.skillManager.installCommand(name)}`));
    if (!await askYesNo(ctx.rl, `Install trusted ${name} skill for Codex?`)) {
      console.log(dim("skill installation skipped"));
      return true;
    }
    console.log(dim(`installing ${name}...`));
    status = await ctx.skillManager.install(name);
  }

  if (!status.path) throw new Error(`${name} is installed but its SKILL.md path is unavailable`);
  ctx.session.setActiveSkill({
    name,
    path: status.path,
    source: TRUSTED_SKILLS[name].source
  });
  console.log(ok(`active skill: ${name}`));
  return { prompt: request };
}

async function formatSkills(ctx: SlashContext): Promise<string> {
  const statuses = await ctx.skillManager.list();
  const lines = [
    `trusted skills (active: ${ctx.session.getActiveSkill()?.name ?? "none"})`,
    ...statuses.map((status) => `  ${status.skill.command.padEnd(20)} ${skillStatusLine(status)}`),
    "  /skills stop         Stop the active skill workflow"
  ];
  return dim(lines.join("\n"));
}

function skillStatusLine(status: SkillStatus): string {
  if (status.kind === "installed") return `installed (${status.path})`;
  if (status.kind === "missing") return "not installed for Codex";
  return `${status.kind}: ${status.detail ?? status.path ?? "verification failed"}`;
}

async function hasExistingProject(cwd: string): Promise<boolean> {
  const indicators = ["package.json", "requirements.txt", "go.mod", "pom.xml", "Cargo.toml", "Gemfile", "src", "app", "lib"];
  for (const indicator of indicators) {
    try {
      await stat(join(cwd, indicator));
      return true;
    } catch {
      // Continue looking for a real project marker.
    }
  }
  return false;
}

async function gitDiff(cwd: string, scope: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--", ...(scope.length ? scope : ["."])], { cwd });
    return stdout || dim("no git diff");
  } catch {
    return dim("not a git repository");
  }
}

function helpText(): string {
  return [
    "/help                         Show commands",
    `/about                        Open the SkinnyCoder v${skinnyCoderVersion} page`,
    "/login                        Run Codex login",
    "/model [name|default]         Show, override, or reset the Codex model",
    "/reasoning [level|default]    Show, override, or reset reasoning effort",
    "/status                       Show cwd, model, active skill, scope, and changes",
    "/context                      Show retained context and last token usage",
    "/skills [stop]                Show trusted skills or stop the active workflow",
    "/start-an-app [idea]          Interview, plan, and scaffold a new app",
    "/security-scanner             Run an OWASP Top 10:2025 audit workflow",
    "/scope [paths|clear]          Show, set, or clear file boundaries",
    "/files [path]                 List files within the active scope",
    "/read <file>                  Read a capped file preview within scope",
    "/edit <file> <instruction>    Ask Codex to edit a file",
    "/run <command>                Preview, approve, and run a local command",
    "/web <query>                  Run an isolated web search with source links",
    "/review                       Review scoped uncommitted changes",
    "/diff                         Show git diff within the active scope",
    "/changes                      Show files changed by SkinnyCoder",
    "/undo                         Undo the last SkinnyCoder file change",
    "/clear                        Clear retained conversation turns",
    "/exit                         Quit"
  ].join("\n");
}

function setOrShowScope(ctx: SlashContext, arg: string): void {
  if (!arg) {
    console.log(dim(`scope: ${formatScope(ctx.session)}`));
    console.log(dim("usage: /scope <path...> | /scope clear"));
    return;
  }
  if (arg === "clear" || arg === "reset") {
    ctx.session.setScope([]);
    console.log(dim("scope: entire working directory"));
    return;
  }

  const paths = parseArguments(arg).map((path) => {
    const full = safePath(ctx.cwd, path);
    return relative(ctx.cwd, full) || ".";
  });
  if (paths.length === 0) throw new Error("scope requires at least one path");
  ctx.session.setScope([...new Set(paths)]);
  console.log(ok(`scope: ${formatScope(ctx.session)}`));
}

function parseArguments(input: string): string[] {
  const matches = input.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((value) => {
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    return quoted ? value.slice(1, -1) : value;
  });
}

function formatScope(session: Session): string {
  const scope = session.listScope();
  return scope.length ? scope.join(", ") : "entire working directory";
}

function defaultScopedPath(session: Session, arg: string): string {
  if (arg) return arg;
  const scope = session.listScope();
  if (scope.length === 1) return scope[0];
  if (scope.length > 1) throw new Error(`multiple scope paths active; specify one of: ${scope.join(", ")}`);
  return ".";
}

async function askYesNo(rl: Interface, question: string): Promise<boolean> {
  try {
    const answer = (await rl.question(amber(`${question} [y/N] `))).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } catch (err) {
    console.log(error(err instanceof Error ? err.message : String(err)));
    return false;
  }
}
