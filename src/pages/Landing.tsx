import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { createSession, sessionExists } from "../features/session/api";
import { useAppStore } from "../app/store";
import { nanoid } from "nanoid";
import { Modal } from "../ui/Modal";

type LandingMode = "home" | "create" | "viewer";

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

const carouselImages = [
  "./public/ImageCarousel/1.jpg",
  "./public/ImageCarousel/2.jpg",
  "./public/ImageCarousel/3.jpg",
  "./public/ImageCarousel/4.jpg",
  "./public/ImageCarousel/5.jpg",
  "./public/ImageCarousel/6.jpg",
  "./public/ImageCarousel/7.jpg",
  "./public/ImageCarousel/8.jpg",
  "./public/ImageCarousel/9.jpg",
  "./public/ImageCarousel/10.jpg",
];

export function Landing() {
  const [mode, setMode] = useState<LandingMode>("home");
  const [courtCount, setCourtCount] = useState("2");
  const [viewerCode, setViewerCode] = useState(Array(6).fill(""));
  const [slideIndex, setSlideIndex] = useState(0);
  const [joining, setJoining] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const setToast = useAppStore((s) => s.setToast);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const scanLockRef = useRef(false);

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
              <video ref={videoRef} className="w-full rounded-xl border border-slate-200 bg-slate-900" playsInline muted />
              {!cameraReady && <div className="text-xs text-slate-500">กำลังเปิดกล้อง...</div>}
              {scanError && <div className="text-xs text-rose-600">{scanError}</div>}
              <div className="text-xs text-slate-500">นำ QR จากหน้า Host มาไว้ในกรอบภาพ</div>
            </div>
          </Modal>
        )}
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
          <Button onClick={() => setMode("create")}>Create Court</Button>
          <Button variant="secondary" onClick={() => setMode("viewer")}>Viewer</Button>
        </CardBody>
      </Card>
    </div>
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
