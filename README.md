# pi-global-notifications

A Pi extension for simple notifications shared across all Pi sessions on the same local machine.


## Motivation

I was constantly annoyed with the huge number of notification options I had. I mostly use Pi inside the Herdr multiplexer: in remote terminals, on my phone, on my tablet, and sometimes in remote desktop sessions. I can notify through Herdr, WezTerm, macOS, Telegram, and more. It is always a mess: sometimes notifications are muted, sometimes they are not.

I wanted notifications to appear where I am constantly working: in my Pi agent. This extension is intentionally simple. Any Pi agent can write a title-only notification to a global notification stack. The notification is shown with the current session name and immediately appears in all other local Pi agents that have this extension enabled. Press `Alt+0` to open the panel and see all pending notifications; the latest notification is shown in the widget by default.

## Features

- **Global local store** — notifications are stored in `~/.pi/global-notifications/notifications.json`.
- **Simple notification model** — each notification has only `title`, derived/optional `sessionName`, `id`, and `timestamp`.
- **Title-only UI** — no levels, message bodies, actions, links, or per-session dismissals.
- **Shared deletion** — deleting a notification removes it globally for every Pi session.
- **Bounded history** — the newest 100 notifications are retained.
- **Live-ish refresh** — sessions poll the store mtime about once per second and update their widget when another session writes or deletes notifications.

## Tool

Agents can call:

```ts
notify_global({ title })
```

`sessionName` can be provided as an override, but normally the extension derives it from the current Pi session name.

Parameters:

| Name | Required | Description |
| --- | --- | --- |
| `title` | yes | Notification title. Prefixed with `🚨 `, trimmed, and capped at 100 characters. |
| `sessionName` | no | Optional override for the source label. Defaults to the current Pi session name; trimmed and capped at 100 characters. |

Example:

```json
{
  "title": "Review worker finished"
}
```

## UI

When notifications exist, Pi shows a compact widget above the editor with:

- total notification count
- newest notification as `sessionName — title`
- timestamp
- `alt+0 open` hint

Open the notification pane with:

| Shortcut / command | Action |
| --- | --- |
| `Alt+0` | Open global notifications overlay |
| `/notifications` | Open global notifications overlay |

Overlay keys:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move selection |
| `enter` or `delete` | Delete selected notification globally |
| `x` | Clear all notifications globally after confirmation |
| `esc` | Close overlay |

## Install

```bash
pi install npm:pi-global-notifications
```

## Try locally

From this repository:

```bash
npm install
npm run typecheck
pi -e /Users/manfred/mavu-macbook/clones/pi-global-notifications
```

Or install as a local Pi package by adding this path to your Pi settings/packages.

## Manual smoke test

Use two Pi sessions with the extension loaded:

1. In session A, ask the agent to call `notify_global` with a `title`.
2. Confirm session B shows the global notification widget within about one second.
3. Press `Alt+0` in session B and confirm the notification appears.
4. Delete the notification in session B with `enter` or `delete`.
5. Confirm session A removes the notification widget within about one second.
6. Add more than 100 notifications and confirm only the newest 100 remain in `~/.pi/global-notifications/notifications.json`.

## Scope

Version 1 intentionally does not include:

- severity levels
- message bodies
- notification actions or links
- per-session dismissal
- external CLI writer
- daemon process
- SQLite storage
- cross-machine sync

## License

MIT
