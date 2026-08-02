#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { runShell } from "./shell.js";
import { Session } from "./session.js";
import { amber, animatedLogo, dim, error, promptText, startupInfo, staticLogo } from "./theme.js";
import { CodexProvider, normalizeReasoningEffort } from "./codexProvider.js";
import { checkCodexVersion, codexUpdateCommand, updateCodex } from "./codexVersion.js";
import { handleSlash } from "./slash.js";
import { applyAction } from "./tools.js";
import { skinnyCoderVersion } from "./version.js";
import { SkillManager } from "./skillManager.js";

const program = new Command()
  .name("skinnycoder")
  .description("Lean amber-terminal coding CLI")
  .version(skinnyCoderVersion)
  .option("-C, --cwd <dir>", "working directory", process.cwd())
  .option("-m, --model <model>", "Codex model")
  .option("-r, --reasoning <effort>", "Codex reasoning effort", parseReasoningOption)
  .option("--logo", "show startup logo", true)
  .option("--no-logo", "skip startup logo")
  .option("--update-check", "check for Codex CLI updates on startup", true)
  .option("--no-update-check", "skip the Codex CLI update check")
  .parse(process.argv);

const opts = program.opts<{ cwd: string; model?: string; reasoning?: string; logo: boolean; updateCheck: boolean }>();
const cwd = resolve(opts.cwd);
const session = new Session(cwd);
const provider = new CodexProvider(cwd, opts.model, opts.reasoning);
const skillManager = new SkillManager(cwd, "codex");
const rl = createInterface({ input, output });

async function askYesNo(question: string): Promise<boolean> {
  const answer = (await rl.question(amber(`${question} [y/N] `))).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function main() {
  if (opts.logo) await animatedLogo(output);
  else console.log(staticLogo());
  console.log(startupInfo(cwd, skinnyCoderVersion));
  console.log(dim(`model: ${provider.describeModel()}\n`));
  if (input.isTTY && opts.updateCheck) await checkCodexAtStartup();

  while (true) {
    let line: string;
    try {
      line = (await rl.question(promptText("> "))).trim();
    } catch {
      break;
    }
    if (!line) continue;

    if (line.startsWith("/edit")) {
      const editPrompt = toEditPrompt(line);
      if (!editPrompt) {
        console.log(dim("usage: /edit <file> <instruction>"));
        continue;
      }
      line = editPrompt;
    } else if (line.startsWith("/")) {
      try {
        const slashResult = await handleSlash(line, { cwd, session, provider, skillManager, rl });
        if (typeof slashResult === "boolean") {
          if (!slashResult) break;
          continue;
        }
        line = slashResult.prompt;
      } catch (err) {
        console.log(error(err instanceof Error ? err.message : String(err)));
        continue;
      }
    }

    try {
      let nextPrompt = line;
      const stepLimit = session.getActiveSkill() ? 24 : 6;
      let settled = false;
      for (let step = 0; step < stepLimit; step++) {
        const action = await withSpinner("thinking", () => provider.nextAction(nextPrompt, session.contextForModel(), session.getActiveSkill()));
        if (action.type === "answer") {
          console.log(amber(action.message));
          session.addTurn(nextPrompt, action, action.message);
          settled = true;
          break;
        }

        if (action.type === "skill_progress") {
          session.updateActiveSkillState(action.state);
          console.log(amber(action.message));
          session.addTurn(nextPrompt, action, action.message);
          settled = true;
          break;
        }

        if (action.type === "complete_skill") {
          console.log(amber(action.message));
          session.addTurn(nextPrompt, action, action.message);
          const completed = session.getActiveSkill();
          session.setActiveSkill(undefined);
          if (completed) console.log(dim(`skill complete: ${completed.name}`));
          settled = true;
          break;
        }

        if (action.type === "read_file" || action.type === "list_files") {
          const result = await applyAction(action, { cwd, session, dryRun: false });
          console.log(result);
          session.addTurn(nextPrompt, action, result);
          if (action.type === "read_file" && isDisplayOnlyRead(nextPrompt)) break;
          nextPrompt = "Continue using the tool result. Return the next single JSON action.";
          continue;
        }

        const preview = await applyAction(action, { cwd, session, dryRun: true });
        console.log(preview);
        const approved = await askYesNo(`Approve ${action.type}?`);
        if (!approved) {
          console.log(dim("skipped"));
          session.addTurn(nextPrompt, { type: "answer", message: "User rejected action." }, "rejected");
          settled = true;
          break;
        }

        const result = await withSpinner("working", () => action.type === "run_command"
          ? runShell(action.command, cwd)
          : applyAction(action, { cwd, session, dryRun: false }));
        console.log(result);
        session.addTurn(nextPrompt, action, result);
        nextPrompt = "Continue after the approved action. Return answer if done, otherwise the next single JSON action.";
      }
      if (!settled && session.getActiveSkill()) {
        console.log(dim(`workflow paused after ${stepLimit} actions; type continue to resume ${session.getActiveSkill()?.name}`));
      }
    } catch (err) {
      console.log(error(err instanceof Error ? err.message : String(err)));
    }
  }

  rl.close();
}

async function checkCodexAtStartup(): Promise<void> {
  const status = await withSpinner("checking Codex", checkCodexVersion);
  if (status.kind === "current") {
    console.log(dim(`codex: ${status.installed} (current)`));
    return;
  }

  if (status.kind === "missing") {
    console.log(error("Codex CLI was not found."));
    console.log(dim(`Install it with: ${codexUpdateCommand()}`));
    if (await askYesNo("Install Codex CLI now?")) await installCodexUpdate();
    return;
  }

  if (status.kind === "unknown") {
    const installed = status.installed ? ` ${status.installed}` : "";
    console.log(dim(`codex${installed}: update check unavailable (${status.reason}); continuing`));
    return;
  }

  console.log(amber(`Codex CLI update available: ${status.installed} -> ${status.latest}`));
  console.log(dim(`command: ${codexUpdateCommand()}`));
  if (await askYesNo("Update Codex CLI now?")) await installCodexUpdate();
}

async function installCodexUpdate(): Promise<void> {
  const result = await withSpinner("updating Codex", updateCodex);
  if (result.ok) {
    const status = await checkCodexVersion();
    const version = status.kind === "current" || status.kind === "outdated" ? ` ${status.installed}` : "";
    console.log(amber(`Codex CLI${version} is ready.`));
    return;
  }

  console.log(error("Codex CLI update failed."));
  if (result.output) console.log(error(result.output));
  console.log(dim(`Try manually: ${codexUpdateCommand()}`));
}

main().catch((err) => {
  console.error(error(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});

function isDisplayOnlyRead(prompt: string): boolean {
  return /\b(display|show|print|cat|read)\b/i.test(prompt) && /\b(contents?|file)\b/i.test(prompt);
}

function toEditPrompt(line: string): string | undefined {
  const match = line.match(/^\/edit\s+(\S+)\s+(.+)$/);
  if (!match) return undefined;
  const [, path, instruction] = match;
  return `Edit ${path}. ${instruction}`;
}

function parseReasoningOption(value: string): string {
  try {
    return normalizeReasoningEffort(value);
  } catch (err) {
    throw new InvalidArgumentError(err instanceof Error ? err.message : String(err));
  }
}

async function withSpinner<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!output.isTTY) return task();

  const frames = ["-", "\\", "|", "/"];
  let index = 0;
  output.write(dim(`${label} ${frames[index]}`));
  const timer = setInterval(() => {
    index = (index + 1) % frames.length;
    output.write(`\r${dim(`${label} ${frames[index]}`)}`);
  }, 120);

  try {
    return await task();
  } finally {
    clearInterval(timer);
    output.write("\r\x1b[K");
  }
}
