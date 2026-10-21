# Mate Voice (staging MVP)

Mate Voice adds browser-based speech-to-speech conversations to the CRM. It uses OpenAI Realtime over WebRTC, gives each browser session a short-lived client secret from the server, and never sends the standard OpenAI API key to the browser. The selected lead/customer is read inside the active tenant and supplied as limited conversation context. Transcript messages are stored in the tenant database and the raw audio is not recorded.

## Staging isolation

The Mate Voice page and API require both `APP_ENV=staging` and `MATE_VOICE_ENABLED=true`; both default to disabled. The checked-in staging stack uses its own PostgreSQL 16 service, private Docker network, named volume, and app user. It binds the web app to `127.0.0.1:3001` and does not connect to the existing `DATABASE_URL` or any production service.

Create local staging secrets from the example file, set `OPENAI_API_KEY` there, then start the stack:

```sh
cp .env.mate-voice-staging.example .env.mate-voice-staging
# Replace each STAGING_* value with a unique secret; use `openssl rand -hex 32` for passwords/secrets.
# Add the OpenAI project API key to OPENAI_API_KEY.
docker compose --env-file .env.mate-voice-staging -f docker-compose.mate-voice-staging.yml up --build
```

Open [http://localhost:3001/signup](http://localhost:3001/signup) to create a staging workspace, then visit `http://localhost:3001/mate-voice` from that logged-in workspace. The login/signup flow may show its email verification link in the app logs when the email provider is set to the local console default.

Stop the app with `Ctrl+C`. To start it again, run the same Compose command. The isolated staging database persists in the `mate_voice_staging_data` volume. Removing that volume resets staging data:

```sh
docker compose --env-file .env.mate-voice-staging -f docker-compose.mate-voice-staging.yml down -v
```

The staging stack is local and has not been published to a public host. Its local address is `http://localhost:3001/mate-voice`.

## MVP behavior

- Authenticated staff can start and end an audio session from a browser with microphone access.
- A short-lived OpenAI Realtime client secret is minted by the authenticated server endpoint. The browser connects through WebRTC.
- Staff can search and link a lead or customer from their own organization. The assistant receives the selected name and basic CRM context but cannot update CRM records.
- Each user's conversation history is private to that user within the tenant. Transcript-only messages are stored; audio is not.
- Realtime calls require a secure browser context (`https://` or `localhost`) and an available OpenAI project API key with Realtime access.

## API routes

- `GET /api/mate-voice/crm/leads?q=...` and `GET /api/mate-voice/crm/customers?q=...` use the CRM permissions for each record type.
- `POST /api/mate-voice/conversations` starts a stored conversation, optionally linked to a CRM record.
- `POST /api/mate-voice/conversations/:id/token` creates a short-lived Realtime client secret.
- `POST /api/mate-voice/conversations/:id/messages` stores a transcript message.
- `POST /api/mate-voice/conversations/:id/finish` closes a conversation.
- `GET /api/mate-voice/conversations` and `GET /api/mate-voice/conversations/:id` read the current user's history.
