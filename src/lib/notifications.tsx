import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { announcementsQuery, markAnnouncementsRead, type Announcement } from "./content";
import { getLang, localeFor, translate, useI18n } from "./i18n";

export type Notice = Announcement & { read: boolean; time: string };

type Ctx = {
  notices: Notice[];
  unread: number;
  permission: NotificationPermission | "unsupported";
  requestPermission: () => Promise<void>;
  markAllRead: () => void;
};

const NotificationsContext = createContext<Ctx | null>(null);

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return translate("Just now");
  if (s < 3600) return translate("{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86400) return translate("{n} h ago", { n: Math.floor(s / 3600) });
  return new Date(iso).toLocaleDateString(localeFor(getLang()), { month: "short", day: "numeric" });
}

/** Announcements from the admin panel, with each student's own read state. Mount once inside signed-in pages. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  useI18n(); // re-render times when the language changes
  const { data = [] } = useQuery({ ...announcementsQuery, refetchInterval: 60_000 });
  const [permission, setPermission] = useState<Ctx["permission"]>("default");
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  // Alert the student about announcements that arrive while the app is open.
  useEffect(() => {
    if (!data.length && seen.current === null) return;
    if (seen.current === null) {
      seen.current = new Set(data.map((n) => n.id));
      return;
    }
    for (const n of data) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.read) continue;
      toast(n.title, { description: n.body });
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(n.title, { body: n.body, icon: "/icon-192.png" });
        } catch {
          /* some mobile browsers only allow notifications via service worker */
        }
      }
    }
  }, [data]);

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      toast.error(translate("This browser doesn't support notifications"));
      return;
    }
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === "granted") toast.success(translate("Notifications enabled"));
  }, []);

  const notices: Notice[] = data.map((n) => ({ ...n, time: timeAgo(n.created_at) }));

  const markAllRead = useCallback(() => {
    const ids = data.filter((n) => !n.read).map((n) => n.id);
    markAnnouncementsRead(ids)
      .then(() => qc.invalidateQueries({ queryKey: announcementsQuery.queryKey }))
      .catch(() => toast.error(translate("Couldn't update your alerts.")));
  }, [data, qc]);

  return (
    <NotificationsContext.Provider
      value={{ notices, unread: notices.filter((n) => !n.read).length, permission, requestPermission, markAllRead }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const c = useContext(NotificationsContext);
  if (!c) throw new Error("useNotifications must be used inside NotificationsProvider");
  return c;
}
