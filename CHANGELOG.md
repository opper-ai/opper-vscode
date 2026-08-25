# Change Log

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
