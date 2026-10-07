# Project Graph PG1.1

PG1.1 builds on the customized PG1.0 source and keeps its node-width behavior, keyboard shortcuts, and existing AI API settings. The new connection choice defaults to **Custom API**, so older settings continue using the original API route.

## ChatGPT account connection

In **Settings → AI → API**, choose **ChatGPT account**, then select **Sign in with ChatGPT**. Project Graph opens the OpenAI authorization page in the system browser and returns through a local `127.0.0.1` callback. The app does not ask for an OpenAI API key.

OAuth credentials are stored encrypted for the current Windows user with DPAPI, in the app's local data directory. They are not written to project files or settings, and are never sent to telemetry. Inference goes to OpenAI's public Responses API with streaming enabled and response storage disabled.

ChatGPT plan use follows OpenAI's current limits. This route currently accepts text conversations and function tools executed by Project Graph. It does not use hosted MCP/connectors, file search, Code Interpreter, audio/video, or file uploads. Requests requiring unsupported input or hosted tools fail with an error; they do not fall back to the Custom API route.

To return to the original AI setup, select **Custom API** in the same setting. Existing API address, key, model, context window, token display, and local MCP settings remain available.

## Windows installation

The PG1.1 installer and start-menu entry are labeled **Project Graph PG1.1** so they are distinguishable from PG1.0. PG1.1 retains the existing custom app-data identity to keep the user's prior settings available. The installer is produced as a Windows NSIS `.exe` by the `Project-Graph-PG1.1-Windows` GitHub Actions workflow.
