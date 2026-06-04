import CornerKit from "@cornerkit/core";

const CORNER_SMOOTHING = 0.85;
const BUTTON_RADIUS = 12;
const RADIUS_EPSILON = 0.25;

type CornerRadii = {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
};

type ManagedEntry = {
  mode: "cornerkit" | "custom";
  key: string;
  resizeObserver?: ResizeObserver;
};

type CornerMetrics = {
  radius: number;
  p: number;
  a: number;
  b: number;
  c: number;
  d: number;
  arc: number;
};

export function installCornerSmoothing() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const cornerKit = new CornerKit({ smoothing: CORNER_SMOOTHING });
  const managed = new Map<HTMLElement, ManagedEntry>();
  let frameId: number | null = null;
  let disposed = false;

  const cleanupElement = (element: HTMLElement) => {
    const entry = managed.get(element);
    if (!entry) return;

    entry.resizeObserver?.disconnect();
    if (entry.mode === "cornerkit") {
      try {
        cornerKit.remove(element);
      } catch {
        // Element may already be detached or unmanaged by CornerKit.
      }
    } else {
      element.style.clipPath = "";
    }

    managed.delete(element);
  };

  const applyCustomClipPath = (element: HTMLElement, radii: CornerRadii) => {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width < 1 || height < 1) return;

    element.style.clipPath = `path('${createSquirclePath(width, height, radii, CORNER_SMOOTHING)}')`;
  };

  const applyManagedCustomClipPath = (element: HTMLElement, radii: CornerRadii, key: string) => {
    applyCustomClipPath(element, radii);

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        applyCustomClipPath(element, readCornerRadii(element));
      });
      resizeObserver.observe(element);
    }

    managed.set(element, { mode: "custom", key, resizeObserver });
  };

  const syncElement = (element: HTMLElement) => {
    if (disposed) return;
    if (shouldSkipElement(element)) {
      cleanupElement(element);
      return;
    }

    normalizeButtonRadius(element);

    const radii = readCornerRadii(element);
    if (!hasRoundedCorner(radii)) {
      cleanupElement(element);
      return;
    }

    const key = createRadiusKey(radii);
    const existing = managed.get(element);

    if (isUniformRadius(radii)) {
      const radius = radii.topLeft;
      const nextKey = `cornerkit:${radius.toFixed(2)}`;

      if (existing?.mode === "cornerkit" && existing.key === nextKey) return;
      if (existing?.mode === "custom") cleanupElement(element);

      try {
        if (managed.has(element)) {
          cornerKit.update(element, { radius, smoothing: CORNER_SMOOTHING });
        } else {
          cornerKit.apply(element, { radius, smoothing: CORNER_SMOOTHING });
        }
        managed.set(element, { mode: "cornerkit", key: nextKey });
      } catch {
        cleanupElement(element);
        applyManagedCustomClipPath(element, radii, key);
      }
      return;
    }

    if (existing?.mode === "cornerkit") cleanupElement(element);
    if (existing?.mode === "custom" && existing.key === key) {
      applyCustomClipPath(element, radii);
      return;
    }

    existing?.resizeObserver?.disconnect();
    applyManagedCustomClipPath(element, radii, key);
  };

  const scanDocument = () => {
    if (disposed || !document.body) return;

    for (const element of Array.from(managed.keys())) {
      if (!element.isConnected) cleanupElement(element);
    }

    syncElement(document.body);
    for (const element of document.body.querySelectorAll("*")) {
      if (isHtmlElement(element)) syncElement(element);
    }
  };

  const scheduleScan = () => {
    if (disposed || frameId != null) return;
    const run = () => {
      frameId = null;
      scanDocument();
    };

    if (typeof window.requestAnimationFrame === "function") {
      frameId = window.requestAnimationFrame(run);
      return;
    }

    frameId = window.setTimeout(run, 0);
  };

  const mutationObserver =
    typeof MutationObserver !== "undefined" ? new MutationObserver(scheduleScan) : undefined;
  mutationObserver?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
    childList: true,
    subtree: true,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  } else {
    scheduleScan();
  }

  scanDocument();
  window.setTimeout(scanDocument, 0);
  window.setTimeout(scanDocument, 100);
  window.addEventListener("load", scheduleScan);

  return () => {
    disposed = true;
    if (frameId != null) {
      if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frameId);
      else window.clearTimeout(frameId);
    }
    mutationObserver?.disconnect();
    window.removeEventListener("load", scheduleScan);
    for (const element of Array.from(managed.keys())) cleanupElement(element);
    cornerKit.destroy();
  };
}

function shouldSkipElement(element: HTMLElement) {
  return (
    element === document.documentElement ||
    element.tagName === "SCRIPT" ||
    element.tagName === "STYLE" ||
    element.tagName === "LINK" ||
    element.tagName === "META" ||
    element.hasAttribute("data-cornerkit-ignore")
  );
}

function isHtmlElement(element: Element): element is HTMLElement {
  return "offsetWidth" in element && "style" in element && "tagName" in element;
}

function normalizeButtonRadius(element: HTMLElement) {
  if (
    element.tagName !== "BUTTON" ||
    element.hasAttribute("data-cornerkit-preserve-radius") ||
    element.closest("[data-cornerkit-preserve-button-radius]")
  ) {
    return;
  }

  if (element.style.borderRadius !== `${BUTTON_RADIUS}px`) {
    element.style.borderRadius = `${BUTTON_RADIUS}px`;
  }
}

function readCornerRadii(element: HTMLElement): CornerRadii {
  const style = window.getComputedStyle(element);
  const width = element.offsetWidth;
  const height = element.offsetHeight;

  return {
    topLeft: parseRadius(style.borderTopLeftRadius, width, height),
    topRight: parseRadius(style.borderTopRightRadius, width, height),
    bottomRight: parseRadius(style.borderBottomRightRadius, width, height),
    bottomLeft: parseRadius(style.borderBottomLeftRadius, width, height),
  };
}

function parseRadius(value: string, width: number, height: number) {
  const token = value.trim().split(/\s+/)[0] ?? "0";
  const parsed = Number.parseFloat(token);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (token.endsWith("%")) return (Math.min(width, height) * parsed) / 100;
  return parsed;
}

function hasRoundedCorner(radii: CornerRadii) {
  return Object.values(radii).some((radius) => radius > RADIUS_EPSILON);
}

function isUniformRadius(radii: CornerRadii) {
  const values = Object.values(radii);
  return Math.max(...values) - Math.min(...values) <= RADIUS_EPSILON;
}

function createRadiusKey(radii: CornerRadii) {
  return `custom:${radii.topLeft.toFixed(2)}:${radii.topRight.toFixed(2)}:${radii.bottomRight.toFixed(2)}:${radii.bottomLeft.toFixed(2)}`;
}

function createSquirclePath(width: number, height: number, radii: CornerRadii, smoothing: number) {
  const scaled = scaleRadii(width, height, radii, smoothing);
  const topLeft = cornerMetrics(scaled.topLeft, smoothing);
  const topRight = cornerMetrics(scaled.topRight, smoothing);
  const bottomRight = cornerMetrics(scaled.bottomRight, smoothing);
  const bottomLeft = cornerMetrics(scaled.bottomLeft, smoothing);

  return [
    `M ${round(topLeft.p)} 0`,
    `L ${round(width - topRight.p)} 0`,
    drawTopRightCorner(topRight),
    `L ${round(width)} ${round(height - bottomRight.p)}`,
    drawBottomRightCorner(bottomRight),
    `L ${round(bottomLeft.p)} ${round(height)}`,
    drawBottomLeftCorner(bottomLeft),
    `L 0 ${round(topLeft.p)}`,
    drawTopLeftCorner(topLeft),
    "Z",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function scaleRadii(width: number, height: number, radii: CornerRadii, smoothing: number): CornerRadii {
  const pFactor = 1 + Math.max(0, Math.min(1, smoothing));
  const scale = Math.min(
    1,
    ratio(width, pFactor * (radii.topLeft + radii.topRight)),
    ratio(width, pFactor * (radii.bottomLeft + radii.bottomRight)),
    ratio(height, pFactor * (radii.topLeft + radii.bottomLeft)),
    ratio(height, pFactor * (radii.topRight + radii.bottomRight)),
  );

  return {
    topLeft: radii.topLeft * scale,
    topRight: radii.topRight * scale,
    bottomRight: radii.bottomRight * scale,
    bottomLeft: radii.bottomLeft * scale,
  };
}

function ratio(size: number, used: number) {
  return used > 0 ? size / used : 1;
}

function cornerMetrics(radius: number, smoothing: number): CornerMetrics {
  const clampedSmoothing = Math.max(0, Math.min(1, smoothing));
  if (radius <= RADIUS_EPSILON) {
    return { radius: 0, p: 0, a: 0, b: 0, c: 0, d: 0, arc: 0 };
  }

  const p = (1 + clampedSmoothing) * radius;
  const arcAngle = 90 * (1 - clampedSmoothing);
  const arc = Math.sin(toRadians(arcAngle / 2)) * radius * Math.sqrt(2);
  const controlAngle = 45 * clampedSmoothing;
  const c = radius * Math.tan(toRadians((90 - arcAngle) / 4)) * Math.cos(toRadians(controlAngle));
  const d = c * Math.tan(toRadians(controlAngle));
  const b = Math.max(0, (p - arc - c - d) / 3);

  return {
    radius,
    p,
    a: 2 * b,
    b,
    c,
    d,
    arc,
  };
}

function drawTopRightCorner(corner: CornerMetrics) {
  if (corner.radius === 0) return "";
  return [
    `c ${round(corner.a)} 0 ${round(corner.a + corner.b)} 0 ${round(corner.a + corner.b + corner.c)} ${round(corner.d)}`,
    `a ${round(corner.radius)} ${round(corner.radius)} 0 0 1 ${round(corner.arc)} ${round(corner.arc)}`,
    `c ${round(corner.d)} ${round(corner.c)} ${round(corner.d)} ${round(corner.b + corner.c)} ${round(corner.d)} ${round(corner.a + corner.b + corner.c)}`,
  ].join(" ");
}

function drawBottomRightCorner(corner: CornerMetrics) {
  if (corner.radius === 0) return "";
  return [
    `c 0 ${round(corner.a)} 0 ${round(corner.a + corner.b)} ${round(-corner.d)} ${round(corner.a + corner.b + corner.c)}`,
    `a ${round(corner.radius)} ${round(corner.radius)} 0 0 1 ${round(-corner.arc)} ${round(corner.arc)}`,
    `c ${round(-corner.c)} ${round(corner.d)} ${round(-corner.b - corner.c)} ${round(corner.d)} ${round(-corner.a - corner.b - corner.c)} ${round(corner.d)}`,
  ].join(" ");
}

function drawBottomLeftCorner(corner: CornerMetrics) {
  if (corner.radius === 0) return "";
  return [
    `c ${round(-corner.a)} 0 ${round(-corner.a - corner.b)} 0 ${round(-corner.a - corner.b - corner.c)} ${round(-corner.d)}`,
    `a ${round(corner.radius)} ${round(corner.radius)} 0 0 1 ${round(-corner.arc)} ${round(-corner.arc)}`,
    `c ${round(-corner.d)} ${round(-corner.c)} ${round(-corner.d)} ${round(-corner.b - corner.c)} ${round(-corner.d)} ${round(-corner.a - corner.b - corner.c)}`,
  ].join(" ");
}

function drawTopLeftCorner(corner: CornerMetrics) {
  if (corner.radius === 0) return "";
  return [
    `c 0 ${round(-corner.a)} 0 ${round(-corner.a - corner.b)} ${round(corner.d)} ${round(-corner.a - corner.b - corner.c)}`,
    `a ${round(corner.radius)} ${round(corner.radius)} 0 0 1 ${round(corner.arc)} ${round(-corner.arc)}`,
    `c ${round(corner.c)} ${round(-corner.d)} ${round(corner.b + corner.c)} ${round(-corner.d)} ${round(corner.a + corner.b + corner.c)} ${round(-corner.d)}`,
  ].join(" ");
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
