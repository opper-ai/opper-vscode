# VS Code browser login prototype

Branch: `prototype/vscode-device-login`. Draft, not customer ready.

The extension opens Opper browser approval directly and polls the device flow.
No Opper CLI installation, subprocess, or `npx` is involved. The CLI package is
`@opperai/cli` and can separately be invoked with `npx @opperai/cli`, but the
extension does not depend on it.

## Simulator tests

Run `npm test` to exercise the loopback simulator through the test harness.
The simulator implements the earlier prototype contract and is no longer a
user-selectable extension mode. Live sign-in and renewal use the shared SDK.
Simulator tests do not prove live SSO or enterprise policy enforcement.

## Live SSO probe with your normal Opper account

Set `opper.baseUrl` to `https://api.opper.ai`, `opper.login.platformUrl` to
`https://platform.opper.ai`.
The extension includes the registered public VS Code client ID
`opper_app_p-xX3vmCeoZLEZqmycoglw`. Remove the simulator's `opper.login.clientId`
override to use it. Users do not need to register an app or install the CLI.

Run **Opper: Sign In**, complete normal Opper SSO, and choose your organization.
Then select an allowed model and make a small request. Inspect user, organization,
project and usage attribution server-side. A successful existing SSO login does
not prove enforcement of the selected organization's required SSO connection.

The live adapter uses today's `/oauth/device` and `/oauth/device/token` forms.
The current response supplies `api_key` and user display information, without
expiry or stable credential identity. Live mode preserves optional credential_id, numeric org_id/project_id and
expires_at. Null expiry means no expiry set; an absent field means unavailable. **Renewal is disabled in live mode.** Legacy API errors may be generic.
No live SSO or inference acceptance test has been performed for this prototype.

## Boundary with Johnny's work

`src/device-login.ts` isolates transport and response conversion; `src/session.ts`
contains the internal credential record and secure storage behavior. The prototype
uses a small transport instead of `@opperai/login` so it can support cancellation
and preserve experimental metadata without modifying Johnny's SDK.

Simulator wire fields are PROPOSALS, not deployed API contracts:

- Start: `client_id`; renewal additionally sends `intent=renew`, `user_id`,
  `organization_id`, `credential_id`. Server must independently enforce identity.
- Result: `api_key`, `credential_id`, `user_id`, `organization_id`, `project_id`,
  `client_id`, `expires_at` (UTC timestamp). IDs are strings in these fixtures.
- Runtime errors: `error.code`; device errors: `detail`. Example codes:
  `credential_expired`, `credential_revoked`, `membership_removed`,
  `account_suspended`, `sso_required`.

Agree the exact fields with Johnny before enabling renewal outside loopback.
The existing login SDK drops new response metadata, so consumers need an updated
SDK or explicit response mapping. Never infer expiry by adding 30 days locally.

Store key and metadata in one SecretStorage value. A failed write leaves a pending
replacement in memory and blocks using the predecessor. **Opper: Retry Saving
Sign-in** retries that write without rotating again. After closing the window,
recovery depends on a fresh approval returning the active key; bounded poll retry
and server-side delivery recovery still belong to Johnny's implementation.

Sign-out here is LOCAL only, not authorization revocation. It suppresses fallback
to an environment key. Server-side disconnect requires a separately agreed API.

Within one window, overlapping login actions are prevented. Across windows and
machines, the server must enforce renewal serialization. One credential per
user/org/client also means rotation invalidates other installations' copies.

## Checks and remaining acceptance

Automated checks cover secure-record persistence, expiry, endpoint binding,
failed storage/retry, identity mismatch, rotation checks, absence of fabricated
legacy expiry, trusted browser origin, denial, cancellation, retryable polling,
predecessor rejection, superseded poll delivery, runtime error classification,
and sign-out without environment fallback.

Still required: extension-host UI walkthrough, registered live client, live SSO
and tool-using inference, production expiry/revocation, membership/SSO policy,
multi-window races, host storage failure, and remote SSH/devcontainer behavior.
The fixture tests do not verify Go or Python runtime authentication.

For the final interactive checklist and model/context behavior, see the root README.
