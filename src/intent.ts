export type PlannerIntent =
  | { kind: "general" }
  | { kind: "edit"; path: string; targetExists: boolean };

export type EditCommand = {
  path: string;
  instruction: string;
};

export function parseEditCommand(line: string): EditCommand | undefined {
  const match = line.match(/^\/edit\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+([\s\S]+)$/);
  if (!match) return undefined;
  const path = match[1] ?? match[2] ?? match[3];
  const instruction = match[4].trim();
  if (!path || !instruction) return undefined;
  return { path, instruction };
}

export function plannerIntentInstructions(intent: PlannerIntent): string[] {
  if (intent.kind === "general") return [];
  return [
    `Explicit request intent: edit ${JSON.stringify(intent.path)}.`,
    intent.targetExists
      ? "The target exists. Read it if needed, then propose a file edit; do not stop after reading it."
      : "The target does not exist. Use create_file for that path instead of trying to read it.",
    "Do not return answer until the requested edit is complete or no change is needed; explain the latter explicitly."
  ];
}
