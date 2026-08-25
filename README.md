# Opper for VS Code

Contributes Opper's catalogue to the VS Code chat model picker, so GitHub Copilot Chat — including agent mode — runs on any model Opper can reach, through the EU-hosted Opper gateway.

Built on the [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) (VS Code 1.104+). Models contributed this way need **no Copilot subscription and no GitHub sign-in**.

## What it adds over pointing the built-in "OpenAI Compatible" provider at Opper

- **Discovery.** The 300+ model catalogue is fetched at runtime from `/v3/compat/models`. No hand-typed model IDs, no list to keep in sync.
- **Pools.** A bare name like `claude-sonnet-4.5` load-balances across every provider serving that model. The picker shows it as its own entry, next to the pinned `anthropic/claude-sonnet-4.5`.
- **Your dynamic routes.** Deployed routing graphs appear as `dynamic/<name>`. The graph picks the model per request; picking one in the model picker is the same as sending that id to the API.
- **Residency and ZDR in the picker.** Each entry's detail line carries where it is hosted and whether zero data retention is on, and `opper.euOnly` / `opper.zdrOnly` reduce the list to what your policy allows.
- **Observability and governance.** Every Copilot turn becomes an Opper trace, is billed against your org, and is filtered server-side by your comply allowlist — a model your policy denies is never offered in the first place.

The extension talks to exactly two endpoints, both authenticated: `/v3/compat/models` to discover, `/v3/compat/chat/completions` to answer. There is no second, unscoped source of models, so what the picker shows can never be wider than what your API key is allowed to call.

## Setup

1. Install the extension.
2. Run **Opper: Manage API Key** and paste a key from [platform.opper.ai](https://platform.opper.ai). It is stored in VS Code's `SecretStorage` (the OS keychain), never in `settings.json`.
3. Open Chat, click the model picker, and choose an Opper model.

Without a key the extension contributes nothing at all — the model list is scoped to the key, so there is no anonymous mode.

`OPPER_API_KEY` in the environment is used **only when no key is stored** — it is a fallback for devcontainers and CI, never an override. Run **Opper: Manage API Key** at any time to see which key is in effect and what it scopes you to:

```
Opper · acme-corp · project production · 17 models
```

That line leads with the project because comply rules — model allowlists above all — are scoped to the key's project. A picker showing every model when a project allowlist should have cut it to a handful is almost always a key pointing at a different project, and the status line is the fastest way to see it. If the key came from the environment the line says so.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `opper.baseUrl` | `https://api.opper.ai` | Point at a self-hosted or regional gateway. |
| `opper.showModels` | `true` | List concrete catalog models (`anthropic/claude-sonnet-4.5`). |
| `opper.showPools` | `true` | List bare load-balancing names. |
| `opper.showDynamicRoutes` | `true` | List your org's deployed routes. |
| `opper.dynamicRouteToolCalling` | `true` | Whether routes are offered in agent mode (see below). |
| `opper.euOnly` | `false` | Only EU-hosted models. |
| `opper.zdrOnly` | `false` | Only models with zero data retention on by default. |
| `opper.modelFilter` | `[]` | Substrings to narrow a long picker, e.g. `["claude", "gpt-5"]`. |

### Showing only pools and routes

Click the **gear** next to "Opper" in the chat model picker → **Choose what to
list…** → untick **Models**. Or run **Opper: Choose What to List** from the
Command Palette, or untick `opper.showModels` in Settings — all three write the
same preference.

The picker then lists only Opper's own routing constructs — your pools and your
deployed `dynamic/<name>` routes — which is the useful view when routing
decisions live in Opper rather than in the editor.

This maps straight onto the gateway's own `?type=` filter, so the narrowing
happens server-side rather than by downloading 574 entries and discarding most
of them. Untick all three and the extension skips the request entirely: `?type=`
with an empty value means *every* kind to the gateway, so sending it would
return the whole catalogue.

Routes sort first, then pools, then concrete models. The gateway returns the
reverse, which buries an org's handful of routes under several hundred catalog
rows — the entries most specific to you ending up hardest to find.

## Things worth knowing

**Dynamic routes and agent mode.** Opper cannot say ahead of time whether a route supports tool calling — the graph picks the model per request. `opper.dynamicRouteToolCalling` is therefore a promise you make on your route's behalf. Leave it on and a route is usable in agent mode; turn it off if a route can land on a model without tool support, and the route stays out of agent mode rather than failing mid-turn.

**Token counts are estimates.** VS Code asks for a token count on every keystroke to budget context, so it has to be local. Opper spans 300+ models across a dozen tokenizers, and no single exact count exists — this uses the same `chars/4` heuristic the gateway's own `countTokens` falls back to, good to roughly ±20% on prose. `maxInputTokens` is reported as the context window *minus* the model's output cap, so a full context still leaves the reply room.

**Images in tool results.** An OpenAI `tool` message carries text only. If a tool returns an image, a visible placeholder naming the media type is sent in its place rather than dropping it silently — a model that never sees the screenshot a tool returned otherwise answers confidently and wrongly, with nothing in the transcript explaining why.

**Embedding models are excluded** using the entry's `opper.type`, which is the reliable discriminator — the chat and embedding catalogues share this listing, and capability metadata alone does not separate them.

## Development

```bash
npm install
npm run compile     # bundle to dist/ with esbuild
npm run watch       # rebuild on change
npm run typecheck
npm test            # compiles, then runs node --test over the pure modules
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the extension loaded.

The layers that carry the real risk — SSE framing and catalogue mapping — have no `vscode` import and are covered by `node --test`. `src/sse.ts` in particular guards a regression class this wire format has produced before: `data:{...}` with no space after the colon is legal SSE, and slicing a fixed `"data: ".length` drops those frames, producing an empty completion behind an HTTP 200 rather than an error.

## License

MIT
