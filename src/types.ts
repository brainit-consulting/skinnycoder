export type AgentAction =
  | { type: "answer"; message: string }
  | { type: "read_file"; path: string }
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
