# Opper for VS Code

Use [Opper](https://opper.ai) models in VS Code Copilot Chat, including Agent mode with supported models.

## Get started

1. Install the extension.
2. Run **Opper: Sign In** from the Command Palette and approve in your browser.
3. Open Chat and choose an Opper model.

Use your existing Opper account, including your organization’s configured SSO. No Opper CLI installation or manual key copying is needed. Credentials are stored in VS Code’s secure storage.

## Models and access

The model picker loads the models, pools, and dynamic routes available to your key. Your organization manages access and policies in Opper.

Use **Opper: Account and Models** to view your account, manage sign-in, or choose which model types appear.

## Thinking effort

Run **Opper: Set Thinking Effort**, or choose **Set thinking effort…** from the Opper model menu. Select a model or pool, then one of the levels advertised by the gateway. **Server default** removes the override.

The selection is saved per API endpoint and exact model ID and applies across conversations. The model details show the saved effort. Explicit request options take precedence. A saved level that becomes unavailable blocks the request with instructions to choose another level or reset it.

Pools offer only efforts shared by their allowed members. Dynamic routes and models without effort metadata do not offer configurable levels. This uses a separate Opper control because VS Code’s native Thinking Effort submenu API is still proposed.

## Usage and budget

Hover over **Opper** in the status bar for a usage summary. Click it to see your project’s spending, allowance, remaining amount, and reset date, where configured.

Organization billing details appear only when you have permission to view them.

## Development

Requires VS Code 1.104 or later.

```sh
npm install
npm run compile
npm test
```

Press **F5** to open an Extension Development Host.

## License

MIT © Opper Technology AB
