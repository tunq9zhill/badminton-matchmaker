import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { ensureAnonAuth } from "../app/firebase";
import { useAppStore } from "../app/store";
import type { Court, Match, Player, Session, Team } from "../app/types";
import courtMateLogo from "../assets/CourtMate-logo.png";
import courtsBackground from "../assets/CourtsPNG.png";
import {
  assertHost,
  subscribeCourts,
  subscribeMatches,
  subscribePlayers,
  subscribeSession,
  subscribeTeams,
  updateSessionCore,
} from "../features/session/api";
import { buildInitialTeams } from "../engine/pairing";
import { autoFillWaitingMatches, getMatchQueue } from "../engine/queue";
import { teamPairKey } from "../engine/constraints";
import {
  assignNextForCourt,
  endSession,
  finishMatch,
  resetPairing,
  setTeamsAndQueue,
} from "../features/session/mutations";
import { ConfirmDrawer } from "../ui/ConfirmDrawer";
import { Modal } from "../ui/Modal";
import { AvatarBadge } from "../ui/AvatarBadge";
import { Button } from "../ui/Button";
import { clearHostSession } from "../app/localCache";

type QueuePreviewRow = {
  id: string;
  teamA?: Team;
  teamB?: Team;
};

type PendingAssign = {
  courtId: string;
  teamA: Team;
  teamB: Team;
};

const COURT_CARD_WIDTH = 283;
const COURT_CARD_GAP = 12;
const COURT_CARD_STEP = COURT_CARD_WIDTH + COURT_CARD_GAP;

export function Host(props: { sessionId: string; secret?: string }) {
  const [confirmHome, setConfirmHome] = useState(false);
  const [confirmEndSession, setConfirmEndSession] = useState(false);
  const [confirmResetPairing, setConfirmResetPairing] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [confirmCancelMatch, setConfirmCancelMatch] = useState<{ matchId: string; courtId: string } | null>(null);
  const [showFinish, setShowFinish] = useState<{ match: Match } | null>(null);
  const [pendingAssign, setPendingAssign] = useState<PendingAssign | null>(null);
  const [winnerTeamId, setWinnerTeamId] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [activeCourtIndex, setActiveCourtIndex] = useState(0);
  const currentMatchScrollRef = useRef<HTMLDivElement | null>(null);
  const currentMatchDragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const currentMatchSnapTimerRef = useRef<number | null>(null);
  const playerScrollRef = useRef<HTMLDivElement | null>(null);
  const playerDragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const pairingCompleteNoticeRef = useRef<string | null>(null);

  const setToast = useAppStore((s) => s.setToast);

  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    ensureAnonAuth().catch(() => {});
  }, []);

  useEffect(() => subscribeSession(props.sessionId, setSession), [props.sessionId]);
  useEffect(() => subscribePlayers(props.sessionId, setPlayers), [props.sessionId]);
  useEffect(() => subscribeTeams(props.sessionId, setTeams), [props.sessionId]);
  useEffect(() => subscribeCourts(props.sessionId, setCourts), [props.sessionId]);
  useEffect(() => subscribeMatches(props.sessionId, setMatches), [props.sessionId]);

  const matchById = useMemo(() => {
    const map = new Map(matches.map((match) => [match.id, match]));
    return (id?: string | null) => (id ? map.get(id) : undefined);
  }, [matches]);

  const teamById = useMemo(() => {
    const map = new Map(teams.map((team) => [team.id, team]));
    return (id?: string | null) => (id ? map.get(id) : undefined);
  }, [teams]);

  const playerById = useMemo(() => {
    const map = new Map(players.map((player) => [player.id, player]));
    return (id: string) => map.get(id);
  }, [players]);

  const isLocked = !!session?.locked;
  const canStart = !!session && players.length >= 4 && teams.length === 0;
  const viewerUrl = typeof window !== "undefined" ? `${window.location.origin}/s/${props.sessionId}` : `/s/${props.sessionId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(viewerUrl)}`;

  const coverageCompleted = useMemo(() => {
    const activeTeams = teams.filter((team) => !team.archived);
    if (!activeTeams.length || !players.length) return false;
    const hasStartedCoverageRound = activeTeams.some((team) => team.stats.played > 0);
    if (!hasStartedCoverageRound) return false;
    return players.every((player) => player.stats.played > 0);
  }, [teams, players]);

  const topPlayers = useMemo(
    () =>
      [...players]
        .sort((a, b) => {
          if (b.stats.wins !== a.stats.wins) return b.stats.wins - a.stats.wins;
          if (b.stats.played !== a.stats.played) return b.stats.played - a.stats.played;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 3),
    [players],
  );

  const podiumPlayers = [topPlayers[1], topPlayers[0], topPlayers[2]];

  const pairingCompleteNoticeKey = useMemo(() => {
    if (!session) return null;
    const activeTeams = teams.filter((team) => !team.archived);
    if (activeTeams.length < 2) return null;

    for (let index = 0; index < activeTeams.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < activeTeams.length; nextIndex += 1) {
        if (!session.metHistory[teamPairKey(activeTeams[index].id, activeTeams[nextIndex].id)]) {
          return null;
        }
      }
    }

    return activeTeams.map((team) => team.id).sort().join("__");
  }, [session, teams]);

  const queuePreview = useMemo<QueuePreviewRow[]>(() => {
    if (!session) return [];
    const rows: QueuePreviewRow[] = [];
    for (const item of autoFillWaitingMatches(getMatchQueue(session), session, teams)) {
      const teamA = teamById(item.teamAId);
      if (!teamA) continue;
      rows.push({
        id: item.id,
        teamA,
        teamB: item.teamBId ? teamById(item.teamBId) : undefined,
      });
    }
    return rows;
  }, [session, teamById, teams]);

  const courtCountLabel = session?.config.courtCount ?? courts.length;

  useEffect(() => {
    setActiveCourtIndex((index) => Math.min(index, Math.max(courts.length - 1, 0)));
  }, [courts.length]);

  useEffect(() => {
    return () => {
      if (currentMatchSnapTimerRef.current != null) window.clearTimeout(currentMatchSnapTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!session || !pairingCompleteNoticeKey) return;
    if (session.pairingCompleteNoticeKey === pairingCompleteNoticeKey) return;
    if (pairingCompleteNoticeRef.current === pairingCompleteNoticeKey) return;

    pairingCompleteNoticeRef.current = pairingCompleteNoticeKey;
    setToast({
      id: nanoid(),
      kind: "info",
      message: "ทุกคู่เจอกันครบแล้ว แนะนำจับคู่ใหม่",
      primaryAction: {
        label: "reset repair",
        onClick: async () => {
          try {
            await resetPairing(props.sessionId);
          } catch (error: any) {
            setToast({ id: nanoid(), kind: "error", message: error?.message ?? "Failed to reset pairing" });
          }
        },
      },
      secondaryAction: {
        label: "cancel",
        onClick: () => {},
      },
    });

    updateSessionCore(props.sessionId, { pairingCompleteNoticeKey }).catch(() => {});
  }, [pairingCompleteNoticeKey, props.sessionId, session, setToast]);

  const handleStart = async () => {
    if (!session) return;

    try {
      await assertHost(props.sessionId);

      const autoOddMode: Session["config"]["oddMode"] = players.length % 2 === 1 ? "three_player_rotation" : "none";
      await updateSessionCore(props.sessionId, { config: { ...session.config, oddMode: autoOddMode } });

      const preparedSession = { ...session, config: { ...session.config, oddMode: autoOddMode } };
      const { teams: newTeams, warnings } = buildInitialTeams(preparedSession, players);
      if (warnings.length) {
        setToast({ id: nanoid(), kind: "info", message: warnings[0] });
      }

      await setTeamsAndQueue(props.sessionId, newTeams, preparedSession);
      setToast({
        id: nanoid(),
        kind: "success",
        message: autoOddMode === "none" ? "Session started." : "Session started with 3-player rotation.",
      });
    } catch (error: any) {
      setToast({ id: nanoid(), kind: "error", message: error?.message ?? "Failed to start session" });
    }
  };

  const getNextMatchTeams = () => {
    const next = queuePreview.find((row) => !!row.teamA && !!row.teamB);
    if (!next?.teamA || !next.teamB) return null;
    return { teamA: next.teamA, teamB: next.teamB };
  };

  const assignPreparedMatch = async (
    courtId: string,
    teamA: Team,
    teamB: Team,
    teamAPlayedPlayerIds?: string[],
    teamBPlayedPlayerIds?: string[],
  ) => {
    await assignNextForCourt(props.sessionId, courtId, {
      expectedTeamAId: teamA.id,
      expectedTeamBId: teamB.id,
      teamAPlayedPlayerIds,
      teamBPlayedPlayerIds,
    });
  };

  const handleAssignNext = async (courtId: string) => {
    if (!session?.locked) return;

    const next = getNextMatchTeams();
    if (!next) {
      setToast({ id: nanoid(), kind: "info", message: "No available match to assign." });
      return;
    }

    if (next.teamA.playerIds.length === 3 || next.teamB.playerIds.length === 3) {
      setPendingAssign({ courtId, teamA: next.teamA, teamB: next.teamB });
      return;
    }

    try {
      await assignPreparedMatch(courtId, next.teamA, next.teamB);
      setToast({ id: nanoid(), kind: "success", message: "Match assigned." });
    } catch (error: any) {
      setToast({ id: nanoid(), kind: "error", message: error?.message ?? "Failed to assign next match" });
    }
  };

  const snapCurrentMatchScroll = (element: HTMLDivElement) => {
    const maxIndex = Math.max(courts.length - 1, 0);
    const nextIndex = Math.min(maxIndex, Math.max(0, Math.round(element.scrollLeft / COURT_CARD_STEP)));
    const targetLeft = nextIndex * COURT_CARD_STEP;
    if (Math.abs(element.scrollLeft - targetLeft) < 1) {
      setActiveCourtIndex(nextIndex);
      return;
    }
    element.style.scrollBehavior = "smooth";
    element.scrollTo({ left: targetLeft, behavior: "smooth" });
    setActiveCourtIndex(nextIndex);
  };

  const scheduleCurrentMatchSnap = (element: HTMLDivElement) => {
    if (currentMatchSnapTimerRef.current != null) window.clearTimeout(currentMatchSnapTimerRef.current);
    currentMatchSnapTimerRef.current = window.setTimeout(() => snapCurrentMatchScroll(element), 220);
  };

  return (
    <div className="min-h-[100dvh] bg-[#0D2318] text-white">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={courtMateLogo} alt="CourtMate" className="h-10 w-10 rounded-[14px]" />
            <div className="text-[18.8px] font-semibold leading-6 tracking-[-0.02em] text-white">CourtMate</div>
          </div>

          <div className="flex items-center gap-2">
            <HeaderActionButton onClick={() => setShowQr(true)}>QR</HeaderActionButton>
            <HeaderActionButton onClick={() => setConfirmHome(true)}>Exit</HeaderActionButton>
          </div>
        </header>

        <section className="mt-6">
          <div className="max-w-[320px]">
            <h1 className="text-[48px] font-bold leading-[60px] tracking-[-0.03em] text-white">Match center</h1>
            <p className="mt-1 text-[16px] font-normal leading-5 text-white">Manage matches, player and queue.</p>
          </div>

          {/* <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-white/65">
            <StatusPill>{conn === "ok" ? "Connected" : conn === "offline" ? "Offline" : "Connecting"}</StatusPill>
            <StatusPill>{isLocked ? "Live session" : "Setup"}</StatusPill>
            <StatusPill>Session {props.sessionId}</StatusPill>
          </div> */}
        </section>

        {!teams.length && (
          <SectionCard
            className="mt-6"
            title="Session setup"
            right={<span className="text-[14px] text-white/50">{players.length} players</span>}
          >
            <p className="text-[14px] leading-5 text-white/70">
              Build the first rotation and lock this session before managing live matches.
            </p>
            <div className="mt-4 flex gap-3">
              <ActionButton disabled={!canStart} onClick={handleStart} tone="primary" className="flex-1">
                Start session
              </ActionButton>
            </div>
          </SectionCard>
        )}

        <TopThreePodium players={podiumPlayers} />

        <section
          className="relative mt-6 h-[355px] overflow-hidden rounded-[20px] border border-white/5 bg-white/[0.05]"
        >
          <h2 className="absolute left-[19px] top-5 text-[16px] font-medium leading-5 text-white">Current match</h2>
          <div className="absolute right-5 top-5 text-right">
            <div className="text-[16px] font-medium leading-5 text-white">{courtCountLabel} Courts</div>
          </div>

          <div
            ref={currentMatchScrollRef}
            onScroll={(event) => {
              const maxIndex = Math.max(courts.length - 1, 0);
              const nextIndex = Math.min(maxIndex, Math.max(0, Math.round(event.currentTarget.scrollLeft / COURT_CARD_STEP)));
              setActiveCourtIndex((index) => (index === nextIndex ? index : nextIndex));
              scheduleCurrentMatchSnap(event.currentTarget);
            }}
            className="absolute left-4 right-4 top-[53px] h-[257px] cursor-grab snap-x snap-mandatory overflow-x-auto scroll-smooth active:cursor-grabbing [scroll-padding-inline:16px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button,input,textarea,[contenteditable=true]")) return;
              if (currentMatchSnapTimerRef.current != null) window.clearTimeout(currentMatchSnapTimerRef.current);
              event.currentTarget.style.scrollBehavior = "auto";
              currentMatchDragRef.current = {
                active: true,
                startX: event.clientX,
                scrollLeft: event.currentTarget.scrollLeft,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!currentMatchDragRef.current.active) return;
              event.preventDefault();
              event.currentTarget.scrollLeft = currentMatchDragRef.current.scrollLeft - (event.clientX - currentMatchDragRef.current.startX);
              scheduleCurrentMatchSnap(event.currentTarget);
            }}
            onPointerUp={(event) => {
              currentMatchDragRef.current.active = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              snapCurrentMatchScroll(event.currentTarget);
            }}
            onPointerCancel={(event) => {
              currentMatchDragRef.current.active = false;
              snapCurrentMatchScroll(event.currentTarget);
            }}
            onLostPointerCapture={(event) => {
              currentMatchDragRef.current.active = false;
              snapCurrentMatchScroll(event.currentTarget);
            }}
          >
            <div className="flex h-full gap-3">
              {courts.map((court) => {
                const match = matchById(court.currentMatchId);
                const teamA = match ? teamById(match.teamAId) : undefined;
                const teamB = match ? teamById(match.teamBId) : undefined;

                return (
                  <CourtMatchCard
                    key={court.id}
                    court={court}
                    match={match}
                    teamA={teamA}
                    teamB={teamB}
                    playerById={playerById}
                    coverageCompleted={coverageCompleted}
                    canAssign={!!session?.locked}
                    onAssignNext={() => void handleAssignNext(court.id)}
                    onCancelMatch={() => {
                      if (!match) return;
                      setConfirmCancelMatch({ matchId: match.id, courtId: court.id });
                    }}
                    onFinishMatch={() => {
                      if (!match) return;
                      setWinnerTeamId(match.teamAId);
                      setShowFinish({ match });
                    }}
                  />
                );
              })}
              <div
                aria-hidden="true"
                className="h-px flex-none"
                style={{ width: `max(calc(100% - ${COURT_CARD_WIDTH + COURT_CARD_GAP}px), 0px)` }}
              />
            </div>
          </div>

          {courts.length > 1 && (
            <div className="absolute bottom-[19px] left-1/2 flex h-3 -translate-x-1/2 items-center gap-1">
              {courts.map((court, index) => (
                <button
                  key={court.id}
                  type="button"
                  aria-label={`Show court ${court.id}`}
                  onClick={() => {
                    currentMatchScrollRef.current?.scrollTo({ left: index * COURT_CARD_STEP, behavior: "smooth" });
                    setActiveCourtIndex(index);
                  }}
                  className={`h-3 rounded-[46px] border border-black/5 transition-[width,opacity] ${
                    activeCourtIndex === index ? "w-[31px] bg-white" : "w-3 bg-white/20"
                  }`}
                />
              ))}
            </div>
          )}
        </section>

        <UpcomingMatchesPanel
          rows={queuePreview}
          playerById={playerById}
          coverageCompleted={coverageCompleted}
        />

        <SectionCard
          className="mt-6"
          title={`Players (${players.length})`}
          right={<span className="text-[14px] text-white/50">{isLocked ? "Locked" : "Editable"}</span>}
        >
          <div
            ref={playerScrollRef}
            className="-mx-5 mt-4 cursor-grab overflow-x-auto px-5 pb-1 active:cursor-grabbing [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("input,textarea,[contenteditable=true]")) return;
              playerDragRef.current = {
                active: true,
                startX: event.clientX,
                scrollLeft: event.currentTarget.scrollLeft,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!playerDragRef.current.active) return;
              event.currentTarget.scrollLeft = playerDragRef.current.scrollLeft - (event.clientX - playerDragRef.current.startX);
            }}
            onPointerUp={(event) => {
              playerDragRef.current.active = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={() => {
              playerDragRef.current.active = false;
            }}
          >
            <div className="flex min-w-max gap-3">
              {players.map((player) => (
                <div
                  key={player.id}
                  className="flex h-[60px] w-[158px] flex-none items-center gap-3 rounded-[16px] border border-white/5 bg-white/[0.05] px-4"
                >
                  <AvatarBadge
                    name={player.name}
                    imageUrl={player.avatarDataUrl}
                    sizeClassName="h-8 w-8"
                    textClassName="text-[14px]"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-medium leading-5 text-white">{player.name}</div>
                    <div className="mt-1 truncate whitespace-nowrap text-[12px] leading-[15px] text-white/50">
                      {player.stats.played} played
                    </div>
                  </div>
                </div>
              ))}

              {players.length === 0 && (
                <div className="flex h-[76px] w-[250px] flex-none items-center justify-center rounded-[16px] border border-dashed border-white/10 px-4 text-center text-[14px] text-white/45">
                  No players in this session yet.
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard className="mt-6" title="Session tools">
          <div className="mt-2 grid grid-cols-2 gap-3">
            <ActionButton
              tone="ghost"
              disabled={!isLocked}
              onClick={() => setConfirmResetPairing(true)}
            >
              Reset pairing
            </ActionButton>
            <ActionButton tone="ghost" onClick={() => setConfirmResetAll(true)}>
              Reset session
            </ActionButton>
            <ActionButton tone="danger" className="col-span-2" onClick={() => setConfirmEndSession(true)}>
              End Session
            </ActionButton>
          </div>
        </SectionCard>

        {showQr && (
          <Modal title="Session QR" onClose={() => setShowQr(false)}>
            <div className="space-y-3">
              <div className="flex justify-center">
                <img src={qrUrl} alt={`QR-${props.sessionId}`} className="rounded-[20px] border border-white/10 bg-white p-3" />
              </div>
              <div className="text-center font-mono text-xs text-white/50">{viewerUrl}</div>
            </div>
          </Modal>
        )}

        {pendingAssign && (
          <AssignPlayersModal
            assignment={pendingAssign}
            playerById={playerById}
            onClose={() => setPendingAssign(null)}
            onConfirm={async (payload) => {
              try {
                await assignPreparedMatch(
                  pendingAssign.courtId,
                  pendingAssign.teamA,
                  pendingAssign.teamB,
                  payload.teamAPlayedPlayerIds,
                  payload.teamBPlayedPlayerIds,
                );
                setToast({ id: nanoid(), kind: "success", message: "Match assigned." });
                setPendingAssign(null);
              } catch (error: any) {
                setToast({ id: nanoid(), kind: "error", message: error?.message ?? "Failed to assign next match" });
              }
            }}
          />
        )}

        {showFinish && (
          <FinishModal
            match={showFinish.match}
            teamA={teamById(showFinish.match.teamAId)!}
            teamB={teamById(showFinish.match.teamBId)!}
            playerById={playerById}
            winnerTeamId={winnerTeamId}
            setWinnerTeamId={setWinnerTeamId}
            onClose={() => setShowFinish(null)}
            onConfirm={async (payload) => {
              try {
                await finishMatch(props.sessionId, showFinish.match.id, winnerTeamId, payload);
                setToast({ id: nanoid(), kind: "success", message: "Match finished." });
                setShowFinish(null);
              } catch (error: any) {
                setToast({ id: nanoid(), kind: "error", message: error?.message ?? "Finish failed" });
              }
            }}
          />
        )}

        {confirmHome && (
          <ConfirmDrawer
            title="Leave session?"
            description="You can come back to this host session later from the home screen."
            onCancel={() => setConfirmHome(false)}
            onConfirm={() => {
              history.pushState({}, "", "/");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            confirmLabel="Back to home"
          />
        )}

        {confirmEndSession && (
          <ConfirmDrawer
            title="End session?"
            description="This will close the room and remove it from resume. Players will not be able to rejoin this session."
            onCancel={() => setConfirmEndSession(false)}
            onConfirm={async () => {
              try {
                await endSession(props.sessionId);
                clearHostSession();
                history.pushState({}, "", "/");
                window.dispatchEvent(new PopStateEvent("popstate"));
              } catch (error: any) {
                setToast({ id: nanoid(), kind: "error", message: error?.message ?? "Failed to end session" });
                setConfirmEndSession(false);
              }
            }}
            confirmLabel="End Session"
            confirmTone="danger"
          />
        )}

        {confirmResetPairing && (
          <ConfirmDrawer
            title="Reset pairing?"
            description="This rebuilds teams and queue while keeping finished player history."
            onCancel={() => setConfirmResetPairing(false)}
            onConfirm={async () => {
              try {
                const { resetPairing } = await import("../features/session/mutations");
                const response = await resetPairing(props.sessionId);
                setToast({ id: nanoid(), kind: "success", message: response.warnings?.[0] ?? "Pairing rebuilt." });
              } catch (error: any) {
                setToast({ id: nanoid(), kind: "error", message: error?.message ?? "Failed to reset pairing" });
              } finally {
                setConfirmResetPairing(false);
              }
            }}
            confirmLabel="Reset pairing"
          />
        )}

        {confirmResetAll && (
          <ConfirmDrawer
            title="Reset session?"
            description="This clears matches and queue but keeps the player names in this session."
            onCancel={() => setConfirmResetAll(false)}
            onConfirm={async () => {
              try {
                const { resetAll } = await import("../features/session/mutations");
                await resetAll(props.sessionId, true);
                setToast({ id: nanoid(), kind: "success", message: "Session reset." });
              } catch (error: any) {
                setToast({ id: nanoid(), kind: "error", message: error?.message ?? "Failed to reset session" });
              } finally {
                setConfirmResetAll(false);
              }
            }}
            confirmLabel="Reset session"
          />
        )}

        {confirmCancelMatch && (
          <ConfirmDrawer
            title="Cancel current match?"
            description="The teams will go back into the queue and the court will be reopened."
            onCancel={() => setConfirmCancelMatch(null)}
            onConfirm={async () => {
              try {
                const { cancelMatchAndReschedule } = await import("../features/session/mutations");
                await cancelMatchAndReschedule(props.sessionId, confirmCancelMatch.matchId);
                setToast({ id: nanoid(), kind: "success", message: "Match canceled." });
              } catch (error: any) {
                setToast({ id: nanoid(), kind: "error", message: error?.message ?? "Failed to cancel match" });
              } finally {
                setConfirmCancelMatch(null);
              }
            }}
            confirmLabel="Cancel match"
          />
        )}
      </div>
    </div>
  );
}

function HeaderActionButton(props: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex h-9 items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 text-[13px] font-medium text-white transition-transform active:scale-[0.97]"
    >
      {props.children}
    </button>
  );
}

function SectionCard(props: { title: string; right?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section className={`rounded-[20px] border border-white/5 bg-white/[0.06] p-5 ${props.className ?? ""}`} style={props.style}>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[18px] font-medium leading-[23px] text-white">{props.title}</h2>
        {props.right}
      </div>
      {props.children}
    </section>
  );
}

function ActionButton(props: {
  children: ReactNode;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  tone: "primary" | "outline" | "ghost" | "danger";
  className?: string;
}) {
  const toneClass =
    props.tone === "primary"
      ? "bg-[#37B64B] text-white shadow-[0_0_30px_rgba(55,182,75,0.2)]"
      : props.tone === "outline"
      ? "border border-[#37B64B] bg-transparent text-white"
      : props.tone === "danger"
      ? "bg-[#7A1F24] text-white"
      : "border border-white/10 bg-white/[0.04] text-white";

  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`flex h-[52px] items-center justify-center rounded-[16px] px-4 text-[16px] font-medium leading-5 transition-transform active:scale-[0.98] disabled:opacity-45 ${toneClass} ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}

function TopThreePodium(props: { players: Array<Player | undefined>; className?: string; style?: CSSProperties }) {
  return (
    <section
      className={`relative mt-6 h-[211px] overflow-hidden rounded-[20px] border border-white/5 bg-white/[0.05] ${props.className ?? ""}`}
      style={props.style}
    >
      <h2 className="absolute left-[19px] top-5 text-[16px] font-medium leading-5 text-white">Top 3 player</h2>
      <PodiumCard
        rank={2}
        player={props.players[0]}
        tone="silver"
        placementClassName="left-[5.28%] top-[91px] h-[120px] w-[27.39%]"
        compact
      />
      <PodiumCard
        rank={1}
        player={props.players[1]}
        tone="gold"
        placementClassName="left-1/2 top-[57px] h-[154px] w-[32.91%] -translate-x-1/2"
      />
      <PodiumCard
        rank={3}
        player={props.players[2]}
        tone="bronze"
        placementClassName="right-[5.28%] top-[91px] h-[120px] w-[27.39%]"
        compact
      />
    </section>
  );
}

function PodiumCard(props: {
  rank: 1 | 2 | 3;
  player?: Player;
  tone: "gold" | "silver" | "bronze";
  placementClassName: string;
  compact?: boolean;
}) {
  const badgeColor =
    props.tone === "gold" ? "bg-[#FFCE5C]" : props.tone === "silver" ? "bg-[#C0C0C0]" : "bg-[#B38859]";
  const cardGradient =
    props.tone === "gold"
      ? "bg-[linear-gradient(180deg,#29492B_0%,#193321_100%)]"
      : "bg-[linear-gradient(180deg,#25392E_0%,#182E20_100%)]";

  return (
    <div
      className={`absolute flex flex-col items-center rounded-t-[20px] border-x border-t border-white/5 px-3 text-center ${cardGradient} ${props.placementClassName}`}
    >
      <div className={`absolute -top-4 flex h-8 w-8 items-center justify-center rounded-full text-[16px] font-medium leading-5 text-black ${badgeColor}`}>
        {props.rank}
      </div>
      <div className="mt-6 max-w-full truncate text-[16px] font-normal leading-5 text-white">{props.player?.name ?? "-"}</div>
      <div className={`${props.compact ? "mt-[11px] text-[34px] leading-[43px]" : "mt-2 text-[50px] leading-[63px]"} font-normal text-[#37B64B]`}>
        {props.player?.stats.wins ?? 0}
      </div>
      <div className={`${props.compact ? "-mt-px" : "mt-[7px]"} text-[14px] font-normal leading-[18px] text-white/20`}>Wins</div>
    </div>
  );
}

function CourtMatchCard(props: {
  court: Court;
  match?: Match;
  teamA?: Team;
  teamB?: Team;
  playerById: (id: string) => Player | undefined;
  coverageCompleted: boolean;
  canAssign: boolean;
  onAssignNext: () => void | Promise<void>;
  onCancelMatch: () => void;
  onFinishMatch: () => void;
}) {
  const hasMatch = !!props.match && !!props.teamA && !!props.teamB;

  return (
    <article
      data-court-card
      className="relative h-[257px] w-[283px] flex-none snap-start overflow-hidden rounded-[16px] border border-white/5 bg-black/5"
    >
      <div className="absolute left-0 right-0 top-4 flex h-5 items-center justify-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${hasMatch ? "bg-[#37B64B]" : "bg-white/25"}`} />
        <span className="text-[16px] font-normal leading-5 text-white">Court {props.court.id}</span>
      </div>

      {hasMatch ? (
        <>
          <CourtVisual
            teamA={props.teamA!}
            teamB={props.teamB!}
            teamAPlayedIds={props.match?.teamAPlayedPlayerIds}
            teamBPlayedIds={props.match?.teamBPlayedPlayerIds}
            playerById={props.playerById}
          />
          <div className="absolute left-4 top-[199px] flex h-[42px] w-[251px] gap-2">
            <MatchCardButton tone="ghost" onClick={props.onCancelMatch}>
              Cancel
            </MatchCardButton>
            <MatchCardButton tone="outline" onClick={props.onFinishMatch}>
              End match
            </MatchCardButton>
          </div>
        </>
      ) : (
        <>
          <div className="absolute left-4 top-[53px] h-[134px] w-[251px] rounded-[16px] border border-dashed border-white/10 px-4 py-4">
            <div className="text-[16px] font-medium leading-5 text-white">
              {props.coverageCompleted ? "Balanced round" : "Court is ready"}
            </div>
            <p className="mt-1 text-[13px] font-normal leading-[18px] text-white/55">
              {props.coverageCompleted
                ? "Assign the next fair match from the available queue."
                : "Assign the next valid match from the available queue."}
            </p>
          </div>
          <div className="absolute left-4 top-[199px] h-[42px] w-[121.5px]">
            <MatchCardButton tone="outline" disabled={!props.canAssign} onClick={props.onAssignNext}>
              Assign next
            </MatchCardButton>
          </div>
        </>
      )}
    </article>
  );
}

function MatchCardButton(props: {
  children: ReactNode;
  tone: "ghost" | "outline";
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
}) {
  const toneClass =
    props.tone === "outline"
      ? "border-[#37B64B] text-white disabled:border-white/20 disabled:text-white/30"
      : "border-white/20 text-white/50 disabled:border-white/10 disabled:text-white/30";

  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`flex h-full min-w-0 flex-1 items-center justify-center rounded-[16px] border px-3 text-[16px] font-medium leading-5 transition-transform active:scale-[0.98] disabled:cursor-not-allowed ${toneClass}`}
    >
      {props.children}
    </button>
  );
}

function CourtVisual(props: {
  teamA: Team;
  teamB: Team;
  teamAPlayedIds?: string[];
  teamBPlayedIds?: string[];
  playerById: (id: string) => Player | undefined;
}) {
  const teamAPlayers = getCourtPlayerIds(props.teamA, props.teamAPlayedIds).map((id) => props.playerById(id));
  const teamBPlayers = getCourtPlayerIds(props.teamB, props.teamBPlayedIds).map((id) => props.playerById(id));

  return (
    <div
      className="absolute left-4 top-[50px] h-[134px] w-[251px] bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${courtsBackground})`, backgroundSize: "251px 134px" }}
    >
      <CourtPlayerMarker player={teamAPlayers[0]} className="left-[25px] top-[15px] w-[96px]" />
      <CourtPlayerMarker player={teamBPlayers[0]} className="right-[25px] top-[15px] w-[96px]" />
      <CourtPlayerMarker player={teamAPlayers[1]} className="left-[25px] top-[74px] w-[96px]" />
      <CourtPlayerMarker player={teamBPlayers[1]} className="right-[25px] top-[74px] w-[96px]" />
    </div>
  );
}

function CourtPlayerMarker(props: { player?: Player; className: string }) {
  const name = props.player?.name ?? "Unknown";

  return (
    <div className={`absolute flex h-11 flex-col items-center gap-0.5 text-center ${props.className}`}>
      <AvatarBadge
        name={name}
        imageUrl={props.player?.avatarDataUrl}
        sizeClassName="h-6 w-6"
        textClassName="text-[12px]"
        className="border border-white/5"
      />
      <div className="max-w-full truncate text-[14px] font-medium leading-[18px] text-white">{name}</div>
    </div>
  );
}

function getCourtPlayerIds(team: Team, playedIds?: string[]) {
  if (playedIds?.length) return playedIds.slice(0, 2);
  if (team.playerIds.length <= 2) return team.playerIds;
  const start = (team.rotationIndex ?? 0) % team.playerIds.length;
  return [team.playerIds[start], team.playerIds[(start + 1) % team.playerIds.length]];
}

function UpcomingMatchesPanel(props: {
  rows: QueuePreviewRow[];
  playerById: (id: string) => Player | undefined;
  coverageCompleted: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`mt-6 rounded-[20px] border border-white/5 bg-white/[0.05] px-[19px] py-5 ${props.className ?? ""}`} style={props.style}>
      <h2 className="text-[16px] font-medium leading-5 text-white">Upcoming matches</h2>

      <div className="mt-4 flex flex-col gap-2">
        {props.rows.map((row) => (
          <UpcomingMatchRow key={row.id} row={row} playerById={props.playerById} />
        ))}

        {props.rows.length === 0 && (
          <div className="flex h-20 w-full items-center justify-center rounded-[16px] border border-dashed border-white/10 bg-white/[0.05] px-4 text-center text-[14px] font-medium leading-[18px] text-white/45">
            {props.coverageCompleted ? "Waiting for teams to return from court." : "No upcoming matches yet."}
          </div>
        )}
      </div>
    </section>
  );
}

function UpcomingMatchRow(props: { row: QueuePreviewRow; playerById: (id: string) => Player | undefined }) {
  if (!props.row.teamA) return null;

  return (
    <article className="flex min-h-20 w-full items-center justify-between gap-2 rounded-[16px] border border-white/5 bg-white/[0.05] px-3 py-3.5">
      <UpcomingTeam team={props.row.teamA} playerById={props.playerById} />

      {props.row.teamB ? (
        <>
          <div className="flex h-5 w-[19px] flex-none items-center justify-center text-[16px] font-normal leading-5 text-white">VS</div>
          <UpcomingTeam team={props.row.teamB} playerById={props.playerById} align="right" />
        </>
      ) : (
        <div className="ml-auto flex h-[26px] items-center rounded-[46px] border border-white/10 px-3 text-[12px] font-medium leading-[15px] text-white/55">
          Waiting
        </div>
      )}
    </article>
  );
}

function UpcomingTeam(props: {
  team: Team;
  playerById: (id: string) => Player | undefined;
  align?: "left" | "right";
}) {
  const ids = props.team.playerIds;
  const justifyClass = props.align === "right" ? "justify-end" : "justify-start";

  return (
    <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className={`flex h-11 min-w-full w-max items-center gap-2.5 ${justifyClass}`}>
        {ids.map((playerId, index) => (
          <div key={playerId} className="flex flex-none items-center gap-2.5">
            {index > 0 && (
              <div className="flex h-8 flex-none items-center justify-center text-[13px] font-medium leading-[18px] text-white">
                &
              </div>
            )}
            <UpcomingPlayer player={props.playerById(playerId)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function UpcomingPlayer(props: { player?: Player }) {
  const name = props.player?.name ?? "?";

  return (
    <div className="flex h-11 min-w-0 max-w-[36px] flex-none flex-col items-center gap-0.5">
      <AvatarBadge
        name={name}
        imageUrl={props.player?.avatarDataUrl}
        sizeClassName="h-[22px] w-[22px]"
        textClassName="text-[11px]"
        className="border border-white/5"
      />
      <div className="max-w-full truncate text-[13px] font-medium leading-[17px] text-white">{name}</div>
    </div>
  );
}

function AssignPlayersModal(props: {
  assignment: PendingAssign;
  playerById: (id: string) => Player | undefined;
  onClose: () => void;
  onConfirm: (payload: {
    teamAPlayedPlayerIds?: string[];
    teamBPlayedPlayerIds?: string[];
  }) => Promise<void> | void;
}) {
  const needsA = props.assignment.teamA.playerIds.length === 3;
  const needsB = props.assignment.teamB.playerIds.length === 3;
  const [teamAPlayed, setTeamAPlayed] = useState(() => getCourtPlayerIds(props.assignment.teamA));
  const [teamBPlayed, setTeamBPlayed] = useState(() => getCourtPlayerIds(props.assignment.teamB));

  return (
    <Modal
      title="Choose players"
      onClose={props.onClose}
      actions={
        <Button
          onClick={async () => {
            await props.onConfirm({
              teamAPlayedPlayerIds: needsA ? teamAPlayed : undefined,
              teamBPlayedPlayerIds: needsB ? teamBPlayed : undefined,
            });
          }}
          disabled={(needsA && teamAPlayed.length !== 2) || (needsB && teamBPlayed.length !== 2)}
        >
          Assign match
        </Button>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-white/60">Select the 2 players who will play before assigning this match to the court.</p>

        {needsA && (
          <div className="space-y-2">
            <div className="font-semibold">Team A</div>
            <PickTwo ids={props.assignment.teamA.playerIds} picked={teamAPlayed} setPicked={setTeamAPlayed} playerById={props.playerById} />
          </div>
        )}

        {needsB && (
          <div className="space-y-2">
            <div className="font-semibold">Team B</div>
            <PickTwo ids={props.assignment.teamB.playerIds} picked={teamBPlayed} setPicked={setTeamBPlayed} playerById={props.playerById} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function FinishModal(props: {
  match: Match;
  teamA: Team;
  teamB: Team;
  playerById: (id: string) => Player | undefined;
  winnerTeamId: string;
  setWinnerTeamId: (value: string) => void;
  onClose: () => void;
  onConfirm: (payload: {
    scoreA?: number;
    scoreB?: number;
  }) => Promise<void> | void;
}) {
  const [winScore, setWinScore] = useState("");
  const [loseScore, setLoseScore] = useState("");

  const labelA = getCourtPlayerIds(props.teamA, props.match.teamAPlayedPlayerIds).map((id) => props.playerById(id)?.name ?? "?").join(" + ");
  const labelB = getCourtPlayerIds(props.teamB, props.match.teamBPlayedPlayerIds).map((id) => props.playerById(id)?.name ?? "?").join(" + ");

  return (
    <Modal
      title="Finish Match"
      onClose={props.onClose}
      actions={
        <Button
          onClick={async () => {
            const payload: {
              scoreA?: number;
              scoreB?: number;
            } = {};

            const winnerScore = winScore === "" ? Number.NaN : Number(winScore);
            const loserScore = loseScore === "" ? Number.NaN : Number(loseScore);

            if (Number.isFinite(winnerScore) && Number.isFinite(loserScore)) {
              if (props.winnerTeamId === props.teamA.id) {
                payload.scoreA = winnerScore;
                payload.scoreB = loserScore;
              } else {
                payload.scoreA = loserScore;
                payload.scoreB = winnerScore;
              }
            }

            await props.onConfirm(payload);
          }}
          disabled={!props.winnerTeamId}
        >
          Confirm winner
        </Button>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="font-semibold">Winner</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`rounded-[20px] border px-3 py-3 font-semibold transition-transform active:scale-[0.98] ${props.winnerTeamId === props.teamA.id ? "border-[#37B64B] bg-[#37B64B] text-white" : "border-white/10 bg-white/[0.04] text-white"}`}
            onClick={() => props.setWinnerTeamId(props.teamA.id)}
          >
            {labelA}
          </button>
          <button
            type="button"
            className={`rounded-[20px] border px-3 py-3 font-semibold transition-transform active:scale-[0.98] ${props.winnerTeamId === props.teamB.id ? "border-[#37B64B] bg-[#37B64B] text-white" : "border-white/10 bg-white/[0.04] text-white"}`}
            onClick={() => props.setWinnerTeamId(props.teamB.id)}
          >
            {labelB}
          </button>
        </div>

        <div className="space-y-2">
          <div className="font-semibold">Score</div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
              type="number"
              inputMode="numeric"
              placeholder="Winner score"
              value={winScore}
              onChange={(event) => setWinScore(event.target.value)}
            />
            <input
              className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
              type="number"
              inputMode="numeric"
              placeholder="Loser score"
              value={loseScore}
              onChange={(event) => setLoseScore(event.target.value)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PickTwo(props: {
  ids: string[];
  picked: string[];
  setPicked: (value: string[]) => void;
  playerById: (id: string) => Player | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {props.ids.map((id) => {
        const active = props.picked.includes(id);
        const player = props.playerById(id);

        return (
          <button
            key={id}
            type="button"
            className={`rounded-full border px-3 py-2 text-xs font-semibold transition-transform active:scale-[0.98] ${active ? "border-[#37B64B] bg-[#37B64B] text-white" : "border-white/10 bg-white/[0.04] text-white"}`}
            onClick={() => {
              if (active) {
                props.setPicked(props.picked.filter((value) => value !== id));
                return;
              }
              if (props.picked.length >= 2) return;
              props.setPicked([...props.picked, id]);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <AvatarBadge
                name={player?.name ?? "?"}
                imageUrl={player?.avatarDataUrl}
                sizeClassName="h-5 w-5"
                textClassName="text-[10px]"
              />
              <span>{player?.name ?? "Unknown"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
