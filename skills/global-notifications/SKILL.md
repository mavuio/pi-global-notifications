---
name: global-notifications
description: Use when a Pi agent needs to notify other local Pi sessions or leave a simple global notification visible across sessions on the same machine.
---

<objective>
Create simple global notifications for other local Pi sessions by calling the `notify_global` tool.
</objective>

<when_to_use>
Use this skill when:
- The user asks to notify, ping, alert, or announce something to other Pi sessions.
- A background or helper Pi session needs to report that it is blocked, finished, or needs attention.
- Important local agent coordination information should appear in all Pi sessions on this machine.
</when_to_use>

<tool_contract>
Call `notify_global` with a concise title:

```json
{
  "title": "Concise notification title"
}
```

Rules:
- `title` is mandatory and should be concise. The extension prefixes it with `🚨 ` and caps the stored title at 100 characters.
- `sessionName` is optional. Omit it by default; the extension derives it from the current Pi session name. Only provide `sessionName` when the user explicitly wants a different source label.
- Do not include severity levels, message bodies, links, or actions. The global notification extension is title-only.
</tool_contract>

<examples>
Good examples:

```json
{ "title": "Review finished" }
```

```json
{ "title": "Worker blocked on missing API key" }
```

```json
{ "title": "Tests passed" }
```
</examples>

<process>
1. Decide whether the user explicitly wants a cross-session/local-machine notification.
2. Choose a short `title` that says what happened or what needs attention.
3. Omit `sessionName` unless an explicit override is needed.
4. Call `notify_global`.
5. Report briefly that the global notification was created.
</process>

<success_criteria>
A successful notification:
- Uses the `notify_global` tool.
- Has a non-empty `title`.
- Lets the extension derive the session name unless there is a clear reason to override it.
- Is understandable in the compact global notifications widget.
- Does not rely on extra body text that the notification extension will not store.
</success_criteria>
