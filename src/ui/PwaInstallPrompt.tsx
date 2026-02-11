import { useEffect, useMemo, useState } from "react";
import { Button } from "./Button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "pwa-install-prompt-dismissed-at";
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function isStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  const showIosGuide = useMemo(() => isIos() && !deferredPrompt, [deferredPrompt]);

  useEffect(() => {
    if (isStandaloneMode()) {
      return;
    }

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? "0");
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) {
      return;
    }

    let timeoutId: number | null = null;

    const scheduleOpen = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(() => setVisible(true), 3000);
    };

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      scheduleOpen();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    if (isIos()) {
      scheduleOpen();
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const onClose = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const onInstall = async () => {
    if (!deferredPrompt) {
      onClose();
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;

    if (choice.outcome === "accepted") {
      localStorage.removeItem(DISMISS_KEY);
    } else {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }

    setDeferredPrompt(null);
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-3 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-4">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="text-sm font-semibold text-slate-900">ติดตั้งแอปไว้ที่หน้าจอหลัก</div>
        <div className="mt-2 text-sm text-slate-600 leading-relaxed">
          เปิดใช้งานแบบแอปเต็มจอ เข้าใช้งานไวขึ้น และใช้งานได้สะดวกจาก Home Screen
          {showIosGuide ? " โดยกดปุ่ม Share แล้วเลือก Add to Home Screen" : ""}
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="!w-auto flex-1" onClick={onClose}>
            ไว้ทีหลัง
          </Button>
          <Button className="!w-auto flex-1" onClick={onInstall}>
            ติดตั้ง
          </Button>
        </div>
      </div>
    </div>
  );
}
