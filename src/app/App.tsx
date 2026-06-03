import { useEffect, useMemo, useState } from "react";
import { parseRoute, type Route } from "./routes";
import { Landing } from "../pages/Landing";
import { Host } from "../pages/Host";
import { Viewer } from "../pages/Viewer";
import { NotFound } from "../pages/NotFound";
import { Toast } from "../ui/Toast";
import { useAppStore } from "./store";
import { PwaInstallPrompt } from "../ui/PwaInstallPrompt";

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname, location.search));
  const toast = useAppStore((s) => s.toast);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname, location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(hover: none) and (pointer: coarse)");
    const syncViewportHeight = () => {
      if (!mobileQuery.matches) {
        document.documentElement.style.removeProperty("--app-viewport-height");
        return;
      }

      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-viewport-height", `${height}px`);
    };

    syncViewportHeight();
    if (typeof mobileQuery.addEventListener === "function") {
      mobileQuery.addEventListener("change", syncViewportHeight);
    } else {
      mobileQuery.addListener(syncViewportHeight);
    }
    window.addEventListener("resize", syncViewportHeight);
    window.visualViewport?.addEventListener("resize", syncViewportHeight);

    return () => {
      document.documentElement.style.removeProperty("--app-viewport-height");
      if (typeof mobileQuery.removeEventListener === "function") {
        mobileQuery.removeEventListener("change", syncViewportHeight);
      } else {
        mobileQuery.removeListener(syncViewportHeight);
      }
      window.removeEventListener("resize", syncViewportHeight);
      window.visualViewport?.removeEventListener("resize", syncViewportHeight);
    };
  }, []);

  useEffect(() => {
    const isMobile = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (!isMobile) return;

    try {
      const orientation = screen.orientation as (ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>;
      }) | undefined;
      orientation?.lock?.call(orientation, "portrait-primary")?.catch(() => {});
    } catch {
      // Browsers that do not allow programmatic orientation locking still use the manifest setting.
    }
  }, []);

  const page = useMemo(() => {
    if (route.name === "landing") return <Landing />;
    if (route.name === "host") return <Host sessionId={route.sessionId} secret={route.secret} />;
    if (route.name === "viewer") return <Viewer sessionId={route.sessionId} />;
    return <NotFound />;
  }, [route]);

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      {page}
      {toast && <Toast key={toast.id} toast={toast} />}
      <PwaInstallPrompt />
    </div>
  );
}
