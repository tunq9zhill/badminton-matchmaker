import type { Phase, Team } from "../app/types";

export function nextPhase(current: Phase, teams: Team[]): Phase {
  if (current === "coverage") {
    const allPlayed = teams.every((t) => t.stats.played >= 1);
    if (allPlayed) return "bracket";
  }
  return current;
}
