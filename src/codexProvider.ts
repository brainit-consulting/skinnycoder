import { spawn } from "node:child_process";
import { z } from "zod";
import type { AgentAction } from "./types.js";

export type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

const ActionSchema: z.ZodType<AgentAction> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answer"), message: z.string() }),
  z.object({ type: z.literal("read_file"), path: z.string() }),
  z.object({ type: z.literal("list_files"), path: z.string().optional() }),
  z.object({ type: z.literal("create_file"), path: z.string(), content: z.string() }),
  z.object({ type: z.literal("replace_in_file"), path: z.string(), oldText: z.string(), newText: z.string() }),
  z.object({ type: z.literal("append_file"), path: z.string(), content: z.string() }),
  z.object({ type: z.literal("run_command"), command: z.string() })
]);

export class CodexProvider {
  private lastUsage: CodexUsage | undefined;

  constructor(private readonly cwd: string, private model?: string) {}

  setModel(model: string | undefined) {
    this.model = model;
  }

  getModel() {
    return this.model ?? "codex default";
  }

  getLastUsage() {
    return this.lastUsage;
  }

  async login(): Promise<string> {
    return run("codex", ["login"], this.cwd, "");
  }

  async nextAction(userPrompt: string, context: string): Promise<AgentAction> {
    const prompt = [
      "Skinnycoder planner. Return one JSON object only.",
      "Actions: answer{message}, read_file{path}, list_files{path?}, create_file{path,content}, replace_in_file{path,oldText,newText}, append_file{path,content}, run_command{command}.",
      'Example: {"type":"answer","message":"done"}',
      "Use file actions for edits. Read/list before editing unknown code.",
      `Ctx:${context}`,
      `User:${userPrompt}`
    ].join("\n");

    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "--color",
      "never"
    ];
    if (this.model) args.push("--model", this.model);
    args.push("-");

    const stdout = await run("codex", args, this.cwd, prompt);
    const result = extractJsonFromCodex(stdout);
    this.lastUsage = result.usage;
    const json = result.json;
    return ActionSchema.parse(JSON.parse(json));
  }
}

function extractJsonFromCodex(text: string): { json: string; usage?: CodexUsage } {
  let latestAgentText = "";
  let usage: CodexUsage | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string }; usage?: CodexUsage };
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        latestAgentText = event.item.text;
      }
      if (event.type === "turn.completed" && event.usage) usage = event.usage;
    } catch {
      // Ignore non-event JSON-looking warning lines.
    }
  }
  if (!latestAgentText) throw new Error(`Codex returned no agent message: ${text.slice(0, 500)}`);
  return { json: extractJson(latestAgentText), usage };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error(`Codex did not return JSON: ${trimmed.slice(0, 500)}`);
}

function run(command: string, args: string[], cwd: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `${command} exited with ${code}`));
    });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}
