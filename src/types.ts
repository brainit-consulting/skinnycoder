export type AgentAction =
  | { type: "answer"; message: string }
  | { type: "skill_progress"; message: string; state: string }
  | { type: "complete_skill"; message: string }
  | { type: "read_file"; path: string; startLine?: number; lineCount?: number }
  | { type: "list_files"; path?: string }
  | { type: "create_file"; path: string; content: string }
  | { type: "replace_in_file"; path: string; oldText: string; newText: string }
  | { type: "append_file"; path: string; content: string }
  | { type: "run_command"; command: string };

export type Change = {
  path: string;
  before: string | null;
  after: string;
};

export type ActiveSkill = {
  name: string;
  path: string;
  source: string;
  state?: string;
};
