import { unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Interface } from "node:readline/promises";
import type { CodexProvider } from "./codexProvider.js";
import type { Session } from "./session.js";
import { listFiles, readCapped, safePath } from "./tools.js";
import { amber, dim, ok } from "./theme.js";

const execFileAsync = promisify(execFile);

type SlashContext = {
  cwd: string;
  session: Session;
  provider: CodexProvider;
  rl: Interface;
};

export async function handleSlash(line: string, ctx: SlashContext): Promise<boolean> {
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd) {
    case "/help":
      console.log(amber("/help /login /model [name] /status /context /files [path] /read <file> /edit <file> <instruction> /diff /changes /undo /clear /exit"));
      return true;
    case "/login":
      console.log(await ctx.provider.login());
      return true;
    case "/model":
      if (arg) ctx.provider.setModel(arg);
      console.log(dim(`model: ${ctx.provider.getModel()}`));
      return true;
    case "/status":
      console.log(dim(`cwd: ${ctx.cwd}\nmodel: ${ctx.provider.getModel()}\nchanges: ${ctx.session.listChanges().length}`));
      return true;
    case "/context":
      console.log(formatContext(ctx));
      return true;
    case "/files":
      console.log(await listFiles(ctx.cwd, arg || "."));
      return true;
    case "/read":
      console.log(await readCapped(ctx.cwd, arg));
      return true;
    case "/diff":
      console.log(await gitDiff(ctx.cwd));
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
    `  retained turns: ${stats.retainedTurns} (${stats.modelTurns} sent to Codex)`,
    `  cwd: ${stats.cwdChars} chars`,
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

async function gitDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--", "."], { cwd });
    return stdout || dim("no git diff");
  } catch {
    return dim("not a git repository");
  }
}
