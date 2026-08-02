import type { ActiveSkill, AgentAction } from "./types.js";

export function actionSkillState(action: AgentAction): string | undefined {
  return "state" in action && typeof action.state === "string" ? action.state : undefined;
}

export function skillProgressNeedsInput(action: Extract<AgentAction, { type: "skill_progress" }>): boolean {
  return action.requiresInput !== false;
}

export function skillContinuationPrompt(skill: ActiveSkill): string {
  return [
    `Resume the active ${skill.name} workflow from its stored state.`,
    "Do not repeat confirmed questions, decisions, or approvals.",
    "Continue with the pending phase and return the next single JSON action."
  ].join(" ");
}
