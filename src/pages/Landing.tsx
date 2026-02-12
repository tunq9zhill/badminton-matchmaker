import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { createSession } from "../features/session/api";
import { useAppStore } from "../app/store";
import { nanoid } from "nanoid";

type LandingMode = "home" | "create" | "viewer";

const carouselImages = [
  "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1486286701208-1d58e9338013?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1534158914592-062992fbe900?auto=format&fit=crop&w=1200&q=80",
];

export function Landing() {
  const [mode, setMode] = useState<LandingMode>("home");
  const [courtCount, setCourtCount] = useState("2");
  const [viewerCode, setViewerCode] = useState(Array(6).fill(""));
  const [slideIndex, setSlideIndex] = useState(0);
  const setToast = useAppStore((s) => s.setToast);

  useEffect(() => {
    if (mode !== "home") return;
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % carouselImages.length);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [mode]);

  const validCourts = useMemo(() => {
    const n = Number(courtCount);
    return Number.isFinite(n) && n >= 1 && n <= 12;
  }, [courtCount]);

  const codeValue = viewerCode.join("");

  const moveToViewer = () => {
    if (!/^[A-Z0-9]{6}$/.test(codeValue)) {
      setToast({ id: nanoid(), kind: "error", message: "Session code ต้องมี 6 ตัว" });
      return;
    }
    history.pushState({}, "", `/s/${codeValue}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  if (mode === "create") {
    return (
      <div className="mx-auto max-w-md p-4 space-y-3">
        <button className="text-xs font-semibold text-slate-700" onClick={() => setMode("home")}>
          ← Back
        </button>
        <Card>
          <CardHeader title="Create a Session" />
          <CardBody className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Courts</div>
              <Input value={courtCount} onChange={setCourtCount} placeholder="e.g. 3" />
              <div className="text-xs text-slate-500 mt-1">1–12</div>
            </div>
            <Button
              disabled={!validCourts}
              onClick={async () => {
                try {
                  const { sessionId, secret } = await createSession({
                    courtCount: Number(courtCount),
                    oddMode: "three_player_rotation",
                  });
                  history.pushState({}, "", `/h/${sessionId}?secret=${encodeURIComponent(secret)}`);
                  window.dispatchEvent(new PopStateEvent("popstate"));
                } catch (e: any) {
                  setToast({ id: nanoid(), kind: "error", message: e?.message ?? "Failed to create session" });
                }
              }}
            >
              Create
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (mode === "viewer") {
    return (
      <div className="mx-auto max-w-md p-4 space-y-3">
        <button className="text-xs font-semibold text-slate-700" onClick={() => setMode("home")}>
          ← Back
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
                  className="h-12 w-11 rounded-xl border border-slate-200 text-center text-lg font-semibold uppercase"
                  onChange={(e) => {
                    const ch = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                    const next = [...viewerCode];
                    next[idx] = ch;
                    setViewerCode(next);
                    if (ch && idx < 5) {
                      (document.getElementById(`otp-${idx + 1}`) as HTMLInputElement | null)?.focus();
                    }
                  }}
                  id={`otp-${idx}`}
                />
              ))}
            </div>
            <Button onClick={moveToViewer} disabled={codeValue.length !== 6}>
              Enter Viewer
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-4 space-y-3">
      <div className="pt-2">
        <div className="text-xl font-bold">Badminton Matchmaker</div>
        <div className="text-sm text-slate-600">Choose your mode to get started</div>
      </div>

      <Card>
        <CardBody>
          <div className="relative h-40 overflow-hidden rounded-2xl">
            <div
              className="flex h-full transition-transform duration-700"
              style={{ transform: `translateX(-${slideIndex * 100}%)` }}
            >
              {carouselImages.map((image) => (
                <img key={image} src={image} alt="badminton" className="h-full w-full flex-shrink-0 object-cover" />
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <Button onClick={() => setMode("create")}>Create host</Button>
          <Button variant="secondary" onClick={() => setMode("viewer")}>Viewer</Button>
        </CardBody>
      </Card>
    </div>
  );
}
