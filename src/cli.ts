#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { runShell } from "./shell.js";
import { Session } from "./session.js";
import { amber, animatedLogo, dim, error, promptText, startupInfo, staticLogo } from "./theme.js";
import { CodexProvider } from "./codexProvider.js";
import { handleSlash } from "./slash.js";
import { applyAction } from "./tools.js";

const program = new Command()
  .name("skinnycoder")
  .description("Lean amber-terminal coding CLI")
  .option("-C, --cwd <dir>", "working directory", process.cwd())
  .option("-m, --model <model>", "Codex model")
  .option("--logo", "show startup logo", true)
  .option("--no-logo", "skip startup logo")
  .parse(process.argv);

const opts = program.opts<{ cwd: string; model?: string; logo: boolean }>();
const cwd = resolve(opts.cwd);
const session = new Session(cwd);
const provider = new CodexProvider(cwd, opts.model);
const rl = createInterface({ input, output });

async function askYesNo(question: string): Promise<boolean> {
  const answer = (await rl.question(amber(`${question} [y/N] `))).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function main() {
  if (opts.logo) await animatedLogo(output);
  else console.log(staticLogo());
  console.log(startupInfo(cwd));

  while (true) {
    let line: string;
    try {
      line = (await rl.question(promptText("> "))).trim();
    } catch {
      break;
    }
    if (!line) continue;

    if (line.startsWith("/")) {
      const keepGoing = await handleSlash(line, { cwd, session, provider, rl });
      if (!keepGoing) break;
      continue;
    }

    try {
      let nextPrompt = line;
      for (let step = 0; step < 6; step++) {
        const action = await provider.nextAction(nextPrompt, session.contextForModel());
        if (action.type === "answer") {
          console.log(amber(action.message));
          session.addTurn(nextPrompt, action, action.message);
          break;
        }

        if (action.type === "read_file" || action.type === "list_files") {
          const result = await applyAction(action, { cwd, session, dryRun: false });
          console.log(result);
          session.addTurn(nextPrompt, action, result);
          nextPrompt = "Continue using the tool result. Return the next single JSON action.";
          continue;
        }

        const preview = await applyAction(action, { cwd, session, dryRun: true });
        console.log(preview);
        const approved = await askYesNo(`Approve ${action.type}?`);
        if (!approved) {
          console.log(dim("skipped"));
          session.addTurn(nextPrompt, { type: "answer", message: "User rejected action." }, "rejected");
          break;
        }

        const result = action.type === "run_command"
          ? await runShell(action.command, cwd)
          : await applyAction(action, { cwd, session, dryRun: false });
        console.log(result);
        session.addTurn(nextPrompt, action, result);
        nextPrompt = "Continue after the approved action. Return answer if done, otherwise the next single JSON action.";
      }
    } catch (err) {
      console.log(error(err instanceof Error ? err.message : String(err)));
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(error(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
