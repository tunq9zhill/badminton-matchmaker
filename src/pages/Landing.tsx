import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { createSession } from "../features/session/api";
import { buildHostLink, buildViewerLink } from "../app/links";
import { useAppStore } from "../app/store";
import { nanoid } from "nanoid";
import { copyToClipboard } from "../app/clipboard";

export function Landing() {
  const [courtCount, setCourtCount] = useState("2");
  const [oddMode, setOddMode] = useState<"three_player_rotation" | "none">("three_player_rotation");
  const setToast = useAppStore((s) => s.setToast);

  const validCourts = useMemo(() => {
    const n = Number(courtCount);
    return Number.isFinite(n) && n >= 1 && n <= 12;
  }, [courtCount]);

  return (
    <div className="mx-auto max-w-md p-4 space-y-3">
      <div className="pt-2">
        <div className="text-xl font-bold">Badminton Matchmaker</div>
        <div className="text-sm text-slate-600">Host on one phone • viewers via share link • strict no double-booking</div>
      </div>

      <Card>
        <CardHeader title="Create a Session" />
        <CardBody className="space-y-3">
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">Courts</div>
            <Input value={courtCount} onChange={setCourtCount} placeholder="e.g. 3" />
            <div className="text-xs text-slate-500 mt-1">1–12</div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-600">Odd Player Mode</div>
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded-xl border px-3 py-3 text-sm font-semibold ${oddMode==="three_player_rotation"?"bg-slate-900 text-white border-slate-900":"bg-white border-slate-200"}`}
                onClick={()=>setOddMode("three_player_rotation")}
              >
                3-player rotation team
              </button>
              <button
                className={`flex-1 rounded-xl border px-3 py-3 text-sm font-semibold ${oddMode==="none"?"bg-slate-900 text-white border-slate-900":"bg-white border-slate-200"}`}
                onClick={()=>setOddMode("none")}
              >
                None
              </button>
            </div>
          </div>

          <div className="mt-2 text-xs text-slate-600 leading-relaxed">
            <div className="font-semibold text-slate-700">3-player rotation team คืออะไร?</div>
            <div>
              ถ้าผู้เล่นเป็นเลขคี่ ระบบจะมีทีมหนึ่งที่มี 3 คน โดยแต่ละแมตช์จะเลือกลงสนามครั้งละ 2 คน
              เพื่อให้ทุกคนได้เล่นหมุนเวียนอย่างยุติธรรม
            </div>
          </div>

          <Button
            disabled={!validCourts}
            onClick={async () => {
              try {
                const { sessionId, secret } = await createSession({
                  courtCount: Number(courtCount),
                  oddMode,
                });

                const origin = location.origin;
                const host = buildHostLink(origin, sessionId, secret);
                const viewer = buildViewerLink(origin, sessionId);

                // ✅ iOS-friendly: share -> copy -> prompt fallback
                let copied = false;

                if ((navigator as any).share) {
                  try {
                    await (navigator as any).share({ title: "Host Link", url: host });
                    copied = true; // ถือว่าแชร์สำเร็จ = ส่งต่อได้
                  } catch {
                    // ignore
                  }
                }

                if (!copied) copied = await copyToClipboard(host);

                if (!copied) {
                  // ✅ fallback ที่ชัวร์สุดบน iPhone: ให้ผู้ใช้กดค้าง copy เอง
                  window.prompt("คัดลอกลิงก์ Host:", host);
                } else {
                  setToast({ id: nanoid(), kind: "success", message: "คัดลอก/แชร์ลิงก์ Host แล้ว" });
                }

                history.pushState({}, "", `/h/${sessionId}?secret=${encodeURIComponent(secret)}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
                console.log({ host, viewer });
              } catch (e: any) {
                setToast({ id: nanoid(), kind: "error", message: e?.message ?? "Failed to create session" });
              }
            }}
          >
            Create & Copy Host Link
          </Button>
          <div className="text-xs text-slate-500">
            Tip: Host link includes secret; viewer link doesn’t. Only the host device (anonymous UID) can write.
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Join as Viewer" />
        <CardBody className="text-sm text-slate-600">
          Open a viewer link like <span className="font-mono">/s/SESSION_ID</span>.
        </CardBody>
      </Card>
    </div>
  );
}
