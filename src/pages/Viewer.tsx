import { useEffect, useMemo, useState } from "react";
import { ensureAnonAuth } from "../app/firebase";
import { useFirestoreConnectionPing } from "../app/connection";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Modal } from "../ui/Modal";
import {
  subscribeSession, subscribePlayers, subscribeTeams, subscribeCourts, subscribeMatches, subscribeRecentResults
} from "../features/session/api";
import type { Match, Player, Session, Team, Court } from "../app/types";
import type { ResultRow } from "../features/session/schema";

export function Viewer(props: { sessionId: string }) {
  const conn = useFirestoreConnectionPing();

  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ name: string; url: string } | null>(null);

  useEffect(() => { ensureAnonAuth().catch(()=>{}); }, []);
  useEffect(() => subscribeSession(props.sessionId, setSession), [props.sessionId]);
  useEffect(() => subscribePlayers(props.sessionId, setPlayers), [props.sessionId]);
  useEffect(() => subscribeTeams(props.sessionId, setTeams), [props.sessionId]);
  useEffect(() => subscribeCourts(props.sessionId, setCourts), [props.sessionId]);
  useEffect(() => subscribeMatches(props.sessionId, setMatches), [props.sessionId]);
  useEffect(() => subscribeRecentResults(props.sessionId, setResults), [props.sessionId]);

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const matchById = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);

  const leaderboard = useMemo(() => {
    const rows = [...teams].sort((a, b) => (b.stats.wins - b.stats.losses) - (a.stats.wins - a.stats.losses));
    return rows.slice(0, 12);
  }, [teams]);

  return (
    <div className="mx-auto max-w-md p-4 space-y-3">
      <div className="flex items-center justify-between pt-2">
        <div>
          <div className="text-xl font-bold">Live Viewer</div>
          <div className="text-xs text-slate-500">Session: <span className="font-mono">{props.sessionId}</span></div>
        </div>
        <div className="text-right space-y-1">
          <Chip tone="warn">Read-only</Chip>
          <Chip tone={conn === "ok" ? "good" : conn === "offline" ? "warn" : "muted"}>
            {conn === "ok" ? "Connected" : conn === "offline" ? "Offline" : "Connecting"}
          </Chip>
        </div>
      </div>

      <Card>
        <CardHeader title="Players (from Host)" />
        <CardBody className="space-y-2">
          {players.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-100 px-3 py-2 text-sm">
              <div className="flex items-center gap-3">
                {p.avatarDataUrl ? (
                  <button
                    type="button"
                    className="h-10 w-10 overflow-hidden rounded-full border border-slate-200"
                    onClick={() => setSelectedImage({ name: p.name, url: p.avatarDataUrl! })}
                    title={`Open ${p.name} profile`}
                  >
                    <img src={p.avatarDataUrl} alt={`avatar-${p.name}`} className="h-full w-full object-cover" />
                  </button>
                ) : (
                  <div className="h-10 w-10 rounded-full border border-dashed border-slate-300 bg-slate-50" />
                )}
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-slate-500">W {p.stats.wins} · L {p.stats.losses} · played {p.stats.played}</div>
                </div>
              </div>
            </div>
          ))}
          {players.length === 0 && <div className="text-sm text-slate-500">No players yet.</div>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Courts" />
        <CardBody className="space-y-3">
          {courts.map((c) => {
            const m = c.currentMatchId ? matchById.get(c.currentMatchId) : undefined;
            const a = m ? teamById.get(m.teamAId) : undefined;
            const b = m ? teamById.get(m.teamBId) : undefined;
            return (
              <div key={c.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Court {c.id}</div>
                  <Chip tone={m?.status === "in_progress" ? "good" : m ? "muted" : "warn"}>
                    {m ? m.status : "idle"}
                  </Chip>
                </div>
                {m ? (
                  <div className="mt-2 text-sm font-semibold space-y-2">
                    <TeamLine team={a} playerById={playerById} onOpenImage={(name, url) => setSelectedImage({ name, url })} />
                    <div className="text-slate-400 text-center">vs</div>
                    <TeamLine team={b} playerById={playerById} onOpenImage={(name, url) => setSelectedImage({ name, url })} />
                    {m.isFallback ? <span className="text-xs text-amber-700">(fallback)</span> : null}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-500">Waiting for a valid match…</div>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Queue" />
        <CardBody className="space-y-2">
          {(session?.queueTeams ?? []).map((tid) => {
            const t = teamById.get(tid);
            return (
              <div key={tid} className="rounded-xl border border-slate-100 px-3 py-2">
                <TeamLine team={t} playerById={playerById} onOpenImage={(name, url) => setSelectedImage({ name, url })} />
                <div className="text-xs text-slate-500">played {t?.stats.played ?? 0}</div>
              </div>
            );
          })}
          {(session?.queueTeams ?? []).length === 0 && <div className="text-sm text-slate-500">Queue empty.</div>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Leaderboard" />
        <CardBody className="space-y-2">
          {leaderboard.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-100 px-3 py-2 text-sm">
              <TeamLine team={t} playerById={playerById} onOpenImage={(name, url) => setSelectedImage({ name, url })} />
              <div className="text-xs text-slate-500">W {t.stats.wins} · L {t.stats.losses} · played {t.stats.played}</div>
            </div>
          ))}
          {leaderboard.length === 0 && <div className="text-sm text-slate-500">No teams yet.</div>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent Results" />
        <CardBody className="space-y-2">
          {results.map((r) => {
            const ta = teamById.get(r.teamAId);
            const tb = teamById.get(r.teamBId);
            const win = r.winnerTeamId;
            return (
              <div key={r.id} className="rounded-xl border border-slate-100 px-3 py-2 text-sm">
                <div className="text-xs text-slate-500">Court {r.courtId}</div>
                <TeamLine team={ta} playerById={playerById} onOpenImage={(name, url) => setSelectedImage({ name, url })} />
                <div className="text-center text-slate-400">vs</div>
                <TeamLine team={tb} playerById={playerById} onOpenImage={(name, url) => setSelectedImage({ name, url })} />
                <div className="text-xs text-slate-600 mt-1">
                  Winner: {win === r.teamAId ? fmtTeam(ta, playerById) : fmtTeam(tb, playerById)}
                  {r.isFallback ? " · fallback" : ""}
                  <span className="font-semibold"> {winnerLoserScore(r) ? `(${winnerLoserScore(r)})` : ""}</span>
                </div>
              </div>
            );
          })}
          {results.length === 0 && <div className="text-sm text-slate-500">No results yet.</div>}
        </CardBody>
      </Card>

      {selectedImage && (
        <Modal title={selectedImage.name} onClose={() => setSelectedImage(null)}>
          <div className="flex justify-center">
            <img src={selectedImage.url} alt={selectedImage.name} className="max-h-[70vh] w-auto rounded-xl border border-slate-200" />
          </div>
        </Modal>
      )}
    </div>
  );
}

function fmtTeam(team: Team | undefined, playerById: Map<string, Player>) {
  if (!team) return "—";
  return team.playerIds.map((id) => playerById.get(id)?.name ?? "?").join(" + ");
}

function winnerLoserScore(r: ResultRow) {
  if (r.scoreA == null || r.scoreB == null) return "";
  const a = r.scoreA, b = r.scoreB;
  const win = r.winnerTeamId === r.teamAId ? a : b;
  const lose = r.winnerTeamId === r.teamAId ? b : a;
  return `${win}–${lose}`;
}
