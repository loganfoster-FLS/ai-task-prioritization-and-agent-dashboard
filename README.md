# Dashboard

Desktop dashboard shell built with Electron. It now supports:

- Switchable AI connection testing and priority generation with OpenAI or Ollama
- Google desktop OAuth for Gmail + Calendar sync
- Asana OAuth or PAT-based task sync
- Slack bot-token validation plus hosted-bridge OAuth support
- A prototype semantic memory that vectorizes synced connection data locally
- Persistent Admin Desk notes and pinned tasks
- View themes: Light/Dark with simple accent families
- Packaging into a normal macOS app bundle / DMG

## Run locally

```bash
cd ~/Downloads/dashboard-app
npm install
npm start
```

## Build a normal app you can double-click

To create the packaged app bundle in `dist/mac/Dashboard.app`:

```bash
npm run build:dir
```

To create the DMG installer:

```bash
npm run build
```

After the build finishes, open the app bundle directly or drag `Dashboard.app` into Applications from the DMG.

## Google setup

1. Create a Google OAuth desktop/installed-app credential in Google Cloud.
2. Add the loopback redirect URI you will use in the app, for example:

```text
http://127.0.0.1:3456/oauth/google/callback
```

3. Paste the client ID into the Google tab in the app.
4. Click `Sign in with Google`, complete browser consent, then click `Sync data`.

Use your own personal Google account during consent. The app asks only for view access to Gmail and Calendar unless you explicitly enable future send/reply features in the UI.

The app pulls:

- unread Gmail messages
- today's Google Calendar events

## Asana setup

1. Create an Asana OAuth app.
2. Add the redirect URI shown in the app, for example:

```text
http://127.0.0.1:3456/oauth/asana/callback
```

3. Paste the client ID and client secret into the Asana tab.
4. Click `Sign in with Asana`, complete browser consent, then click `Sync data`.

If you already have a personal access token, you can paste that instead and skip OAuth.

The app pulls:

- your workspace identity
- a small preview of assigned tasks

## Slack setup

Slack supports two paths now:

1. Bot token path:
   Paste a bot token and standup channel into the Slack tab, then click `Validate & sync`.

2. Browser OAuth path:
   Host [slack-oauth-bridge.html](/Users/logan.foster/Downloads/dashboard-app/slack-oauth-bridge.html) at an HTTPS URL you control, paste that hosted URL into the Slack redirect field, add the same URL to your Slack app redirect settings, then click `Connect with Slack`.

The app can pull:

- workspace identity
- a preview of recent messages from the selected channel

The bridge page simply forwards Slack's HTTPS callback to the running desktop app at `http://127.0.0.1:3456/oauth/slack/relay`.

## AI provider setup

### OpenAI

1. Choose `OpenAI` in the AI tab.
2. Paste your OpenAI API key.
3. Pick a chat model and, optionally, an embeddings model.
4. Click `Test provider`.

### Ollama

1. Install and run Ollama locally.
2. Pull the model you want to chat with, for example your local Gemma family model.
3. Choose `Ollama` in the AI tab.
4. Set the base URL to your Ollama API if needed. The default is:

```text
http://127.0.0.1:11434/api
```

5. Enter your local chat model name and, optionally, a separate embeddings model such as `embeddinggemma`.
6. Click `Test provider`.

## Semantic memory

When Google, Asana, or Slack data syncs, the app now builds a small local vector index in the Electron user-data folder.

- It uses the selected provider's embedding API when available.
- If embeddings are unavailable, it falls back to a lightweight local hash vector so the prototype still works.
- The AI tab shows index status and includes a `Reindex memory` button.

The priority panel uses:

- your pasted manual context
- synced Google / Asana / Slack previews when available
- the semantic-memory matches retrieved from those synced connections

## Admin Desk

The `Admin Desk` panel is a persistent catch-all for important follow-ups that should not disappear into email, Slack, or Asana.

- `Send & pin task` creates a chat entry and pins the task to the top of the priorities panel until you mark it done.
- `Add note only` keeps the conversation without pinning a task.
- Pinned admin tasks survive refreshes and app restarts because they are stored in the same desktop settings file as the integrations.

## Themes

Use the theme controls in the header to switch between:

- `Light` or `Dark`
- accent families: `Wind`, `Sands`, `Ember`, `Nature`, `Sunset`, `Iris`

`Dark` keeps the sci-fi-inspired look as the base palette, and `Light` keeps the brighter glassy layout. The accent changes the highlight color only. It does not affect connections, data, or saved tasks.

## Notes

- Secrets are stored by the Electron backend, with platform encryption when available.
- Layout changes are still saved locally in the renderer.
- If macOS warns that the built app was downloaded from the internet, move it to Applications and open it from there the first time.
