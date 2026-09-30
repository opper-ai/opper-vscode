# Release checks

Run `npm ci`, `npm test`, and `npx @vscode/vsce package --no-dependencies`.
The published login SDK is pinned; `patches/README.md` describes the cancellation patch.

In an Extension Development Host:

1. Sign in with Opper, approve through the organization's SSO, and make a chat request.
2. Try a tool-using request with a model that reports tool support.
3. Hover and click the Opper footer; check allowance, spend, remaining and reset date.
4. Verify organization finance is absent for a user without billing:read.
5. Renew sign-in; verify new credential metadata and rejection of the old key.
6. Cancel approval, deny approval, and verify sign-out survives a window reload.
7. Verify model policy changes appear after refreshing models.

On 30 September 2026, device initiation accepted both sign-in and renewal for
VS Code and CLI. José verified VS Code browser sign-in, inference and the budget
panel. End-to-end production renewal and a restricted billing account still
require live acceptance checks; automated fixtures cover the client behavior.

The status-bar context summary describes the last Opper request, not necessarily
the currently selected chat. Budget snapshots can lag recently completed usage.

Release workflow: merge the tested PR, push a tag matching package.json, then
monitor the Publish workflow. The workflow publishes the VSIX to Marketplace and
attaches it to the GitHub release. Do not include credentials in release artifacts.
