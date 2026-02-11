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
import {
  subscribeSession, subscribePlayers, subscribeTeams, subscribeCourts, subscribeMatches, subscribeRecentResults,
  upsertPlayers, assertHost, updatePlayerAvatar
} from "../features/session/api";
import type { Match, Player, Session, Team, Court } from "../app/types";
import { buildViewerLink } from "../app/links";
import { buildInitialTeams } from "../engine/pairing";
import { setTeamsAndQueue, assignNextForCourt, finishMatch, startOnce } from "../features/session/mutations";
import { Modal } from "../ui/Modal";
import { useI18n } from "../app/i18n";
import type { ResultRow } from "../features/session/schema";

export function Host(props: { sessionId: string; secret?: string }) {
  const [confirmHome, setConfirmHome] = useState(false);
  const conn = useFirestoreConnectionPing();
  const setToast = useAppStore((s) => s.setToast);

  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [results, setResults] = useState<any[]>([]);

  const [playerName, setPlayerName] = useState("");
  const [showFinish, setShowFinish] = useState<{ match: Match } | null>(null);
  const [winnerTeamId, setWinnerTeamId] = useState<string>("");
  const [uploadingPlayerId, setUploadingPlayerId] = useState<string | null>(null);

  const origin = location.origin;
  const viewerLink = buildViewerLink(origin, props.sessionId);
  // const hostLink = buildHostLink(origin, props.sessionId, props.secret ?? "");
  const { lang, setLang } = useI18n();
    <button
    className="text-xs font-semibold text-slate-700"
    onClick={() => setLang(lang === "th" ? "en" : "th")}
    >
    {lang === "th" ? "TH" : "EN"}
    </button>

  useEffect(() => {
    ensureAnonAuth().catch(() => {});
  }, []);

  useEffect(() => subscribeSession(props.sessionId, setSession), [props.sessionId]);
  useEffect(() => subscribePlayers(props.sessionId, setPlayers), [props.sessionId]);
  useEffect(() => subscribeTeams(props.sessionId, setTeams), [props.sessionId]);
  useEffect(() => subscribeCourts(props.sessionId, setCourts), [props.sessionId]);
  useEffect(() => subscribeMatches(props.sessionId, setMatches), [props.sessionId]);
  useEffect(() => subscribeRecentResults(props.sessionId, setResults), [props.sessionId]);

  const matchById = useMemo(() => {
    const m = new Map(matches.map((x) => [x.id, x]));
    return (id?: string | null) => (id ? m.get(id) : undefined);
  }, [matches]);

  const teamById = useMemo(() => {
    const m = new Map(teams.map((t) => [t.id, t]));
    return (id: string) => m.get(id);
  }, [teams]);

  const playerById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p]));
    return (id: string) => m.get(id);
  }, [players]);

  const isLocked = !!session?.locked;

  const canStart = session && players.length >= 4 && teams.length === 0;

  return (
    <div className="mx-auto max-w-md p-4 space-y-3">
        <button
        className="text-xs font-semibold text-slate-700"
        onClick={() => setConfirmHome(true)}
        >
        กลับหน้าแรก
        </button>
      <div className="flex items-center justify-between pt-2">
        <div>
          <div className="text-xl font-bold">Host</div>
          <div className="text-xs text-slate-500">Session: <span className="font-mono">{props.sessionId}</span></div>
        </div>
        <div className="text-right space-y-1">
          <Chip tone={conn === "ok" ? "good" : conn === "offline" ? "warn" : "muted"}>
            {conn === "ok" ? "Connected" : conn === "offline" ? "Offline" : "Connecting"}
          </Chip>
          <div className="text-[11px] text-slate-500">Phase: {session?.phase ?? "-"}</div>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Share"
          right={
            <button
              className="text-xs font-semibold text-slate-700"
              onClick={async () => {
                await navigator.clipboard.writeText(viewerLink);
                setToast({ id: nanoid(), kind: "success", message: "Viewer link copied." });
              }}
            >
              Copy viewer link
            </button>
          }
        />
        <CardBody className="text-sm text-slate-600">
          Viewers open: <span className="font-mono break-all">{viewerLink}</span>
          <div className="text-xs text-slate-500 mt-1">Viewer mode is read-only.</div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Players" right={isLocked ? <Chip>Locked</Chip> : <Chip tone="warn">Editable</Chip>} />
        <CardBody className="space-y-3">
          {!isLocked && (
            <form
                className="flex gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();

                    // ตัดช่องว่างหัวท้าย
                    const raw = playerName.trim();
                    if (!raw) return;

                    // แยกชื่อด้วยเว้นวรรค (รองรับหลายช่องว่าง)
                    const names = raw
                      .split(/\s+/g)          // ← จุดสำคัญ
                      .map((n) => n.trim())
                      .filter(Boolean);

                    // กันชื่อซ้ำในชุดเดียว
                    const uniqueNames = Array.from(new Set(names));
                    if (uniqueNames.length === 0) return;

                    try {
                      await upsertPlayers(props.sessionId, uniqueNames);
                      setPlayerName("");
                    } catch (e: any) {
                      setToast({
                        id: nanoid(),
                        kind: "error",
                        message: e?.message ?? "เพิ่มผู้เล่นไม่สำเร็จ",
                      });
                    }
                  }}
            >
                <div className="flex-1">
                    <Input value={playerName} onChange={setPlayerName} placeholder="พิมพ์ชื่อแล้วกด Enter" />
                </div>
                <button
                    type="submit"
                    className="rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold"
                >
                    เพิ่ม
                </button>
                </form>
          )}

          <div className="space-y-2">
            {players.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-100 px-3 py-2">
                <div className="flex items-center gap-3">
                  {p.avatarDataUrl ? (
                    <button
                      type="button"
                      onClick={() => window.open(p.avatarDataUrl, "_blank")}
                      className="h-12 w-12 overflow-hidden rounded-full border border-slate-200"
                      title="เปิดรูปโปรไฟล์"
                    >
                      <img src={p.avatarDataUrl} alt={`avatar-${p.name}`} className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <div className="h-12 w-12 rounded-full border border-dashed border-slate-300 bg-slate-50" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.stats.wins}-{p.stats.losses} ({p.stats.played})</div>
                  </div>
                </div>

                {!isLocked && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold">
                    <label className="cursor-pointer text-slate-700">
                      อัปโหลดรูป
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingPlayerId === p.id}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.currentTarget.value = "";
                          if (!f) return;

                          try {
                            setUploadingPlayerId(p.id);
                            const avatarDataUrl = await compressImageToDataUrl(f, 320, 0.78);
                            await updatePlayerAvatar(props.sessionId, p.id, avatarDataUrl);
                            setToast({ id: nanoid(), kind: "success", message: `อัปโหลดรูปของ ${p.name} แล้ว` });
                          } catch (err: any) {
                            setToast({ id: nanoid(), kind: "error", message: err?.message ?? "อัปโหลดรูปไม่สำเร็จ" });
                          } finally {
                            setUploadingPlayerId(null);
                          }
                        }}
                      />
                    </label>

                    {p.avatarDataUrl && (
                      <button
                        className="text-amber-700"
                        disabled={uploadingPlayerId === p.id}
                        onClick={async () => {
                          try {
                            setUploadingPlayerId(p.id);
                            await updatePlayerAvatar(props.sessionId, p.id, undefined);
                            setToast({ id: nanoid(), kind: "success", message: `ลบรูปของ ${p.name} แล้ว` });
                          } catch (e: any) {
                            setToast({ id: nanoid(), kind: "error", message: e?.message ?? "ลบรูปไม่สำเร็จ" });
                          } finally {
                            setUploadingPlayerId(null);
                          }
                        }}
                      >
                        ลบรูป
                      </button>
                    )}

                    <button
                      className="text-rose-600"
                      onClick={async () => {
                        try {
                          const { deletePlayer } = await import("../features/session/api");
                          await deletePlayer(props.sessionId, p.id);
                        } catch (e: any) {
                          setToast({ id: nanoid(), kind: "error", message: e?.message ?? "ลบไม่สำเร็จ" });
                        }
                      }}
                    >
                      ลบผู้เล่น
                    </button>
                  </div>
                )}
              </div>
            ))}
            {players.length === 0 && <div className="text-sm text-slate-500">No players yet.</div>}
          </div>

          <Divider />

          <div className="space-y-2">
            <Button
              disabled={!canStart}
              onClick={async () => {
                try {
                  await assertHost(props.sessionId);
                  await startOnce(props.sessionId);

                  // Create teams (once), initialize queue
                  const { teams: newTeams, warnings } = buildInitialTeams(session!, players);
                  if (warnings.length) setToast({ id: nanoid(), kind: "info", message: warnings[0] });

                  await setTeamsAndQueue(props.sessionId, newTeams);

                  // Immediately assign up to one match per court, never reusing a team
                  for (const c of courts) {
                    await assignNextForCourt(props.sessionId, c.id);
                  }

                  setToast({ id: nanoid(), kind: "success", message: "Started. Courts assigned." });
                } catch (e: any) {
                  setToast({ id: nanoid(), kind: "error", message: e?.message ?? "Failed to start" });
                }
              }}
            >
              START (press once)
            </Button>

            <div className="text-xs text-slate-500">
              START shuffles once, creates teams (odd mode supported), locks editing, assigns at most 1 match per court.
            </div>
          </div>
        </CardBody>
      </Card>
<Card>
  <CardHeader title="รีเซ็ต" />
  <CardBody className="space-y-2">
    <Button
      variant="secondary"
      disabled={!isLocked}
      onClick={async () => {
        try {
          const { resetPairing } = await import("../features/session/mutations");
          const r = await resetPairing(props.sessionId);
          setToast({ id: nanoid(), kind: "success", message: r.warnings?.[0] ?? "รีเซ็ตทีมใหม่แล้ว" });
          // assign initial matches again
          for (const c of courts) await assignNextForCourt(props.sessionId, c.id);
        } catch (e: any) {
          setToast({ id: nanoid(), kind: "error", message: e?.message ?? "รีเซ็ตทีมไม่สำเร็จ" });
        }
      }}
    >
      Reset Pairing (ไม่รีเซ็ตสถิติผู้เล่น)
    </Button>

    <Button
      variant="danger"
      onClick={async () => {
        try {
          const { resetAll } = await import("../features/session/mutations");
          await resetAll(props.sessionId, true);
          setToast({ id: nanoid(), kind: "success", message: "รีเซ็ตทั้งหมดแล้ว (เก็บรายชื่อ)" });
        } catch (e: any) {
          setToast({ id: nanoid(), kind: "error", message: e?.message ?? "รีเซ็ตทั้งหมดไม่สำเร็จ" });
        }
      }}
    >
      Reset All (เก็บรายชื่อ)
    </Button>
  </CardBody>
</Card>

      <Card>
        <CardHeader title="Courts" />
        <CardBody className="space-y-3">
          {courts.map((c) => {
            const m = matchById(c.currentMatchId ?? undefined);
            const a = m ? teamById(m.teamAId) : undefined;
            const b = m ? teamById(m.teamBId) : undefined;

            return (
              <div key={c.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Court {c.id}</div>
                  <Chip tone={m?.status === "in_progress" ? "good" : m ? "muted" : "warn"}>
                    {m ? m.status : "idle"}
                  </Chip>
                </div>

                {m ? (
                  <div className="mt-2 text-sm">
                    <div className="font-semibold">
                      {formatTeam(a, playerById)} <span className="text-slate-400">vs</span> {formatTeam(b, playerById)}
                      {m.isFallback ? <span className="ml-2 text-xs text-amber-700">(fallback)</span> : null}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                        <Button
                            variant="primary"
                            disabled={m.status === "finished" || m.status === "canceled"}
                            onClick={() => {
                            setWinnerTeamId(m.teamAId);
                            setShowFinish({ match: m });
                            }}
                        >
                            Finish
                        </Button>

                        <Button
                            variant="danger"
                            onClick={async () => {
                            const { cancelMatchAndReschedule } = await import("../features/session/mutations");
                            await cancelMatchAndReschedule(props.sessionId, m.id);
                            await assignNextForCourt(props.sessionId, c.id);
                            setToast({ id: nanoid(), kind: "info", message: "Canceled. Attempted reschedule." });
                            }}
                        >
                            Cancel
                        </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <Button
                      variant="secondary"
                      disabled={!session?.locked}
                      onClick={async () => {
                        await assignNextForCourt(props.sessionId, c.id);
                      }}
                    >
                      Assign Next Match
                    </Button>
                    <div className="text-xs text-slate-500 mt-1">Court idles only if no valid match exists.</div>
                  </div>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Queue (available teams)" />
        <CardBody>
          <div className="text-sm text-slate-600 space-y-2">
            {(session?.queueTeams ?? []).map((tid) => {
              const t = teamById(tid);
              if (!t) return null;
              return (
                <div key={tid} className="rounded-xl border border-slate-100 px-3 py-2">
                  <div className="font-semibold">{formatTeam(t, playerById)}</div>
                  <div className="text-xs text-slate-500">
                    played {t.stats.played} · W {t.stats.wins} · L {t.stats.losses}
                    {t.playerIds.length === 3 ? " · (3-player team)" : ""}
                  </div>
                </div>
              );
            })}
            {(session?.queueTeams ?? []).length === 0 && <div className="text-sm text-slate-500">Queue empty.</div>}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent Results" />
        <CardBody className="space-y-2">
          {results.map((r) => {
            const ta = teamById(r.teamAId);
            const tb = teamById(r.teamBId);
            const win = r.winnerTeamId;
            return (
              
              <div key={r.id} className="rounded-xl border border-slate-100 px-3 py-2 text-sm">
                <div className="text-xs text-slate-500">Court {r.courtId}</div>
                <div className="font-semibold">
                  {formatTeam(ta, playerById)} vs {formatTeam(tb, playerById)}
                </div>
                <div className="text-xs text-slate-600">
                  Winner: {win === r.teamAId ? formatTeam(ta, playerById) : formatTeam(tb, playerById)}
                  {r.isFallback ? " · fallback" : ""}
                  <span className="font-semibold"> {winnerLoserScore(r) ? `(${winnerLoserScore(r)})` : ""}
                  </span>
                </div>
                
              </div>
            );
          })}
          {results.length === 0 && <div className="text-sm text-slate-500">No results yet.</div>}
        </CardBody>
      </Card>

      {showFinish && (
        
        <FinishModal
        
          match={showFinish.match}
          teamA={teamById(showFinish.match.teamAId)!}
          teamB={teamById(showFinish.match.teamBId)!}
          playerById={playerById}
          winnerTeamId={winnerTeamId}
          setWinnerTeamId={setWinnerTeamId}
          onClose={() => setShowFinish(null)}
          onConfirm={async (played) => {
            try {
                await finishMatch(props.sessionId, showFinish.match.id, winnerTeamId, played);
                await assignNextForCourt(props.sessionId, showFinish.match.courtId);
                setToast({ id: nanoid(), kind: "success", message: "บันทึกผลแล้ว และพยายามจัดแมตช์ถัดไป" });
                setShowFinish(null);
            } catch (e: any) {
                setToast({ id: nanoid(), kind: "error", message: e?.message ?? "Finish ไม่สำเร็จ" });
            }
            }
        }
        />
      )}{confirmHome && (
  <Modal
    title="ยืนยันกลับหน้าแรก"
    onClose={() => setConfirmHome(false)}
    actions={
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setConfirmHome(false)}>
          ยกเลิก
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            try {
              const { resetAll } = await import("../features/session/mutations");
              await resetAll(props.sessionId, true);
              history.pushState({}, "", "/");
              window.dispatchEvent(new PopStateEvent("popstate"));
            } catch (e: any) {
              setToast({ id: nanoid(), kind: "error", message: e?.message ?? "รีเซ็ตไม่สำเร็จ" });
            }
          }}
        >
          รีเซ็ต & กลับหน้าแรก
        </Button>
      </div>
    }
  >
    <div className="text-sm text-slate-600">
      การกลับหน้าแรกจะรีเซ็ตทั้งหมด (แต่เก็บรายชื่อผู้เล่น) แน่ใจหรือไม่?
    </div>
  </Modal>
)}
    </div>
    
  );
}

async function compressImageToDataUrl(file: File, maxEdge = 320, quality = 0.8): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("โหลดรูปไม่สำเร็จ"));
    image.onload = () => resolve(image);
    image.src = dataUrl;
  });

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ไม่สามารถประมวลผลรูปได้");
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}

function formatTeam(team: Team | undefined, playerById: (id: string) => Player | undefined) {
  if (!team) return "—";
  const names = team.playerIds.map((id) => playerById(id)?.name ?? "?");
  return names.join(" + ");
}

function FinishModal(props: {
    
  match: Match;
  teamA: Team;
  teamB: Team;
  playerById: (id: string) => Player | undefined;
  winnerTeamId: string;
  setWinnerTeamId: (v: string) => void;
  onClose: () => void;
  onConfirm: (payload: {
  teamAPlayedPlayerIds?: string[];
  teamBPlayedPlayerIds?: string[];
  scoreA?: number;
  scoreB?: number;
}) => Promise<void> | void;

}) {
  const [winScore, setWinScore] = useState<string>("");
  const [loseScore, setLoseScore] = useState<string>("");
  const [aPlayed, setAPlayed] = useState<string[]>([]);
  const [bPlayed, setBPlayed] = useState<string[]>([]);
  const needsA = props.teamA.playerIds.length === 3;
  const needsB = props.teamB.playerIds.length === 3;
  const labelA = props.teamA.playerIds.map((id)=>props.playerById(id)?.name ?? "?").join(" + ");
  const labelB = props.teamB.playerIds.map((id)=>props.playerById(id)?.name ?? "?").join(" + ");


  return (
    <Modal
      title="Finish Match"
      onClose={props.onClose}
      actions={
  <Button
    onClick={async () => {
      try {
        const payload: any = {};

        // 3-player: ต้องส่งคนที่ลงจริง
        if (needsA) payload.teamAPlayedPlayerIds = aPlayed;
        if (needsB) payload.teamBPlayedPlayerIds = bPlayed;

        // score: กรอกแบบ ผู้ชนะ/ผู้แพ้ แล้ว map เป็น scoreA/scoreB
        const w = winScore === "" ? NaN : Number(winScore);
        const l = loseScore === "" ? NaN : Number(loseScore);
        if (Number.isFinite(w) && Number.isFinite(l)) {
          if (props.winnerTeamId === props.teamA.id) {
            payload.scoreA = w;
            payload.scoreB = l;
          } else {
            payload.scoreA = l;
            payload.scoreB = w;
          }
        }

        await props.onConfirm(payload);
      } catch (e) {
        console.error(e);
      }
    }}
    disabled={
      !props.winnerTeamId ||
      (needsA && aPlayed.length !== 2) ||
      (needsB && bPlayed.length !== 2)
    }
  >
    ยืนยันผู้ชนะ
  </Button>
}

    >
      <div className="space-y-3 text-sm">
        <div className="font-semibold">Winner</div>
        <div className="grid grid-cols-2 gap-2">
          <button
                className={`rounded-xl border px-3 py-3 font-semibold ${props.winnerTeamId===props.teamA.id?"bg-slate-900 text-white border-slate-900":"bg-white border-slate-200"}`}
                onClick={() => props.setWinnerTeamId(props.teamA.id)}
            >
                ผู้ชนะ: {labelA}
            </button>

            <button
                className={`rounded-xl border px-3 py-3 font-semibold ${props.winnerTeamId===props.teamB.id?"bg-slate-900 text-white border-slate-900":"bg-white border-slate-200"}`}
                onClick={() => props.setWinnerTeamId(props.teamB.id)}
            >
                ผู้ชนะ: {labelB}
            </button>
        </div>

        {needsA && (
          <div className="space-y-2">
            <div className="font-semibold">Team A (3-player): select the 2 who played</div>
            <PickTwo ids={props.teamA.playerIds} picked={aPlayed} setPicked={setAPlayed} playerById={props.playerById} />
          </div>
        )}
        {needsB && (
          <div className="space-y-2">
            <div className="font-semibold">Team B (3-player): select the 2 who played</div>
            <PickTwo ids={props.teamB.playerIds} picked={bPlayed} setPicked={setBPlayed} playerById={props.playerById} />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <div className="font-semibold">สกอร์</div>
        <div className="grid grid-cols-2 gap-2">
            <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            type="number"
            inputMode="numeric"
            placeholder="คะแนนผู้ชนะ"
            value={winScore}
            onChange={(e) => setWinScore(e.target.value)}
            />
            <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            type="number"
            inputMode="numeric"
            placeholder="คะแนนผู้แพ้"
            value={loseScore}
            onChange={(e) => setLoseScore(e.target.value)}
            />
        </div>
        </div>

    </Modal>
    
  );
  
}

function PickTwo(props: {
  ids: string[];
  picked: string[];
  setPicked: (v: string[]) => void;
  playerById: (id: string) => Player | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {props.ids.map((id) => {
        const on = props.picked.includes(id);
        return (
          <button
            key={id}
            className={`rounded-full border px-3 py-2 text-xs font-semibold ${on?"bg-slate-900 text-white border-slate-900":"bg-white border-slate-200"}`}
            onClick={() => {
              if (on) props.setPicked(props.picked.filter((x) => x !== id));
              else {
                if (props.picked.length >= 2) return;
                props.setPicked([...props.picked, id]);
              }
            }}
          >
            {props.playerById(id)?.name ?? "?"}
          </button>
        );
      })}
    </div>
  );
}

function winnerLoserScore(r: ResultRow) {
  if (r.scoreA == null || r.scoreB == null) return "";
  const a = r.scoreA, b = r.scoreB;
  const win = r.winnerTeamId === r.teamAId ? a : b;
  const lose = r.winnerTeamId === r.teamAId ? b : a;
  return `${win}–${lose}`;
}
