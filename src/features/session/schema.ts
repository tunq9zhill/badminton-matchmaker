import type { Match, Player, Session, Team, Court } from "../../app/types";

export const COL = {
  sessions: "sessions",
  players: "players",
  teams: "teams",
  courts: "courts",
  matches: "matches",
  results: "results",
} as const;

export type ResultRow = {
  id: string;
  endedAt: number;
  courtId: string;
  teamAId: string;
  teamBId: string;
  winnerTeamId?: string;
  isFallback?: boolean;
  scoreA?: number | null;
  scoreB?: number | null;
};
