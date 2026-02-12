export type Phase = "coverage" | "bracket";

export type Session = {
  id: string;
  createdAt: number;
  hostUid: string;
  hostSecretHash: string;

  phase: Phase;
  config: {
    courtCount: number;
    scoring: 21;
    oddMode: "three_player_rotation";
  };

  activeTeams: string[];
  queueTeams: string[];

  teammateHistory: Record<string, true>; // playerPairKey -> true
  metHistory: Record<string, true>;      // teamPairKey -> true

  startedAt?: number;
  locked?: boolean; // disables editing after START
};

export type Player = {
  id: string;
  name: string;
  stats: { played: number; wins: number; losses: number };
  playHistory?: number[]; // เก็บ timestamp (endedAt) ทุกครั้งที่ได้เล่น
  avatarDataUrl?: string; // optional profile image (compressed data URL)
};

export type Team = {
  id: string;
  playerIds: string[]; // length 2 or 3 (odd mode)
  stats: { played: number; wins: number; losses: number };
  isActive: boolean;
  rotationIndex?: number; // only used if playerIds.length === 3
  pairPreference?: string[];     // [p1,p2] คู่ที่ต้องลงครั้งถัดไป
  pendingOddChoice?: boolean;    // true = ต้องให้ host เลือกให้คนที่ 3 คู่กับใคร
  archived?: boolean; // ✅ เพิ่ม
};

export type Court = {
  id: string;
  currentMatchId?: string | null;
};

export type MatchStatus = "scheduled" | "in_progress" | "finished" | "canceled";

export type Match = {
  id: string;
  courtId: string;
  teamAId: string;
  teamBId: string;
  status: MatchStatus;
  isFallback?: boolean;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  winnerTeamId?: string;
  // For 3-player team rotation: host records which 2 actually played.
  teamAPlayedPlayerIds?: string[];
  teamBPlayedPlayerIds?: string[];
  scoreA?: number;
  scoreB?: number;
};
