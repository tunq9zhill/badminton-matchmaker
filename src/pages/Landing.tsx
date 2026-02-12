import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { createSession, sessionExists } from "../features/session/api";
import { useAppStore } from "../app/store";
import { nanoid } from "nanoid";

const slides = [
  "สร้างห้อง Host ได้ทันที",
  "Viewer ใส่ Session Code แบบ OTP",
  "ติดตามผลแข่งและตารางสถิติแบบสด",
];

export function Landing() {
  const [courtCount, setCourtCount] = useState("2");
  const [mode, setMode] = useState<"menu" | "host" | "viewer">("menu");
  const [viewerCode, setViewerCode] = useState(Array(6).fill(""));
  const [slideIdx, setSlideIdx] = useState(0);
  const setToast = useAppStore((s) => s.setToast);

  useEffect(() => {
    const timer = setInterval(() => setSlideIdx((s) => (s + 1) % slides.length), 2200);
    return () => clearInterval(timer);
  }, []);

  const validCourts = useMemo(() => {
    const n = Number(courtCount);
    return Number.isFinite(n) && n >= 1 && n <= 12;
  }, [courtCount]);

  const sessionCode = viewerCode.join("").toUpperCase();

  return (
    <div className="mx-auto max-w-md p-4 space-y-3">
      <div className="pt-2 space-y-1">
        <div className="text-xl font-bold">Badminton Matchmaker</div>
        <div className="text-sm text-slate-600">Session code 6 ตัว สำหรับ Host และ Viewer</div>
      </div>

      <Card>
        <CardBody>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex transition-transform duration-500" style={{ transform: `translateX(-${slideIdx * 100}%)` }}>
              {slides.map((slide) => (
                <div key={slide} className="w-full shrink-0 px-4 py-5 text-sm font-semibold text-slate-700">
                  ✨ {slide}
                </div>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      {mode === "menu" && (
        <Card>
          <CardHeader title="เริ่มต้น" />
          <CardBody className="space-y-2">
            <Button onClick={() => setMode("host")}>Create host</Button>
            <Button variant="secondary" onClick={() => setMode("viewer")}>Viewer</Button>
          </CardBody>
        </Card>
      )}

      {mode === "host" && (
        <Card>
          <CardHeader title="Create a Session" />
          <CardBody className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Courts</div>
              <Input value={courtCount} onChange={setCourtCount} placeholder="e.g. 3" />
            </div>
            <Button
              disabled={!validCourts}
              onClick={async () => {
                try {
                  const { sessionId, secret } = await createSession({ courtCount: Number(courtCount) });
                  history.pushState({}, "", `/h/${sessionId}?secret=${encodeURIComponent(secret)}`);
                  window.dispatchEvent(new PopStateEvent("popstate"));
                } catch (e: any) {
                  setToast({ id: nanoid(), kind: "error", message: e?.message ?? "Failed to create session" });
                }
              }}
            >
              Create
            </Button>
            <button className="text-xs font-semibold text-slate-700" onClick={() => setMode("menu")}>ย้อนกลับ</button>
          </CardBody>
        </Card>
      )}

      {mode === "viewer" && (
        <Card>
          <CardHeader title="Join Viewer" />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-6 gap-2">
              {viewerCode.map((char, idx) => (
                <input
                  key={idx}
                  value={char}
                  maxLength={1}
                  className="h-11 rounded-xl border border-slate-200 text-center text-lg font-bold uppercase"
                  onChange={(e) => {
                    const next = [...viewerCode];
                    next[idx] = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
                    setViewerCode(next);
                    if (e.target.value && idx < 5) {
                      (document.getElementById(`otp-${idx + 1}`) as HTMLInputElement | null)?.focus();
                    }
                  }}
                  id={`otp-${idx}`}
                />
              ))}
            </div>
            <Button
              disabled={sessionCode.length !== 6}
              onClick={async () => {
                const exists = await sessionExists(sessionCode);
                if (!exists) {
                  setToast({ id: nanoid(), kind: "error", message: "Session code ไม่ถูกต้อง" });
                  return;
                }
                history.pushState({}, "", `/s/${sessionCode}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            >
              Enter Viewer
            </Button>
            <button className="text-xs font-semibold text-slate-700" onClick={() => setMode("menu")}>ย้อนกลับ</button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
