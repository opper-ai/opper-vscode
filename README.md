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

Press **F5** to open an Extension Development Host. See [review notes](prototype/REVIEW.md) for testing and release status.

## License

MIT © Opper Technology AB
