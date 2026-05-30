import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

interface GlobalNotification {
  id: string;
  title: string;
  sessionName: string;
  timestamp: number;
}

interface NotificationStore {
  nextId: number;
  notifications: GlobalNotification[];
}

interface LoadResult {
  store: NotificationStore;
  recoveredBackup?: string;
}

const STORE_DIR = join(homedir(), ".pi", "global-notifications");
const STORE_PATH = join(STORE_DIR, "notifications.json");
const MAX_NOTIFICATIONS = 100;
const MAX_FIELD_CHARS = 100;
const ALERT_PREFIX = "🚨 ";
const POLL_INTERVAL_MS = 1000;

function emptyStore(): NotificationStore {
  return { nextId: 1, notifications: [] };
}

function trimAndCap(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_FIELD_CHARS).join("");
}

function validateField(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} is required`);
  }
  const normalized = trimAndCap(value);
  if (!normalized) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  return normalized;
}

function normalizeTitle(value: unknown): string {
  const title = validateField(value, "title");
  const withoutExistingPrefix = title.startsWith(ALERT_PREFIX)
    ? title.slice(ALERT_PREFIX.length).trimStart()
    : title;
  return trimAndCap(`${ALERT_PREFIX}${withoutExistingPrefix}`);
}

function normalizeNotification(value: unknown): GlobalNotification | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<GlobalNotification>;
  if (typeof item.id !== "string" || item.id.trim() === "") return null;
  if (typeof item.title !== "string" || item.title.trim() === "") return null;
  if (typeof item.sessionName !== "string" || item.sessionName.trim() === "") {
    return null;
  }
  if (typeof item.timestamp !== "number" || !Number.isFinite(item.timestamp)) {
    return null;
  }

  return {
    id: item.id,
    title: normalizeTitle(item.title),
    sessionName: trimAndCap(item.sessionName),
    timestamp: item.timestamp,
  };
}

function newestFirst(items: GlobalNotification[]): GlobalNotification[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
}

function pruneStore(store: NotificationStore): NotificationStore {
  return {
    nextId: Math.max(1, store.nextId),
    notifications: newestFirst(store.notifications).slice(0, MAX_NOTIFICATIONS),
  };
}

function normalizeStore(value: unknown): NotificationStore | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { nextId?: unknown; notifications?: unknown };
  if (!Array.isArray(raw.notifications)) return null;

  const notifications = raw.notifications
    .map(normalizeNotification)
    .filter((item): item is GlobalNotification => item !== null);

  if (notifications.length !== raw.notifications.length) return null;

  const numericIds = notifications
    .map((item) => Number(item.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const minimumNextId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
  const nextId =
    typeof raw.nextId === "number" && Number.isInteger(raw.nextId) && raw.nextId > 0
      ? Math.max(raw.nextId, minimumNextId)
      : minimumNextId;

  return pruneStore({ nextId, notifications });
}

function backupCorruptStore(): string | undefined {
  if (!existsSync(STORE_PATH)) return undefined;
  const backupPath = `${STORE_PATH}.bak-${Date.now()}`;
  renameSync(STORE_PATH, backupPath);
  return backupPath;
}

function loadStore(): LoadResult {
  if (!existsSync(STORE_PATH)) {
    return { store: emptyStore() };
  }

  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const store = normalizeStore(parsed);
    if (!store) {
      const recoveredBackup = backupCorruptStore();
      return { store: emptyStore(), recoveredBackup };
    }
    return { store };
  } catch {
    const recoveredBackup = backupCorruptStore();
    return { store: emptyStore(), recoveredBackup };
  }
}

function saveStore(store: NotificationStore): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const normalized = pruneStore(store);
  const tempPath = `${STORE_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(normalized, null, 2));
  renameSync(tempPath, STORE_PATH);
}

function addNotification(titleValue: string, sessionNameValue: string): GlobalNotification {
  const title = normalizeTitle(titleValue);
  const sessionName = validateField(sessionNameValue, "sessionName");
  const { store } = loadStore();
  const notification: GlobalNotification = {
    id: String(store.nextId),
    title,
    sessionName,
    timestamp: Date.now(),
  };
  saveStore({
    nextId: store.nextId + 1,
    notifications: [notification, ...store.notifications],
  });
  return notification;
}

function deleteNotification(id: string): NotificationStore {
  const { store } = loadStore();
  const nextStore = {
    nextId: store.nextId,
    notifications: store.notifications.filter((item) => item.id !== id),
  };
  saveStore(nextStore);
  return pruneStore(nextStore);
}

function clearNotifications(): NotificationStore {
  const { store } = loadStore();
  const nextStore = { nextId: store.nextId, notifications: [] };
  saveStore(nextStore);
  return nextStore;
}

function currentStoreMtime(): number | undefined {
  try {
    return statSync(STORE_PATH).mtimeMs;
  } catch {
    return undefined;
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deriveSessionName(pi: ExtensionAPI, ctx: ExtensionContext): string {
  const namedSession = pi.getSessionName()?.trim();
  if (namedSession) return trimAndCap(namedSession);

  const cwdName = basename(ctx.cwd).trim();
  if (cwdName) return trimAndCap(cwdName);

  return trimAndCap(ctx.sessionManager.getSessionId());
}

function borderedLine(
  width: number,
  content: string,
  themeBorder: (text: string) => string,
): string {
  const innerWidth = Math.max(0, width - 4);
  const truncated = truncateToWidth(content, innerWidth, "…");
  const pad = Math.max(0, innerWidth - visibleWidth(truncated));
  return `${themeBorder("│")} ${truncated}${" ".repeat(pad)} ${themeBorder("│")}`;
}

function borderTop(width: number, title: string, themeBorder: (text: string) => string): string {
  const safeWidth = Math.max(width, 2);
  const safeTitle = truncateToWidth(` ${title} `, Math.max(0, safeWidth - 2), "…");
  const fill = Math.max(0, safeWidth - 2 - visibleWidth(safeTitle));
  return themeBorder(`╭${safeTitle}${"─".repeat(fill)}╮`);
}

function borderBottom(width: number, content: string, themeBorder: (text: string) => string): string {
  const safeWidth = Math.max(width, 2);
  const safeContent = truncateToWidth(content, Math.max(0, safeWidth - 2), "…");
  const fill = Math.max(0, safeWidth - 2 - visibleWidth(safeContent));
  return themeBorder(`╰${"─".repeat(fill)}${safeContent}╯`);
}

export default function (pi: ExtensionAPI) {
  let notifications: GlobalNotification[] = [];
  let currentCtx: ExtensionContext | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastMtimeMs: number | undefined;

  function syncFromDisk(ctx?: ExtensionContext): void {
    const loaded = loadStore();
    notifications = loaded.store.notifications;
    lastMtimeMs = currentStoreMtime();
    if (loaded.recoveredBackup && ctx?.hasUI) {
      ctx.ui.notify(
        `Global notifications store was corrupt; backed up to ${loaded.recoveredBackup}`,
        "warning",
      );
    }
    updateWidget();
  }

  function updateWidget(): void {
    const ctx = currentCtx;
    if (!ctx?.hasUI) return;

    if (notifications.length === 0) {
      ctx.ui.setWidget("global-notifications", undefined);
      return;
    }

    const sorted = newestFirst(notifications);
    const newest = sorted[0]!;

    ctx.ui.setWidget("global-notifications", (_tui, theme) => ({
      render(width: number) {
        const w = Math.max(30, width);
        const border = (text: string) => theme.fg("border", text);
        const title = ` Global Notifications (${sorted.length}) `;
        const newestText = `${newest.sessionName} — ${newest.title}`;
        const meta = `${formatTime(newest.timestamp)} · alt+0 open`;
        return [
          borderTop(w, title, border),
          borderedLine(
            w,
            `${theme.fg("accent", truncateToWidth(newestText, Math.max(0, w - 8), "…"))}`,
            border,
          ),
          borderedLine(w, theme.fg("dim", meta), border),
          borderBottom(w, "", border),
        ];
      },
      invalidate() {},
    }));
  }

  function startPolling(ctx: ExtensionContext): void {
    if (pollTimer) clearInterval(pollTimer);
    lastMtimeMs = currentStoreMtime();
    pollTimer = setInterval(() => {
      const nextMtime = currentStoreMtime();
      if (nextMtime !== lastMtimeMs) {
        syncFromDisk(ctx);
      }
    }, POLL_INTERVAL_MS);
    pollTimer.unref?.();
  }

  async function openNotificationPane(ctx: ExtensionContext): Promise<void> {
    syncFromDisk(ctx);

    if (notifications.length === 0) {
      ctx.ui.notify("No global notifications", "info");
      return;
    }

    const result = await ctx.ui.custom<
      | { action: "delete"; notification: GlobalNotification }
      | { action: "clear" }
      | null
    >(
      (tui, theme, _keybindings, done) => {
        let selected = 0;

        function render(width: number): string[] {
          const sorted = newestFirst(notifications);
          const w = Math.max(40, width);
          const border = (text: string) => theme.fg("border", text);
          const lines: string[] = [borderTop(w, " Global Notifications ", border)];

          for (let index = 0; index < sorted.length; index++) {
            const item = sorted[index]!;
            const isSelected = index === selected;
            const prefix = isSelected ? "▶ " : "  ";
            const label = `${prefix}${item.sessionName} — ${item.title}`;
            const time = ` ${formatTime(item.timestamp)}`;
            const maxLabel = Math.max(0, w - 4 - visibleWidth(time));
            const truncatedLabel = truncateToWidth(label, maxLabel, "…");
            const styledLabel = isSelected
              ? theme.fg("accent", truncatedLabel)
              : theme.fg("text", truncatedLabel);
            lines.push(borderedLine(w, `${styledLabel}${theme.fg("dim", time)}`, border));
          }

          const hint = " ↑↓ navigate · d delete · x clear · esc close ";
          lines.push(borderBottom(w, theme.fg("dim", hint), border));
          return lines;
        }

        return {
          render,
          invalidate() {},
          handleInput(data: string) {
            const sorted = newestFirst(notifications);
            if (matchesKey(data, Key.escape)) {
              done(null);
            } else if (matchesKey(data, Key.up) && selected > 0) {
              selected--;
              tui.requestRender();
            } else if (matchesKey(data, Key.down) && selected < sorted.length - 1) {
              selected++;
              tui.requestRender();
            } else if (data === "d" || matchesKey(data, Key.delete)) {
              done({ action: "delete", notification: sorted[selected]! });
            } else if (data === "x") {
              done({ action: "clear" });
            }
          },
        };
      },
      { overlay: true },
    );

    if (!result) return;

    if (result.action === "delete") {
      try {
        notifications = deleteNotification(result.notification.id).notifications;
        lastMtimeMs = currentStoreMtime();
        updateWidget();
        ctx.ui.notify("Deleted global notification", "info");
        if (notifications.length > 0) {
          await openNotificationPane(ctx);
        }
      } catch (error) {
        ctx.ui.notify(`Failed to delete notification: ${(error as Error).message}`, "error");
      }
      return;
    }

    if (result.action === "clear") {
      const ok = await ctx.ui.confirm(
        "Clear global notifications?",
        `Delete all ${notifications.length} global notifications?`,
      );
      if (!ok) return;
      try {
        notifications = clearNotifications().notifications;
        lastMtimeMs = currentStoreMtime();
        updateWidget();
        ctx.ui.notify("Cleared global notifications", "info");
      } catch (error) {
        ctx.ui.notify(`Failed to clear notifications: ${(error as Error).message}`, "error");
      }
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    syncFromDisk(ctx);
    startPolling(ctx);
  });

  pi.on("session_shutdown", async () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  });

  pi.registerTool({
    name: "notify_global",
    label: "Notify Global",
    description:
      "Create a simple title-only notification visible in all Pi sessions on this local machine.",
    promptSnippet:
      "Create a simple global notification with a title; sessionName defaults to the current Pi session name.",
    promptGuidelines: [
      "Use notify_global when the user asks to notify other local Pi sessions or record a global notification.",
      "notify_global requires a concise title; the extension prefixes it with 🚨. sessionName is optional and defaults to the current Pi session name.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Notification title. The extension prefixes it with 🚨 and caps it at 100 characters." }),
      sessionName: Type.Optional(
        Type.String({
          description:
            "Optional override for the Pi session name. Defaults to the current session name.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionName = params.sessionName
        ? validateField(params.sessionName, "sessionName")
        : deriveSessionName(pi, ctx);
      const notification = addNotification(params.title, sessionName);
      syncFromDisk(currentCtx);
      return {
        content: [
          {
            type: "text" as const,
            text: `Added global notification ${notification.id}: ${notification.sessionName} — ${notification.title}`,
          },
        ],
        details: { notification },
      };
    },
  });

  pi.registerShortcut(Key.alt("0"), {
    description: "Open global notifications",
    handler: async (ctx) => {
      await openNotificationPane(ctx);
    },
  });

  pi.registerCommand("notifications", {
    description: "Browse and delete global notifications",
    handler: async (_args, ctx) => {
      await openNotificationPane(ctx);
    },
  });
}
