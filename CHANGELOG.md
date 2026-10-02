# Change Log

## 0.2.2

- Show organization-scoped personal allowances without a placeholder project.
- Keep project usage visible for project-bound credentials.
- Verify renewal from legacy project-bound credentials into organization credentials.

## 0.2.1

- Show your personal or role allowance, usage, remaining budget, and reset date.
- Use your allowance in the footer summary and keep shared project usage separate.
- Explain when your personal allowance blocks spending; organization billing remains permission-controlled.

## 0.2.0

### Breaking changes

- Removed `opper.euOnly`, `opper.zdrOnly`, and `opper.modelFilter`. Manage model
  access and compliance in Opper; old local values are ignored. This can expand
  the visible list to all models the key is authorized to use.
- Removed `opper.dynamicRouteToolCalling`. Routes must report `tools` in server
  metadata to be advertised as tool-capable; some routes may leave Agent mode.
- Removed the developer-only `opper.login.simulator` setting.
- Use **Opper: Account and Models** or **Opper: Sign In** instead of the old
  **Manage API Key** command. Existing saved keys continue to work.

### Improvements

- Browser sign-in and renewal with organization SSO through Opper.
- Project allowance, spending, and reset date in a budget panel and footer summary.
- Permission-controlled organization billing details.
- Server-authorized model discovery and server-reported context limits.
- Removed local model/compliance overrides and prototype settings.
- Improved credential expiry handling, cancellation, and secure storage recovery.

## 0.1.1

- Reads the new shape of `opper.zdr` on `/v3/compat/models`: an object of
  retention facts (`logging`, `moderation`, `caching`, `training`,
  `subprocessors`, each `true` / `false` / `null`) replaces the `always` /
  `enterprise` string. "ZDR by default" is now derived — logging does not
  retain content and no moderation layer holds it — for the picker badge, the
  tooltip and `opper.zdrOnly`. Both shapes are accepted while the string is
  retired.

## 0.1.0

Initial release.

- Contributes Opper's model catalogue to the VS Code chat model picker via the
  Language Model Chat Provider API. Models are discovered at runtime from
  `/v3/compat/models` — no hardcoded ids.
- Lists concrete catalog rows, Opper **pools** (bare names that load-balance
  across providers), and the calling org's deployed **dynamic routes**
  (`dynamic/<name>`).
- Shows hosting region, country and zero-data-retention status in the picker,
  with `opper.euOnly` / `opper.zdrOnly` to narrow the list.
- Streaming and tool calling (agent mode) over
  `/v3/compat/chat/completions`.
- API key stored in VS Code `SecretStorage`; `OPPER_API_KEY` honoured for
  devcontainers and CI.
