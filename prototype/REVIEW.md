# Integration review notes

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

No custom EU/ZDR enforcement switches are needed. Optional model-kind
preferences only narrow the server-authorized set. Non-chat entries and entries
without valid context limits are omitted; routes no longer get an invented 128k
window. Model limits and tool/vision metadata still need to be correct server-side.

Live login retains optional `credential_id`, numeric `org_id`/`project_id`, and
`expires_at`; null means no expiry set, absent means unavailable. Locally known
expiry or runtime authentication rejection can show a sign-in action; the failed
turn is never replayed automatically. **The live renewal wire contract is now implemented through the shared login SDK.**
On 30 September, both clients accepted device sign-in and renewal initiation.
José completed VS Code sign-in and inference and reviewed the budget panel.
End-to-end production renewal still needs verification.

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
- Run **Opper: Sign In** to review browser login.
- Click the Opper footer, or run **Opper: Show Budget**.
- A numeric allowance/bar appears only when the project actually has a direct cap.
- **Opper: Renew Sign-in** now sends `renew` and `currentCredentialId` through the
  shared SDK. Production renewal is not yet verified; no failed model turn is replayed.

Local review checks: budget scope/permissions, zero/no-cap states, stale result
rejection, safe rendering, shared renewal metadata and cancellation. Visual
inspection in the extension host remains part of the local review.
