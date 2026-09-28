# Chat interno (Job Chat)

Internal company chat that doubles as a permanent job communication log.

## Goals

- Replace informal SMS/WhatsApp for job talk among staff
- Every message is durable (no hard delete)
- Job-linked messages appear on the job **Comunicações** tab
- Mobile-first (field crews on phone)

## Conversation types

| Type | Behavior |
|------|----------|
| **DM** | Unique per user pair (`dmKey`) |
| **Group** | Named; members add/remove |
| **Job channel** | Auto-created with the Work Order; members sync from assignee + `WorkOrderMember`; read-only when job is `completed` / `canceled` |

## Permissions

| Key | Purpose |
|-----|---------|
| `chat.use` | Open chat / send / read own memberships |
| `chat.create_group` | Create groups |
| `chat.mention_all` | Use `@todos` / `<@all>` |
| `chat.link_retroactive` | Link past messages to jobs |
| `chat.view_hidden` | See soft-deleted bodies + edit history |

Admins may **read** non-member conversations with an audit log entry; they cannot write without membership.

## Tokens in message body

- User mention: `<@user:UUID>`
- Team (job/conversation): `<@team>` (`@equipe`)
- Everyone in conversation: `<@all>` (`@todos`) — needs `chat.mention_all`
- Job chip: `<#job:UUID>`

XSS: free text is HTML-escaped; known tokens are preserved.

## Read state

Per member: `lastReadAt` (+ optional `lastReadMessageId`). Unread = messages after that cursor (excluding own). “Seen by” = members whose `lastReadAt >= message.createdAt`.

## Soft delete & edits

- Edit → previous body in `ChatMessageEdit`; UI shows `(editado)`
- Delete → `hiddenAt` / `hiddenById` (never physical delete)
- Regular users see “Mensagem removida”; `chat.view_hidden` sees original + history

## Realtime

- `GET /api/chat/events` — SSE, cookie auth, membership-scoped
- Events: `message.created|updated|hidden`, `typing`, `read`, `mention.created`, `conversation.updated`
- In-memory bus (`ChatRealtimeBus`); swap for Redis / `LISTEN` later if multi-instance
- Client: `crm/public/chat-realtime.js` + catch-up via `messages?after=`

## Notifications

- In-app: nav badge (`/api/chat/unread`) + document title on chat page
- Push: `PushChatNotifier` → existing `notifyUsersPush` (VAPID)
- Mute conversation → no push for that conversation (including mentions)
- Mentions list: **Minhas menções** in chat UI (`/api/chat/mentions`)

## Job list (Chat → Jobs tab)

- `GET /api/chat/jobs?status=active|all|draft|…&from=&to=&q=`
- Auto-lists work orders (scoped like the jobs board for field roles)
- Default status filter: **active** (`draft` / `scheduled` / `in_progress`)
- Date filters use job schedule overlap; presets: today / week / month
- Click → `ensure-channel` then opens the job conversation

## Job Comunicações

- Desktop card + mobile tab on job detail
- Timeline of **linked** messages only (DM only if explicitly linked)
- Gallery of chat images/videos for the job
- Deep-link opens `chat.html?c=&m=`

## Main API surface

| Method | Path |
|--------|------|
| GET | `/api/chat/conversations` |
| POST | `/api/chat/conversations/dm` |
| POST | `/api/chat/conversations/groups` |
| GET/POST | `/api/chat/conversations/:id/messages` |
| PATCH/DELETE | `/api/chat/messages/:id` |
| POST | `/api/chat/conversations/:id/read` |
| POST | `/api/chat/conversations/:id/typing` |
| POST | `/api/chat/conversations/:id/mute` |
| PUT | `/api/chat/conversations/:id/context` |
| POST | `/api/chat/messages/link-jobs` |
| GET | `/api/chat/jobs` |
| GET | `/api/chat/jobs/:id/timeline` |
| GET | `/api/chat/jobs/:id/gallery` |
| POST | `/api/chat/jobs/:id/ensure-channel` |
| GET | `/api/chat/search` |
| GET | `/api/chat/events` (SSE) |
| GET | `/api/chat/mentions` |
| POST | `/api/chat/mentions/read-all` |

## Backfill

```bash
npm run db:backfill-chat-channels
# optional: --include-completed --org <slug>
```

Migration `20260928200000_chat_internal` also backfills active jobs on deploy.

## Out of scope (intentionally)

Threads UI, decision/pending/task flags, “Ciente” reactions, PDF export, voice + transcription UI, offline mode, guest access.
