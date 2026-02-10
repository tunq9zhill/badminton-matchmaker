import { create } from "zustand";

type Lang = "th" | "en";

const dict = {
  th: {
    host: "โฮสต์",
    viewer: "ผู้ชม",
    connected: "เชื่อมต่อแล้ว",
    offline: "ออฟไลน์",
    connecting: "กำลังเชื่อมต่อ",
    readonly: "ดูอย่างเดียว",
    players: "ผู้เล่น",
    add: "เพิ่ม",
    delete: "ลบ",
    start: "เริ่ม (กดครั้งเดียว)",
    courts: "คอร์ท",
    queue: "คิว (ทีมที่ว่าง)",
    finish: "จบแมตช์",
    begin: "เริ่มแข่ง",
    cancel: "ยกเลิก",
    confirmWinner: "ยืนยันผู้ชนะ",
    share: "แชร์",
    copyViewer: "คัดลอกลิงก์ผู้ชม",
  },
  en: {
    host: "Host",
    viewer: "Viewer",
    connected: "Connected",
    offline: "Offline",
    connecting: "Connecting",
    readonly: "Read-only",
    players: "Players",
    add: "Add",
    delete: "Delete",
    start: "START (press once)",
    courts: "Courts",
    queue: "Queue (available teams)",
    finish: "Finish Match",
    begin: "Begin",
    cancel: "Cancel",
    confirmWinner: "Confirm Winner",
    share: "Share",
    copyViewer: "Copy viewer link",
  },
} as const;

type I18nState = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: <K extends keyof typeof dict.th>(key: K) => string;
};

export const useI18n = create<I18nState>((set, get) => ({
  lang: "th",
  setLang: (lang) => set({ lang }),
  t: (key) => dict[get().lang][key],
}));
