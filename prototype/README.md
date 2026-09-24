# VS Code browser login prototype

Branch: `prototype/vscode-device-login`. Draft, not customer ready.

The extension opens Opper browser approval directly and polls the device flow.
No Opper CLI installation, subprocess, or `npx` is involved. The CLI package is
`@opperai/cli` and can separately be invoked with `npx @opperai/cli`, but the
extension does not depend on it.

## Run the simulator

1. Run `npm test` and `npm run compile` in this repository.
2. Run `node prototype/server.cjs` (loopback port 43187).
3. Open this repository in VS Code and press F5 (Run Extension).
4. In the **Extension Development Host's user settings**, set:

```json
{
  "opper.baseUrl": "http://127.0.0.1:43187",
  "opper.login.platformUrl": "http://127.0.0.1:43187",
  "opper.login.clientId": "vscode-prototype",
  "opper.login.simulator": true
}
```

These settings are application scoped: project configuration cannot redirect a
stored browser credential to another origin. Use a disposable VS Code profile
for the prototype. It shares the extension's existing identity and manual-key
slot; signing out removes that slot and records an explicit signed-out marker.

5. Run **Opper: Sign In**, approve in the browser, and select `prototype-model`.
   Chat receives a synthetic response, not real model inference.
6. Run **Opper: Renew Sign-in** before 45 seconds elapse. The simulator rotates
   the key and rejects its predecessor. Subsequent requests read the new secret.
7. Let the credential expire. Requests should direct you to renewal.
8. Try denied approval, cancelling polling, and local sign-out.
9. Stop the simulator and restore settings before attempting live login.

The simulator uses one synthetic account and one active client credential. It
is not an OAuth server implementation, does not implement enterprise policies,
SSO, durable recovery or distributed renewal locking, and does not emit tool
calls. HTTP tests prove the adapter handles its fixtures, not API readiness.

## Live SSO probe with your normal Opper account

Set `opper.baseUrl` to `https://api.opper.ai`, `opper.login.platformUrl` to
`https://platform.opper.ai`, and `opper.login.simulator` to `false`.
The extension includes the registered public VS Code client ID
`opper_app_p-xX3vmCeoZLEZqmycoglw`. Remove the simulator's `opper.login.clientId`
override to use it. Users do not need to register an app or install the CLI.

Run **Opper: Sign In**, complete normal Opper SSO, and choose your organization.
Then select an allowed model and make a small request. Inspect user, organization,
project and usage attribution server-side. A successful existing SSO login does
not prove enforcement of the selected organization's required SSO connection.

The live adapter uses today's `/oauth/device` and `/oauth/device/token` forms.
The current response supplies `api_key` and user display information, without
expiry or stable credential identity. The UI explicitly says expiry is not
supplied. **Renewal is disabled in live mode.** Legacy API errors may be generic.
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
