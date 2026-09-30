# Opper for VS Code

Browser login prototype: see [setup, simulator and live SSO checklist](prototype/README.md). No CLI required.

Adds [Opper](https://opper.ai)'s models to the VS Code chat model picker, so Copilot Chat — agent mode included — runs on any model Opper can reach, through the EU-hosted Opper gateway.

Built on the [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) (VS Code 1.104+). Models added this way need **no Copilot subscription and no GitHub sign-in**.

- **700+ models, discovered at runtime.** No hardcoded model ids.
- **Pools** — a bare name like `claude-sonnet-4.5` that load-balances across every provider serving it.
- **Your dynamic routes** — deployed routing graphs, as `dynamic/<name>`. The graph picks the model per request.
- **Key-authorized models.** Opper enforces access and compliance rules. Residency and ZDR labels are informational.
- **Scoped to your policy.** Discovery is filtered server-side by your comply allowlist, so a model your policy denies is never offered.

## Setup

1. Install the extension.
2. Run **Opper: Sign In** and approve in your browser. No CLI or client configuration is needed. **Opper: Account and Models** also supports manually supplied keys. Credentials go into VS Code SecretStorage.
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

## Final prototype test

Run `npm run compile`, open this folder in VS Code and press F5. In the new
Extension Development Host:

1. Run **Opper: Sign In**, approve through normal Opper SSO, and select your org.
2. Run **Opper: Account and Models** to check the org/project returned for the key.
3. Pick an Opper model and send a short message. Try a small file-reading task
   in Agent mode in a disposable folder to exercise tool calls.
4. Hover the **Opper: …% input** status item after a response. It describes the
   last Opper request, not necessarily the selected chat. Server prompt usage is
   preferred; otherwise an estimate is labelled `~`. Media costs are unknown
   until server usage arrives. Output capacity is reserved separately.
5. Run **Opper: Refresh Models** after a policy change. Discovery also refreshes
   while focused every minute and on returning to the window. The server remains
   authoritative on each inference request; a briefly stale picker grants no access.
6. Run **Opper: Sign Out**, then sign in again. Sign-out is local; no environment
   key is silently selected afterward.

No custom EU/ZDR enforcement switches are needed. Optional model-kind/name
preferences only narrow the server-authorized set. Non-chat entries and entries
without valid context limits are omitted; routes no longer get an invented 128k
window. Model limits and tool/vision metadata still need to be correct server-side.

Live login retains optional `credential_id`, numeric `org_id`/`project_id`, and
`expires_at`; null means no expiry set, absent means unavailable. Locally known
expiry or runtime authentication rejection can show a sign-in action; the failed
turn is never replayed automatically. **The live renewal wire contract is now implemented through the shared login SDK.**
Production acceptance still requires client activation. On 30 September, the VS Code
client returned `Agent login client activation pending`. Existing stored keys can
be used for local UI/inference review; avoid signing out just to test the panel.

## Project budget

Run **Opper: Show Budget**, or choose **Show budget** in Account and Models.
It opens a themed panel with project allowance, consumption, an accessible usage
bar, remaining amount and reset date. Projects without a direct cap show spend
and an explicit no-allowance message instead of a percentage. The Opper footer
now opens this panel on click; its hover combines a compact budget summary and
last-request context. Background snapshots refresh while focused at most once
a minute; opening the panel or using Check latest usage requests fresh data. **Check latest usage**
fetches again. This is a snapshot, not a live spending counter.

Organization credits/spend appear only with an explicit
`visibility.organization_finance: true`. No project limit means organization
funding and limits still apply. Organization credits are never presented as a
personal allowance. Older servers without project details show unavailable;
missing fields are never treated as zero. Blocked spending shows its reason.
Switching credentials or API origin closes the budget view.

The scoped fields require the backend `/me` rollout; fixture checks do not prove
live billing or permissions. No API migrations or CLI changes are included here.

## 30 September local review build

The shared `@opperai/login` dependency is a local, unpublished snapshot of PR #4
plus cancellation/timeouts. `vendor/README.md` records the source and patch.
It must be replaced with an approved published SDK before customer release.

- Reopen this folder and press F5, or reload the existing Extension Development Host.
- Keep your existing sign-in while the VS Code OAuth client awaits activation.
- Click the Opper footer, or run **Opper: Show Budget**.
- A numeric allowance/bar appears only when the project actually has a direct cap.
- **Opper: Renew Sign-in** now sends `renew` and `currentCredentialId` through the
  shared SDK. Production renewal is not yet verified; no failed model turn is replayed.

Local review checks: budget scope/permissions, zero/no-cap states, stale result
rejection, safe rendering, shared renewal metadata and cancellation. Visual
inspection in the extension host remains part of the local review.
