type SkillStateCarrier = { state?: string };

export type FileMutation =
  | { type: "create_file"; path: string; content: string }
  | { type: "replace_in_file"; path: string; oldText: string; newText: string }
  | { type: "append_file"; path: string; content: string };

export type AgentAction =
  | { type: "answer"; message: string }
  | { type: "skill_progress"; message: string; state: string; requiresInput?: boolean }
  | { type: "complete_skill"; message: string }
  | ({ type: "read_file"; path: string; startLine?: number; lineCount?: number } & SkillStateCarrier)
  | ({ type: "list_files"; path?: string } & SkillStateCarrier)
  | ({ type: "create_file"; path: string; content: string } & SkillStateCarrier)
  | ({ type: "replace_in_file"; path: string; oldText: string; newText: string } & SkillStateCarrier)
  | ({ type: "append_file"; path: string; content: string } & SkillStateCarrier)
  | ({ type: "patch_files"; changes: FileMutation[] } & SkillStateCarrier)
  | ({ type: "run_command"; command: string } & SkillStateCarrier);

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
  checkpoint?: string;
};
