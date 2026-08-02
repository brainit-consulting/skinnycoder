import type { ActiveSkill, AgentAction, Change } from "./types.js";

export class Session {
  private turns: Array<{ user: string; action: AgentAction; result: string }> = [];
  private changeSets: Change[][] = [];
  private scope: string[] = [];
  private activeSkill: ActiveSkill | undefined;

  constructor(public readonly cwd: string) {}

  addTurn(user: string, action: AgentAction, result: string) {
    this.turns.push({ user, action, result });
    if (this.turns.length > 8) this.turns.shift();
  }

  addChange(change: Change) {
    this.changeSets.push([change]);
  }

  addChangeSet(changes: Change[]) {
    if (changes.length > 0) this.changeSets.push([...changes]);
  }

  popChangeSet(): Change[] | undefined {
    return this.changeSets.pop();
  }

  listChanges(): Change[] {
    return this.changeSets.flatMap((changes) => changes);
  }

  setScope(paths: string[]) {
    this.scope = [...paths];
  }

  listScope(): string[] {
    return [...this.scope];
  }

  setActiveSkill(skill: ActiveSkill | undefined) {
    this.activeSkill = skill;
  }

  getActiveSkill(): ActiveSkill | undefined {
    return this.activeSkill ? { ...this.activeSkill } : undefined;
  }

  updateActiveSkillState(state: string) {
    if (!this.activeSkill) return;
    this.activeSkill.state = state.slice(0, 3000);
  }

  updateActiveSkillCheckpoint(action: AgentAction, result: string) {
    if (!this.activeSkill) return;
    const target = "path" in action
      ? action.path ?? "."
      : "command" in action
        ? action.command.slice(0, 160)
        : action.type;
    const outcome = action.type === "read_file" || action.type === "list_files"
      ? "completed"
      : result.split(/\r?\n/, 1)[0]?.slice(0, 200) || "completed";
    this.activeSkill.checkpoint = `${action.type} ${target}: ${outcome}`;
  }

  clear() {
    this.turns = [];
  }

  contextStats() {
    const recent = this.turns.slice(-4);
    const userChars = recent.reduce((total, turn) => total + turn.user.length, 0);
    const actionChars = recent.reduce((total, turn) => total + JSON.stringify(actionForContext(turn.action)).length, 0);
    const resultChars = recent.reduce((total, turn) => total + Math.min(turn.result.length, 1200), 0);
    const cwdChars = this.cwd.length;
    const scopeChars = this.scope.join(",").length;
    const skillStateChars = this.activeSkill?.state?.length ?? 0;
    const skillCheckpointChars = this.activeSkill?.checkpoint?.length ?? 0;
    const totalChars = cwdChars + scopeChars + skillStateChars + skillCheckpointChars + userChars + actionChars + resultChars;

    return {
      retainedTurns: this.turns.length,
      modelTurns: recent.length,
      cwdChars,
      scopeChars,
      skillStateChars,
      skillCheckpointChars,
      userChars,
      actionChars,
      resultChars,
      totalChars,
      estimatedTokens: estimateTokens(totalChars)
    };
  }

  contextForModel(): string {
    const recent = this.turns.slice(-4).map((turn) => ({
      user: turn.user,
      action: actionForContext(turn.action),
      result: turn.result.slice(0, 1200)
    }));
    return JSON.stringify({ cwd: this.cwd, scope: this.scope, recent }, null, 2);
  }
}

function actionForContext(action: AgentAction): object {
  if (action.type === "skill_progress") {
    return { type: action.type, message: action.message, requiresInput: action.requiresInput };
  }
  if (action.type === "create_file" || action.type === "append_file") {
    return { type: action.type, path: action.path, contentLength: action.content.length };
  }
  if (action.type === "replace_in_file") {
    return { type: action.type, path: action.path, oldLength: action.oldText.length, newLength: action.newText.length };
  }
  if (action.type === "patch_files") {
    return {
      type: action.type,
      changes: action.changes.map((change) => ({ type: change.type, path: change.path }))
    };
  }
  if ("state" in action) {
    const { state: _state, ...withoutState } = action;
    return withoutState;
  }
  return action;
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
