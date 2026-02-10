import { useEffect, useMemo, useState } from "react";
import { parseRoute, type Route } from "./routes";
import { Landing } from "../pages/Landing";
import { Host } from "../pages/Host";
import { Viewer } from "../pages/Viewer";
import { NotFound } from "../pages/NotFound";
import { Toast } from "../ui/Toast";
import { useAppStore } from "./store";

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname, location.search));
  const toast = useAppStore((s) => s.toast);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname, location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
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
      {toast && <Toast toast={toast} />}
    </div>
  );
}
