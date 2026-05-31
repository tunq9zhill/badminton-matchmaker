import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Button } from "../ui/Button";
import { addPlayers, assertHost, createSession, sessionExists } from "../features/session/api";
import { useAppStore } from "../app/store";
import { nanoid } from "nanoid";
import { Modal } from "../ui/Modal";
import { readHostSession, readRecentPlayers, saveHostSession, type RecentPlayer } from "../app/localCache";
import courtMateLogo from "../assets/CourtMate-logo.png";
import backgroundImage from "../assets/Background.jpg";
import { AvatarBadge } from "../ui/AvatarBadge";
import { buildInitialTeams } from "../engine/pairing";
import { setTeamsAndQueue, startOnce } from "../features/session/mutations";

type LandingMode = "home" | "create" | "players" | "viewer";
type DraftPlayer = { id: string; name: string; avatarDataUrl?: string };

type JsQrResult = { data?: string };
type JsQrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
) => JsQrResult | null;

const jsQrCdnCandidates = [
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
  "https://unpkg.com/jsqr@1.4.0/dist/jsQR.js",
];
let jsQrLoaderPromise: Promise<JsQrDecoder | null> | null = null;

function getJsQrDecoder(): JsQrDecoder | null {
  return (window as any).jsQR as JsQrDecoder | undefined ?? null;
}

function loadJsQrDecoder(): Promise<JsQrDecoder | null> {
  const existing = getJsQrDecoder();
  if (existing) return Promise.resolve(existing);
  if (jsQrLoaderPromise) return jsQrLoaderPromise;

  jsQrLoaderPromise = (async () => {
    for (const src of jsQrCdnCandidates) {
      const loaded = await new Promise<boolean>((resolve) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.crossOrigin = "anonymous";
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      });

      if (loaded) {
        const decoder = getJsQrDecoder();
        if (decoder) return decoder;
      }
    }
    return null;
  })();

  return jsQrLoaderPromise;
}

export function Landing() {
  const [mode, setMode] = useState<LandingMode>("home");
  const [courtCount, setCourtCount] = useState("2");
  const [playerName, setPlayerName] = useState("");
  const [draftPlayers, setDraftPlayers] = useState<DraftPlayer[]>([]);
  const [viewerCode, setViewerCode] = useState(Array(6).fill(""));
  const [joining, setJoining] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [lastHostSession, setLastHostSession] = useState(() => readHostSession());
  const [recentPlayers] = useState<RecentPlayer[]>(() => readRecentPlayers());
  const setToast = useAppStore((s) => s.setToast);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const scanLockRef = useRef(false);

  const validCourts = useMemo(() => {
    const n = Number(courtCount);
    return Number.isFinite(n) && n >= 1 && n <= 12;
  }, [courtCount]);
  const visibleRecentPlayers = useMemo(() => {
    const draftNameSet = new Set(draftPlayers.map((player) => player.name.toLowerCase()));
    return recentPlayers.filter((player) => !draftNameSet.has(player.name.toLowerCase()));
  }, [draftPlayers, recentPlayers]);

  const codeValue = viewerCode.join("");
  const courtNumber = Number(courtCount);
  const canCreateMatches = draftPlayers.length >= 4 && validCourts && !creatingSession;

  const setCourtNumber = (next: number) => {
    const clamped = Math.min(12, Math.max(1, next));
    setCourtCount(String(clamped));
  };
  const fadeInStyle = (delay: number) => ({ animationDelay: `${delay}ms` });

  const addDraftPlayer = (payload: { name: string; avatarDataUrl?: string }) => {
    const trimmedName = payload.name.trim();
    if (!trimmedName) return false;

    setDraftPlayers((prev) => [...prev, { id: nanoid(8), name: trimmedName, avatarDataUrl: payload.avatarDataUrl }]);
    return true;
  };

  const submitPlayerName = () => {
    const names = playerName
      .split(/\s+/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return;

    let addedAny = false;
    for (const name of names) {
      addedAny = addDraftPlayer({ name }) || addedAny;
    }
    if (!addedAny) return;
    setPlayerName("");
  };

  const createMatchSession = async () => {
    if (!canCreateMatches) return;

    const nextPlayers = draftPlayers.map((player) => ({
      name: player.name.trim(),
      avatarDataUrl: player.avatarDataUrl,
    }));
    const oddMode = nextPlayers.length % 2 === 1 ? "three_player_rotation" : "none";

    try {
      setCreatingSession(true);
      const { sessionId, secret } = await createSession({
        courtCount: Number(courtCount),
        oddMode,
      });
      const createdPlayers = await addPlayers(sessionId, nextPlayers);
      const { session } = await assertHost(sessionId);
      await startOnce(sessionId);
      const { teams, warnings } = buildInitialTeams(session, createdPlayers);
      if (warnings.length) {
        setToast({ id: nanoid(), kind: "info", message: warnings[0] });
      }
      await setTeamsAndQueue(sessionId, teams);
      saveHostSession(sessionId, secret);
      setLastHostSession(readHostSession());
      history.pushState({}, "", `/h/${sessionId}?secret=${encodeURIComponent(secret)}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e: any) {
      setToast({ id: nanoid(), kind: "error", message: e?.message ?? "Failed to create session" });
    } finally {
      setCreatingSession(false);
    }
  };


  const setOtpAt = (idx: number, value: string) => {
    setViewerCode((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const focusOtp = (idx: number) => {
    otpRefs.current[idx]?.focus();
    otpRefs.current[idx]?.select();
  };

  const moveToViewer = async (candidate?: string) => {
    if (joining) return;
    const finalCode = (candidate ?? codeValue).toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(finalCode)) {
      setToast({ id: nanoid(), kind: "error", message: "Session code ต้องมี 6 ตัว" });
      return;
    }
    try {
      setJoining(true);
      const exists = await sessionExists(finalCode);
      if (!exists) {
        setToast({ id: nanoid(), kind: "error", message: "ไม่เจอ Session" });
        return;
      }
      history.pushState({}, "", `/s/${finalCode}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e: any) {
      setToast({ id: nanoid(), kind: "error", message: e?.message ?? "เช็ค Session ไม่สำเร็จ" });
    } finally {
      setJoining(false);
    }
  };

  useEffect(() => {
    if (mode === "viewer" && codeValue.length === 6 && /^[A-Z0-9]{6}$/.test(codeValue)) {
      void moveToViewer(codeValue);
    }
  }, [codeValue, mode]);

  useEffect(() => {
    if (!scanOpen) return;
    if (!("mediaDevices" in navigator)) {
      setScanError("อุปกรณ์นี้ไม่รองรับกล้อง");
      return;
    }

    let stream: MediaStream | null = null;
    let detector: BarcodeDetector | null = null;
    let timer: number | undefined;
    let canceled = false;
    let videoTrack: MediaStreamTrack | null = null;
    let imageCapture: ImageCapture | null = null;
    let jsQrDecoder: JsQrDecoder | null = null;
    const frameCanvas = document.createElement("canvas");
    const frameContext = frameCanvas.getContext("2d", { willReadFrequently: true });

    const detectFromSource = async () => {
      if (scanLockRef.current) return "";
      const videoEl = videoRef.current;
      if (!videoEl) return "";

      if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const direct = detector ? await detector.detect(videoEl) : [];
          const directRaw = direct[0]?.rawValue?.trim();
          if (directRaw) return directRaw;
        } catch {
          // fallback below
        }

        const width = videoEl.videoWidth;
        const height = videoEl.videoHeight;
        if (frameContext && width > 0 && height > 0) {
          frameCanvas.width = width;
          frameCanvas.height = height;
          frameContext.drawImage(videoEl, 0, 0, width, height);
          try {
            const byCanvas = detector ? await detector.detect(frameCanvas) : [];
            const canvasRaw = byCanvas[0]?.rawValue?.trim();
            if (canvasRaw) return canvasRaw;
          } catch {
            // fallback below
          }

          if (jsQrDecoder) {
            try {
              const imageData = frameContext.getImageData(0, 0, width, height);
              const qr = jsQrDecoder(imageData.data, width, height, { inversionAttempts: "attemptBoth" });
              const jsQrRaw = qr?.data?.trim();
              if (jsQrRaw) return jsQrRaw;
            } catch {
              // ignore jsQR frame errors
            }
          }
        }
      }

      if (imageCapture) {
        try {
          const bitmap = await (imageCapture as any).grabFrame();
          if (detector) {
            const byImageCapture = await detector.detect(bitmap);
            const raw = byImageCapture[0]?.rawValue?.trim();
            if (raw) return raw;
          }
          if (jsQrDecoder && frameContext) {
            const width = bitmap.width ?? 0;
            const height = bitmap.height ?? 0;
            if (width > 0 && height > 0) {
              frameCanvas.width = width;
              frameCanvas.height = height;
              frameContext.drawImage(bitmap, 0, 0, width, height);
              const imageData = frameContext.getImageData(0, 0, width, height);
              const qr = jsQrDecoder(imageData.data, width, height, { inversionAttempts: "attemptBoth" });
              return qr?.data?.trim() ?? "";
            }
          }
          return "";
        } catch {
          return "";
        }
      }
      return "";
    };

    const getRearCameraStream = async () => {
      const candidates: MediaStreamConstraints[] = [
        { video: { facingMode: { exact: "environment" } }, audio: false },
        { video: { facingMode: "environment" }, audio: false },
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        { video: true, audio: false },
      ];

      for (const constraints of candidates) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          // try next constraints
        }
      }
      throw new Error("camera_unavailable");
    };

    const start = async () => {
      try {
        stream = await getRearCameraStream();
        videoTrack = stream.getVideoTracks()[0] ?? null;
        if (videoTrack && "ImageCapture" in window) {
          imageCapture = new ImageCapture(videoTrack);
        }
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (canceled) return;
        setCameraReady(true);
        setScanError("");

        const BarcodeDetectorCtor = (globalThis as any).BarcodeDetector as
          | (new (options?: BarcodeDetectorOptions) => BarcodeDetector)
          | undefined;
        const supportsNativeQr = async () => {
          if (!BarcodeDetectorCtor) return false;
          const supportsFormat = typeof (BarcodeDetectorCtor as any).getSupportedFormats === "function"
            ? await (BarcodeDetectorCtor as any).getSupportedFormats()
            : [];
          return supportsFormat.length === 0 || supportsFormat.includes("qr_code");
        };

        if (await supportsNativeQr()) {
          detector = new BarcodeDetectorCtor!({ formats: ["qr_code"] });
        }

        jsQrDecoder = await loadJsQrDecoder();
        if (!detector && !jsQrDecoder) {
          setScanError("เบราว์เซอร์นี้ไม่รองรับการสแกน QR อัตโนมัติ");
          return;
        }
        timer = window.setInterval(async () => {
          if (scanLockRef.current) return;
          try {
            const raw = await detectFromSource();
            if (!raw) return;

            const parsed = extractCodeFromRaw(raw);
            if (!parsed) {
              setScanError("QR นี้ไม่มี Session code ที่ถูกต้อง");
              return;
            }

            scanLockRef.current = true;
            const next = parsed.split("");
            setViewerCode(next);
            setScanOpen(false);
          } catch {
            // ignore transient scan errors
          }
        }, 500);
      } catch {
        if (!canceled) setScanError("ไม่สามารถเปิดกล้องได้");
      }
    };

    void start();
    return () => {
      canceled = true;
      if (timer) window.clearInterval(timer);
      scanLockRef.current = false;
      setCameraReady(false);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [scanOpen]);

  if (mode === "create") {
    return (
      <ScreenShell
        header={<CompactBrandHeader onBack={() => setMode("home")} style={fadeInStyle(0)} />}
        bottomSlot={(
          <button
            type="button"
            disabled={!validCourts}
            onClick={() => setMode("players")}
            className="pointer-events-auto flex h-[100px] w-full items-center justify-center gap-3 rounded-[36px] bg-[#37B64B] px-6 text-[24px] font-medium leading-[30px] text-white shadow-[0_0_42px_rgba(55,182,75,0.26)] transition-transform active:scale-[0.99] disabled:opacity-50"
          >
            Continue
            <ArrowRightIcon />
          </button>
        )}
      >
        <div className="landing-scroll-pane landing-shadow-safe flex h-full flex-col pb-[calc(132px+max(16px,env(safe-area-inset-bottom)))] pt-[31px]">
          <section className="soft-fade-up max-w-[279px]" style={fadeInStyle(70)}>
            <h1 className="text-[48px] font-bold leading-[60px] tracking-[-0.03em] text-white">Add courts</h1>
            <p className="mt-0 text-[16px] font-normal leading-5 text-white">
              Choose how many courts you&apos;ll use for this session.
            </p>
          </section>

          <section
            className="soft-fade-up relative mt-5 overflow-hidden rounded-[36px] border border-white/5 px-[18px] py-[27px]"
            style={fadeInStyle(140)}
          >
            <span className="absolute inset-0 bg-white/[0.05]" aria-hidden="true" />
            <div className="relative flex min-h-[136px] items-center justify-between gap-3 px-[8px]">
              <button
                type="button"
                onClick={() => setCourtNumber(courtNumber - 1)}
                disabled={courtNumber <= 1}
                aria-label="Decrease courts"
                className="grid h-[60px] w-[61px] flex-none place-items-center rounded-[18px] border border-white/5 bg-white/5 text-white transition-transform active:scale-[0.97] disabled:opacity-30"
              >
                <MinusIcon />
              </button>

              <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-3 text-center">
                <div className="text-[80px] font-normal leading-[100px] tracking-[-0.04em] text-white">{courtNumber}</div>
                <div className="-mt-[3px] text-[18px] font-medium leading-[23px] text-white/20">
                  {courtNumber === 1 ? "Court" : "Courts"}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setCourtNumber(courtNumber + 1)}
                disabled={courtNumber >= 12}
                aria-label="Increase courts"
                className="grid h-[60px] w-[61px] flex-none place-items-center rounded-[18px] bg-[#37B64B] text-white transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <PlusIcon />
              </button>
            </div>
          </section>

          <div className="soft-fade-up mt-4 grid grid-cols-4 gap-2" style={fadeInStyle(210)}>
            {[1, 2, 3, 4].map((count) => {
              const active = courtNumber === count;
              return (
                <button
                  key={count}
                  type="button"
                  onClick={() => setCourtNumber(count)}
                  className={`flex h-[50px] items-center justify-center rounded-[18px] border border-white/5 px-2 text-[16px] font-medium leading-5 text-white transition-transform active:scale-[0.97] ${
                    active ? "bg-[#37B64B]" : "bg-white/5"
                  }`}
                >
                  {count} {count === 1 ? "Court" : "Courts"}
                </button>
              );
            })}
          </div>

          <div className="mt-auto min-h-[24px]" aria-hidden="true" />
        </div>
      </ScreenShell>
    );
  }

  if (mode === "players") {
    return (
      <ScreenShell
        header={<CompactBrandHeader onBack={() => setMode("create")} style={fadeInStyle(0)} />}
        bottomSlot={(
          <button
            type="button"
            disabled={!canCreateMatches}
            onClick={() => void createMatchSession()}
            className="pointer-events-auto flex h-[100px] w-full items-center justify-center gap-3 rounded-[36px] bg-[#37B64B] px-6 text-[24px] font-medium leading-[30px] text-white shadow-[0_0_42px_rgba(55,182,75,0.26)] transition-transform active:scale-[0.99] disabled:opacity-50"
          >
            {creatingSession ? "Creating..." : "Create matches"}
            <ArrowRightIcon />
          </button>
        )}
      >
        <div className="flex h-full min-h-0 flex-col pt-[31px]">
          <section className="soft-fade-up max-w-[320px]" style={fadeInStyle(70)}>
            <h1 className="text-[48px] font-bold leading-[60px] tracking-[-0.03em] text-white">Add player</h1>
            <p className="mt-0 text-[16px] font-normal leading-5 text-white">
              Add player for doubles matches.
            </p>
          </section>

          <form
            className="soft-fade-up mt-5 flex items-center gap-2"
            style={fadeInStyle(140)}
            onSubmit={(event) => {
              event.preventDefault();
              submitPlayerName();
            }}
          >
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Type names separated by spaces"
              className="h-[62px] min-w-0 flex-1 rounded-[20px] border border-white/5 bg-white/5 px-6 text-[16px] font-medium text-white outline-none placeholder:text-white/20"
            />
            <button
              type="submit"
              aria-label="Add player"
              className="grid h-[62px] w-[62px] flex-none place-items-center rounded-[20px] bg-[#37B64B] text-white transition-transform active:scale-[0.97]"
            >
              <PlusLargeIcon />
            </button>
          </form>

          <section className="soft-fade-up mt-6" style={fadeInStyle(210)}>
            <h2 className="text-[18px] font-medium leading-[23px] text-white">Recent add</h2>
            <div className="mt-4 overflow-x-auto pb-1">
              <div className="flex min-w-max gap-2 pr-4">
                {visibleRecentPlayers.map((player) => (
                  <button
                    key={player.name}
                    type="button"
                    onClick={() => {
                      addDraftPlayer({ name: player.name, avatarDataUrl: player.avatarDataUrl });
                    }}
                    className="flex h-[62px] items-center gap-4 rounded-[20px] border border-white/5 bg-white/5 px-4 text-left text-white transition-transform active:scale-[0.98]"
                  >
                    <AvatarBadge
                      name={player.name}
                      imageUrl={player.avatarDataUrl}
                      sizeClassName="h-10 w-10"
                      textClassName="text-[16px]"
                    />
                    <span className="text-[16px] font-medium leading-5">{player.name}</span>
                  </button>
                ))}
                {visibleRecentPlayers.length === 0 && (
                  <div className="flex h-[62px] items-center rounded-[20px] border border-white/5 bg-white/5 px-6 text-[14px] text-white/50">
                    No recent players yet
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="soft-fade-up mt-6 flex min-h-0 flex-1 flex-col overflow-hidden " style={fadeInStyle(280)}>
            <div className="flex items-center justify-between ">
              <h2 className="text-[18px] font-medium leading-[23px] text-white">Players ({draftPlayers.length})</h2>
              <button
                type="button"
                onClick={() => setDraftPlayers([])}
                className="text-[16px] font-medium leading-5 text-[#37B64B] transition-opacity active:opacity-80"
              >
                Clear all
              </button>
            </div>

            <div className="relative mt-4 min-h-0 flex-1">
              <div className="landing-scroll-pane landing-shadow-safe min-h-0 h-full flex-1">
                <div className="grid grid-cols-2 gap-4 pb-[176px]">
                  {draftPlayers.map((player) => (
                    <div
                      key={player.id}
                      className="flex min-h-[62px] items-center justify-between gap-3 rounded-[20px] border border-white/5 bg-white/5 px-4"
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <AvatarBadge
                          name={player.name}
                          imageUrl={player.avatarDataUrl}
                          sizeClassName="h-10 w-10"
                          textClassName="text-[16px]"
                        />
                        <span className="truncate text-[16px] font-medium leading-5 text-white">{player.name}</span>
                      </div>

                      <button
                        type="button"
                        aria-label={`Remove ${player.name}`}
                        onClick={() => setDraftPlayers((prev) => prev.filter((entry) => entry.id !== player.id))}
                        className="grid h-10 w-10 flex-none place-items-center rounded-[12px] border border-white/5 bg-white/5 text-white/20 transition-transform active:scale-[0.95]"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ))}
                  {draftPlayers.length === 0 && (
                    <div className="col-span-2 rounded-[20px] border border-dashed border-white/10 px-5 py-8 text-center text-[15px] text-white/45">
                      Add at least 4 players to create matches.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </ScreenShell>
    );
  }


  if (mode === "viewer") {
    return (
      <div className="mx-auto max-w-md p-4 space-y-3">
        <button className="text-xs font-semibold text-slate-700" onClick={() => setMode("home")}>
          &lt; Back
        </button>
        <Card>
          <CardHeader title="Join as Viewer" />
          <CardBody className="space-y-4">
            <div className="text-xs text-slate-500">Enter 6-digit session code</div>
            <div className="flex items-center justify-between gap-2">
              {viewerCode.map((v, idx) => (
                <input
                  key={idx}
                  value={v}
                  maxLength={1}
                  className="h-12 w-11 rounded-xl border-[1.5px] border-slate-200 text-center text-lg font-semibold uppercase"
                  onChange={(e) => {
                    const ch = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1);
                    setOtpAt(idx, ch);
                    if (ch && idx < 5) focusOtp(idx + 1);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace") {
                      if (viewerCode[idx]) {
                        setOtpAt(idx, "");
                        return;
                      }
                      if (idx > 0) {
                        setOtpAt(idx - 1, "");
                        focusOtp(idx - 1);
                        e.preventDefault();
                      }
                      return;
                    }

                    if (e.key === "ArrowLeft" && idx > 0) {
                      focusOtp(idx - 1);
                      e.preventDefault();
                    }

                    if (e.key === "ArrowRight" && idx < 5) {
                      focusOtp(idx + 1);
                      e.preventDefault();
                    }
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData
                      .getData("text")
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 6 - idx);
                    if (!pasted) return;
                    e.preventDefault();

                    setViewerCode((prev) => {
                      const next = [...prev];
                      for (let i = 0; i < pasted.length; i++) {
                        next[idx + i] = pasted[i];
                      }
                      return next;
                    });

                    const target = Math.min(idx + pasted.length, 5);
                    focusOtp(target);
                  }}
                  ref={(el) => { otpRefs.current[idx] = el; }}
                  id={`otp-${idx}`}
                />
              ))}
            </div>
            <Button variant="secondary" onClick={() => setScanOpen(true)}>
              เปิดกล้องสแกน QR
            </Button>
            <Button onClick={() => void moveToViewer()} disabled={codeValue.length !== 6 || joining}>
              Enter Viewer
            </Button>
          </CardBody>
        </Card>

        {scanOpen && (
          <Modal title="Scan Session QR" onClose={() => setScanOpen(false)}>
            <div className="space-y-2">
              <video ref={videoRef} className="w-full rounded-xl border-[1.5px] border-slate-200 bg-slate-900" playsInline muted />
              {!cameraReady && <div className="text-xs text-slate-500">กำลังเปิดกล้อง...</div>}
              {scanError && <div className="text-xs text-rose-600">{scanError}</div>}
              <div className="text-xs text-slate-500">นำ QR จากหน้า Host มาไว้ในกรอบภาพ</div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  if (mode === "home") {
    return (
      <ScreenShell
        backgroundImage={backgroundImage}
        header={<HeroBrandHeader style={fadeInStyle(0)} />}
        bottomSlot={(
          <div className="flex flex-col gap-4">
            {lastHostSession && (
              <button
                type="button"
                onClick={() => {
                  history.pushState({}, "", `/h/${lastHostSession.sessionId}?secret=${encodeURIComponent(lastHostSession.secret)}`);
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }}
                className="soft-fade-up group pointer-events-auto flex h-[70px] w-full items-center gap-4 rounded-[500px] border border-white/5 bg-[#37B64B]/20 px-4 py-[9px] text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-[10px] transition active:scale-[0.99]"
                style={fadeInStyle(70)}
                aria-label="Resume last session"
              >
                <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-black/5 text-white">
                  <ClockIcon />
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-bold leading-5 text-white">Resume last session</span>
                  <span className="mt-[2px] flex items-center gap-2.5 text-sm font-medium leading-[18px] text-white">
                    <span>2 courts</span>
                    <span className="h-1 w-1 rounded-full bg-white" />
                    <span>8 players</span>
                  </span>
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setDraftPlayers([]);
                setPlayerName("");
                setMode("create");
              }}
              className="soft-fade-up pointer-events-auto flex h-[115px] w-full items-center justify-center overflow-hidden rounded-[36px] border border-black/5 bg-[#37B64B] px-6 text-[48px] font-bold leading-[60px] text-white transition-transform active:scale-[0.99]"
              style={fadeInStyle(lastHostSession ? 140 : 70)}
            >
              New Match
            </button>

            <button
              type="button"
              onClick={() => setMode("viewer")}
              className="soft-fade-up pointer-events-auto flex h-[70px] w-full items-center justify-center rounded-[500px] border border-[#37B64B] bg-black/20 px-6 text-2xl font-medium leading-[30px] text-white backdrop-blur-[10px] transition active:scale-[0.99]"
              style={fadeInStyle(lastHostSession ? 210 : 140)}
            >
              Join session
            </button>
          </div>
        )}
      >
        <main className="flex h-full min-h-0 flex-col pb-[calc(217px+max(16px,env(safe-area-inset-bottom)))]" />
      </ScreenShell>
    );
  }

  return null;
}

function ClockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 38 38" fill="none" aria-hidden="true">
      <circle cx="19" cy="19" r="15.5" stroke="currentColor" strokeWidth="4" />
      <path d="M19 10.5V20L25.2 26.2" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M10.75 4.5L6.25 9L10.75 13.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M4 11H18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M4 11H18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M11 4V18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function PlusLargeIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <path d="M13 5V21" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M5 13H21" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M6 6L16 16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 6L6 16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <path d="M5 15H25" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M16 6L25 15L16 24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function extractCodeFromRaw(raw: string) {
  const direct = raw.toUpperCase().match(/^[A-Z0-9]{6}$/)?.[0];
  if (direct) return direct;

  try {
    const url = new URL(raw);
    const pathMatch = url.pathname.match(/\/s\/([A-Z0-9]{6})/i)?.[1];
    if (pathMatch) return pathMatch.toUpperCase();
  } catch {
    // ignore malformed URL
  }

  const fallback = raw.toUpperCase().match(/([A-Z0-9]{6})/)?.[1];
  return fallback ?? "";
}

function ScreenShell(props: { children: ReactNode; header: ReactNode; backgroundImage?: string; bottomSlot?: ReactNode }) {
  return (
    <div
      className="app-screen-shell bg-[#0D2318] bg-cover bg-center bg-no-repeat text-white"
      style={props.backgroundImage ? { backgroundImage: `url(${props.backgroundImage})` } : undefined}
    >
      <div className="relative mx-auto flex h-full w-full max-w-[430px] flex-col px-4">
        <div className="z-20 shrink-0 pt-[max(16px,env(safe-area-inset-top))]">{props.header}</div>
        <div className="min-h-0 flex-1">{props.children}</div>
        {props.bottomSlot && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#0D2318] via-[#0D2318] to-[#0D2318]/0 px-4 pt-8 pb-[max(16px,env(safe-area-inset-bottom))]">
            <div className="landing-shadow-safe">
              {props.bottomSlot}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompactBrandHeader(props: { onBack: () => void; style?: CSSProperties }) {
  return (
    <div className="soft-fade-up relative flex h-9 items-center justify-center" style={props.style}>
      <button
        type="button"
        onClick={props.onBack}
        aria-label="Back"
        className="absolute left-0 grid h-9 w-9 place-items-center rounded-xl border border-[#37B64B]/5 bg-white/5 text-white transition-transform active:scale-[0.97]"
      >
        <BackIcon />
      </button>

      <div className="flex items-center gap-2">
        <img src={courtMateLogo} alt="CourtMate" className="h-[33px] w-[33px]" />
        <div className="text-[18.8px] font-semibold leading-6 tracking-[-0.02em] text-white">CourtMate</div>
      </div>
    </div>
  );
}

function HeroBrandHeader(props: { style?: CSSProperties }) {
  return (
    <header className="soft-fade-up flex h-14 items-center gap-3.5" style={props.style}>
      <img src={courtMateLogo} alt="CourtMate" className="h-14 w-14 object-contain" />
      <div className="text-[32px] font-semibold leading-10 text-white">CourtMate</div>
    </header>
  );
}
