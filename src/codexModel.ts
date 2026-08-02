import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";

export type CodexModelConfig = {
  model?: string;
  reasoningEffort?: string;
  modelSource: string;
  reasoningSource: string;
};

export function readCodexModelConfig(cwd: string): CodexModelConfig {
  let selected: CodexModelConfig = {
    modelSource: "Codex recommended default",
    reasoningSource: "Codex recommended default"
  };
  const codexDir = process.env.CODEX_HOME || join(homedir(), ".codex");
  selected = applyConfig(join(codexDir, "config.toml"), "Codex user config", selected);

  for (const directory of ancestorDirectories(cwd)) {
    selected = applyConfig(
      join(directory, ".codex", "config.toml"),
      `project config (${join(directory, ".codex", "config.toml")})`,
      selected
    );
  }

  return selected;
}

function applyConfig(path: string, source: string, current: CodexModelConfig): CodexModelConfig {
  if (!existsSync(path)) return current;
  try {
    const values = readTopLevelModelValues(readFileSync(path, "utf8"));
    if (!values.model && !values.reasoningEffort) return current;
    return {
      model: values.model ?? current.model,
      reasoningEffort: values.reasoningEffort ?? current.reasoningEffort,
      modelSource: values.model ? source : current.modelSource,
      reasoningSource: values.reasoningEffort ? source : current.reasoningSource
    };
  } catch {
    return current;
  }
}

function readTopLevelModelValues(toml: string): { model?: string; reasoningEffort?: string } {
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) break;
    model ??= readTomlString(line, "model");
    reasoningEffort ??= readTomlString(line, "model_reasoning_effort");
  }
  return { model, reasoningEffort };
}

function readTomlString(line: string, key: string): string | undefined {
  const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(["'])(.*?)\\1\\s*(?:#.*)?$`));
  return match?.[2];
}

function ancestorDirectories(cwd: string): string[] {
  const directories: string[] = [];
  let current = resolve(cwd);
  const root = parse(current).root;
  while (true) {
    directories.unshift(current);
    if (current === root) return directories;
    current = dirname(current);
  }
}
