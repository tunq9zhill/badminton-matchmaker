import { useEffect, useMemo, useState } from "react";
import { ensureAnonAuth } from "../app/firebase";
import { useFirestoreConnectionPing } from "../app/connection";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Divider } from "../ui/Divider";
import { nanoid } from "nanoid";
import { useAppStore } from "../app/store";
import { subscribeSession, subscribePlayers, subscribeTeams, subscribeCourts, subscribeMatches, subscribeRecentResults, upsertPlayers, updatePlayerAvatar } from "../features/session/api";
import type { Match, Player, Session, Team, Court } from "../app/types";
import { buildInitialTeams } from "../engine/pairing";
import { setTeamsAndQueue, assignNextForCourt, finishMatch, startOnce, resetScoreTable } from "../features/session/mutations";
import { Modal } from "../ui/Modal";
import type { ResultRow } from "../features/session/schema";

type SortMode = "wins" | "losses" | "played";

export function Host(props: { sessionId: string; secret?: string }) {
  const sid = props.sessionId.toUpperCase();
  const conn = useFirestoreConnectionPing();
  const setToast = useAppStore((s) => s.setToast);
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [showFinish, setShowFinish] = useState<{ match: Match } | null>(null);
  const [winnerTeamId, setWinnerTeamId] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("wins");

  useEffect(() => { ensureAnonAuth().catch(() => {}); }, []);
  useEffect(() => subscribeSession(sid, setSession), [sid]);
  useEffect(() => subscribePlayers(sid, setPlayers), [sid]);
  useEffect(() => subscribeTeams(sid, setTeams), [sid]);
  useEffect(() => subscribeCourts(sid, setCourts), [sid]);
  useEffect(() => subscribeMatches(sid, setMatches), [sid]);
  useEffect(() => subscribeRecentResults(sid, setResults), [sid]);

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const matchById = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const isLocked = !!session?.locked;

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => b.stats[sortMode] - a.stats[sortMode]);
  }, [players, sortMode]);

  const dotsFilled = players.length % 2 === 0;

  return <div className="mx-auto max-w-md p-4 space-y-3">
    <button className="text-xs font-semibold text-slate-700" onClick={() => { history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); }}>ย้อนกลับ</button>
    <div className="flex items-center justify-between pt-2">
      <div>
        <div className="text-xl font-bold">Host</div>
        <div className="text-xs text-slate-500">Session: <span className="font-mono tracking-wider">{sid}</span></div>
      </div>
      <Chip tone={conn === "ok" ? "good" : "warn"}>{conn === "ok" ? "Connected" : "Offline"}</Chip>
    </div>

    <Card>
      <CardHeader title="Share Session" />
      <CardBody>
        <div className="text-3xl font-black tracking-[0.35em] text-center">{sid}</div>
      </CardBody>
    </Card>

    <Card>
      <CardHeader title="Players" right={<div className="flex gap-1">{players.map((_, i) => <span key={i} className={`h-2.5 w-2.5 rounded-full ${dotsFilled ? "bg-slate-900" : "border border-slate-500"}`} />)}</div>} />
      <CardBody className="space-y-2">
        {!isLocked && <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const names = Array.from(new Set(playerName.trim().split(/\s+/).filter(Boolean)));
          if (!names.length) return;
          await upsertPlayers(sid, names);
          setPlayerName("");
        }}>
          <Input value={playerName} onChange={setPlayerName} placeholder="พิมพ์ชื่อเว้นวรรคได้" />
          <Button>เพิ่ม</Button>
        </form>}
        {players.map((p) => <div key={p.id} className="rounded-xl border border-slate-100 px-3 py-2 text-sm flex items-center justify-between">
          <span>{p.name}</span>
          <label className="text-xs text-slate-500 cursor-pointer">รูป
            <input type="file" className="hidden" accept="image/*" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = async () => updatePlayerAvatar(sid, p.id, String(reader.result ?? ""));
              reader.readAsDataURL(f);
            }} />
          </label>
        </div>)}
        <Divider />
        <Button disabled={!session || players.length < 4 || teams.length > 0} onClick={async () => {
          await startOnce(sid);
          const { teams: newTeams } = buildInitialTeams(session!, players);
          await setTeamsAndQueue(sid, newTeams);
          for (const c of courts) await assignNextForCourt(sid, c.id);
        }}>START</Button>
      </CardBody>
    </Card>

    <Card><CardHeader title="Courts" /><CardBody className="space-y-3">{courts.map((c) => {
      const m = c.currentMatchId ? matchById.get(c.currentMatchId) : undefined;
      const a = m ? teamById.get(m.teamAId) : undefined;
      const b = m ? teamById.get(m.teamBId) : undefined;
      return <div key={c.id} className="rounded-xl border p-3 space-y-2"><div className="font-semibold">Court {c.id}</div>{m ? <>
        <TeamLine team={a} playerById={playerById} /><div className="text-center text-slate-400">vs</div><TeamLine team={b} playerById={playerById} />
        <Button onClick={() => { setWinnerTeamId(m.teamAId); setShowFinish({ match: m }); }}>Finish</Button>
      </> : <Button variant="secondary" onClick={() => assignNextForCourt(sid, c.id)}>Assign</Button>}</div>;
    })}</CardBody></Card>

    <Card>
      <CardHeader title="Recent Results" />
      <CardBody className="space-y-2">{results.map((r) => {
        const ta = teamById.get(r.teamAId); const tb = teamById.get(r.teamBId);
        return <div key={r.id} className="rounded-xl border px-3 py-2 text-sm">
          <div className="text-xs text-slate-500">Court {r.courtId}</div>
          <ResultTeamLine ids={r.teamAPlayedPlayerIds ?? ta?.playerIds ?? []} playerById={playerById} highlight={r.winnerTeamId===r.teamAId} score={r.scoreA} />
          <div className="text-center text-slate-400">vs</div>
          <ResultTeamLine ids={r.teamBPlayedPlayerIds ?? tb?.playerIds ?? []} playerById={playerById} highlight={r.winnerTeamId===r.teamBId} score={r.scoreB} />
        </div>;
      })}</CardBody>
    </Card>

    <Card>
      <CardHeader title="Player Table" right={<div className="flex gap-1 text-xs">{(["wins","losses","played"] as SortMode[]).map((m) => <button key={m} className="underline" onClick={() => setSortMode(m)}>{m}</button>)}</div>} />
      <CardBody className="space-y-1">{sortedPlayers.map((p) => <div key={p.id} className="grid grid-cols-4 text-sm"><span>{p.name}</span><span>W {p.stats.wins}</span><span>L {p.stats.losses}</span><span>P {p.stats.played}</span></div>)}</CardBody>
    </Card>

    <Card>
      <CardHeader title="Reset" />
      <CardBody className="space-y-2">
        <Button variant="secondary" onClick={async ()=>{ const { resetPairing } = await import("../features/session/mutations"); await resetPairing(sid); }}>Reset Pairing</Button>
        <Button variant="secondary" onClick={async ()=>{ await resetScoreTable(sid); setToast({ id: nanoid(), kind: "success", message: "Reset table แล้ว" }); }}>Reset table</Button>
        <Button variant="danger" onClick={async ()=>{ const { resetAll } = await import("../features/session/mutations"); await resetAll(sid, true); }}>Reset All</Button>
      </CardBody>
    </Card>

    {showFinish && <FinishModal match={showFinish.match} teamA={teamById.get(showFinish.match.teamAId)!} teamB={teamById.get(showFinish.match.teamBId)!} playerById={playerById} winnerTeamId={winnerTeamId} setWinnerTeamId={setWinnerTeamId} onClose={()=>setShowFinish(null)} onConfirm={async (played)=>{ await finishMatch(sid, showFinish.match.id, winnerTeamId, played); await assignNextForCourt(sid, showFinish.match.courtId); setShowFinish(null);} } />}
  </div>;
}

function TeamLine(props: { team: Team | undefined; playerById: Map<string, Player> }) {
  if (!props.team) return <div>—</div>;
  return <div className="font-semibold">{props.team.playerIds.map((id) => props.playerById.get(id)?.name ?? "?").join(" + ")}</div>;
}

function ResultTeamLine(props: { ids: string[]; playerById: Map<string, Player>; highlight: boolean; score?: number | null }) {
  return <div className={`inline-flex items-center gap-2 rounded-full px-2 py-1 ${props.highlight ? "border-2 border-emerald-500" : "border border-slate-200"}`}>
    <span>{props.ids.map((id) => props.playerById.get(id)?.name ?? "?").join(" + ")}</span>
    <span className="font-bold">{props.score ?? "-"}</span>
  </div>;
}

function FinishModal(props: {
  match: Match;
  teamA: Team;
  teamB: Team;
  playerById: Map<string, Player>;
  winnerTeamId: string;
  setWinnerTeamId: (v: string) => void;
  onClose: () => void;
  onConfirm: (payload: { teamAPlayedPlayerIds?: string[]; teamBPlayedPlayerIds?: string[]; scoreA?: number; scoreB?: number }) => Promise<void> | void;
}) {
  const [winScore, setWinScore] = useState("");
  const [loseScore, setLoseScore] = useState("");
  const [aPlayed, setAPlayed] = useState<string[]>([]);
  const [bPlayed, setBPlayed] = useState<string[]>([]);
  const needsA = props.teamA.playerIds.length === 3;
  const needsB = props.teamB.playerIds.length === 3;

  return <Modal title="Finish Match" onClose={props.onClose} actions={<Button onClick={() => props.onConfirm({
    teamAPlayedPlayerIds: needsA ? aPlayed : undefined,
    teamBPlayedPlayerIds: needsB ? bPlayed : undefined,
    scoreA: props.winnerTeamId === props.teamA.id ? Number(winScore) : Number(loseScore),
    scoreB: props.winnerTeamId === props.teamB.id ? Number(winScore) : Number(loseScore),
  })}>ยืนยัน</Button>}>
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => props.setWinnerTeamId(props.teamA.id)}>ทีม A ชนะ</Button>
        <Button variant="secondary" onClick={() => props.setWinnerTeamId(props.teamB.id)}>ทีม B ชนะ</Button>
      </div>
      {needsA && <PickTwo ids={props.teamA.playerIds} picked={aPlayed} setPicked={setAPlayed} playerById={props.playerById} />}
      {needsB && <PickTwo ids={props.teamB.playerIds} picked={bPlayed} setPicked={setBPlayed} playerById={props.playerById} />}
      <Input value={winScore} onChange={setWinScore} placeholder="คะแนนผู้ชนะ" />
      <Input value={loseScore} onChange={setLoseScore} placeholder="คะแนนผู้แพ้" />
    </div>
  </Modal>;
}

function PickTwo(props: { ids: string[]; picked: string[]; setPicked: (v: string[]) => void; playerById: Map<string, Player>; }) {
  return <div className="flex gap-2">{props.ids.map((id) => {
    const on = props.picked.includes(id);
    return <button key={id} className={`rounded-full border px-2 py-1 ${on ? "bg-slate-900 text-white" : ""}`} onClick={() => {
      if (on) props.setPicked(props.picked.filter((x) => x !== id));
      else if (props.picked.length < 2) props.setPicked([...props.picked, id]);
    }}>{props.playerById.get(id)?.name ?? "?"}</button>;
  })}</div>;
}
