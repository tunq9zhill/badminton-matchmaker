import { useEffect, useMemo, useState } from "react";
import { ensureAnonAuth } from "../app/firebase";
import { useFirestoreConnectionPing } from "../app/connection";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { subscribeSession, subscribePlayers, subscribeTeams, subscribeCourts, subscribeMatches, subscribeRecentResults } from "../features/session/api";
import type { Match, Player, Session, Team, Court } from "../app/types";
import type { ResultRow } from "../features/session/schema";

type SortMode = "wins" | "losses" | "played";

export function Viewer(props: { sessionId: string }) {
  const sid = props.sessionId.toUpperCase();
  const conn = useFirestoreConnectionPing();
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("wins");

  useEffect(() => { ensureAnonAuth().catch(()=>{}); }, []);
  useEffect(() => subscribeSession(sid, setSession), [sid]);
  useEffect(() => subscribePlayers(sid, setPlayers), [sid]);
  useEffect(() => subscribeTeams(sid, setTeams), [sid]);
  useEffect(() => subscribeCourts(sid, setCourts), [sid]);
  useEffect(() => subscribeMatches(sid, setMatches), [sid]);
  useEffect(() => subscribeRecentResults(sid, setResults), [sid]);

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const matchById = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const sortedPlayers = useMemo(() => [...players].sort((a,b)=>b.stats[sortMode]-a.stats[sortMode]), [players, sortMode]);

  return (
    <div className="mx-auto max-w-md p-4 space-y-3">
      <button className="text-xs font-semibold text-slate-700" onClick={() => { history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); }}>ย้อนกลับ</button>
      <div className="flex items-center justify-between pt-2">
        <div><div className="text-xl font-bold">Viewer</div><div className="text-xs">Session: <span className="font-mono">{sid}</span></div></div>
        <div className="space-y-1 text-right"><Chip tone="warn">Read-only</Chip><Chip tone={conn==="ok"?"good":"warn"}>{conn}</Chip></div>
      </div>

      <Card><CardHeader title="Share Session" /><CardBody><div className="text-3xl font-black tracking-[0.35em] text-center">{sid}</div></CardBody></Card>

      <Card><CardHeader title="Courts" /><CardBody className="space-y-2">{courts.map((c)=>{
        const m=c.currentMatchId?matchById.get(c.currentMatchId):undefined;
        const a=m?teamById.get(m.teamAId):undefined; const b=m?teamById.get(m.teamBId):undefined;
        return <div key={c.id} className="rounded-xl border p-2"><div>Court {c.id}</div>{m?<><div>{fmtTeam(a,playerById)}</div><div className="text-center">vs</div><div>{fmtTeam(b,playerById)}</div></>:<div className="text-xs text-slate-500">idle</div>}</div>;
      })}</CardBody></Card>

      <Card><CardHeader title="Queue" /><CardBody>{(session?.queueTeams ?? []).map((tid) => <div key={tid} className="text-sm">{fmtTeam(teamById.get(tid), playerById)}</div>)}</CardBody></Card>

      <Card><CardHeader title="Recent Results" /><CardBody className="space-y-2">{results.map((r)=><div key={r.id} className="rounded-xl border px-3 py-2 text-sm"><div className="text-xs">Court {r.courtId}</div><ResultLine ids={r.teamAPlayedPlayerIds ?? teamById.get(r.teamAId)?.playerIds ?? []} p={playerById} win={r.winnerTeamId===r.teamAId} score={r.scoreA} /><div className="text-center">vs</div><ResultLine ids={r.teamBPlayedPlayerIds ?? teamById.get(r.teamBId)?.playerIds ?? []} p={playerById} win={r.winnerTeamId===r.teamBId} score={r.scoreB} /></div>)}</CardBody></Card>

      <Card><CardHeader title="Player Table" right={<div className="flex gap-1 text-xs">{(["wins","losses","played"] as SortMode[]).map((m) => <button key={m} className="underline" onClick={() => setSortMode(m)}>{m}</button>)}</div>} /><CardBody>{sortedPlayers.map((p)=><div key={p.id} className="grid grid-cols-4 text-sm"><span>{p.name}</span><span>W {p.stats.wins}</span><span>L {p.stats.losses}</span><span>P {p.stats.played}</span></div>)}</CardBody></Card>
    </div>
  );
}

function fmtTeam(team: Team | undefined, playerById: Map<string, Player>) {
  if (!team) return "-";
  return team.playerIds.map((id) => playerById.get(id)?.name ?? "?").join(" + ");
}

function ResultLine(props: { ids: string[]; p: Map<string, Player>; win: boolean; score?: number | null }) {
  return <div className={`inline-flex gap-2 rounded-full px-2 py-1 ${props.win ? "border-2 border-emerald-500" : "border border-slate-200"}`}><span>{props.ids.map((id) => props.p.get(id)?.name ?? "?").join(" + ")}</span><span className="font-bold">{props.score ?? "-"}</span></div>;
}
