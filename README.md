# Opper for VS Code

Adds [Opper](https://opper.ai)'s models to the VS Code chat model picker, so Copilot Chat — agent mode included — runs on any model Opper can reach, through the EU-hosted Opper gateway.

Built on the [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) (VS Code 1.104+). Models added this way need **no Copilot subscription and no GitHub sign-in**.

- **700+ models, discovered at runtime.** No hardcoded model ids.
- **Pools** — a bare name like `claude-sonnet-4.5` that load-balances across every provider serving it.
- **Your dynamic routes** — deployed routing graphs, as `dynamic/<name>`. The graph picks the model per request.
- **Residency and ZDR in the picker**, with `opper.euOnly` / `opper.zdrOnly` to narrow the list.
- **Scoped to your policy.** Discovery is filtered server-side by your comply allowlist, so a model your policy denies is never offered.

## Setup

1. Install the extension.
2. Run **Opper: Manage API Key** and paste a key from [platform.opper.ai](https://platform.opper.ai). It goes into VS Code's `SecretStorage`, never `settings.json`.
3. Open Chat and pick an Opper model.

Nothing is listed without a key — the model list is scoped to it.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `opper.baseUrl` | `https://api.opper.ai` | Point at another gateway. |
| `opper.showModels` | `true` | List concrete models. |
| `opper.showPools` | `true` | List load-balancing names. |
| `opper.showDynamicRoutes` | `true` | List your deployed routes. |
| `opper.dynamicRouteToolCalling` | `true` | Offer routes in agent mode. |
| `opper.euOnly` | `false` | EU-hosted models only. |
| `opper.zdrOnly` | `false` | Zero-data-retention models only. |
| `opper.modelFilter` | `[]` | Substrings to narrow a long list. |

**Only pools and routes:** gear next to "Opper" in the model picker → *Choose what to list…* → untick **Models**.

**Which key am I using?** The gear menu leads with it — `Opper · <org> · project <name> · N models`. Comply rules are scoped to the key's *project*, so that line is the fastest way to spot a key pointing somewhere you didn't expect. `OPPER_API_KEY` is used only when no key is stored, and the line says so when it is.

**Dynamic routes and agent mode:** Opper can't know ahead of time whether a route supports tool calling — the graph decides per request. `opper.dynamicRouteToolCalling` is a promise you make on the route's behalf. Turn it off if a route can land on a model without tool support.

## Development

```bash
npm install && npm run compile   # bundle to dist/
npm test                         # typecheck + node --test
```

<kbd>F5</kbd> launches an Extension Development Host with the extension loaded.

## License

MIT © Opper Technology AB
