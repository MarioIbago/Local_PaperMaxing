# Local PaperMaxing

**PaperMaxing that runs on your own computer.** No Vercel, no Python, no NotebookLM gateway, no database, and no PaperMaxing cloud backend.

The app is a React/Vite frontend plus a tiny local Node.js gateway. PDFs are parsed in the browser with PDF.js. You choose the LLM provider from Settings and the local gateway calls it.

## Install once

Requirements: Node.js 22+.

```bash
git clone https://github.com/MarioIbago/Local_PaperMaxing.git
cd Local_PaperMaxing
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

That single `npm run dev` starts both:

```text
React / Vite UI        http://127.0.0.1:5173
Local Node API         http://127.0.0.1:8787
```

Vite proxies `/api/*` to the local Node process, so the browser never talks directly to cloud provider APIs.

## Providers

The UI currently supports:

| Provider | Default endpoint | API key |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434` | No |
| LM Studio | `http://127.0.0.1:1234/v1` | Optional |
| OpenAI-compatible | configurable | Optional |
| Google Gemini | Gemini Developer API | Yes |
| OpenRouter | OpenRouter API | Yes |
| OpenAI | OpenAI API | Yes |
| Anthropic Claude | Anthropic API | Yes |

Model IDs and base URLs are editable. Nothing is hard-wired to one provider.

## Fully local / free path

For the most local setup, use Ollama or LM Studio.

### Ollama example

Install Ollama, then download a model once:

```bash
ollama pull gemma3:4b
```

Start Ollama normally. In PaperMaxing choose:

```text
Provider: Ollama
Model: gemma3:4b
Base URL: http://127.0.0.1:11434
```

Press **Save** and **Test connection**.

After the model has been downloaded, the PaperMaxing app, PDF extraction, local gateway, prompt, and model inference can all stay on your machine.

### LM Studio example

1. Download a model in LM Studio.
2. Start **Local Server**.
3. In PaperMaxing select **LM Studio**.
4. Use the model ID exposed by LM Studio.
5. Save and test.

## Cloud/free-tier providers

You can also configure Gemini, OpenRouter, OpenAI or Claude. Their API keys are entered in the local UI and sent only to the local Node gateway.

Gemini can be useful with a Google project/API key that has Free Tier quota. Free-tier availability and limits are controlled by Google, not by PaperMaxing.

## Where secrets are stored

Provider configuration is written locally to:

```text
.papermaxing/config.json
```

That directory is included in `.gitignore` and is never meant to be committed.

The settings endpoint deliberately does **not** send stored API keys back to the browser. It only returns whether a key exists.

On POSIX systems the gateway attempts to save the file with mode `0600`. On Windows, filesystem permissions follow Windows ACL behavior.

## What stays local

```text
PDF file
   ↓
PDF.js in browser
   ↓
extracted text
   ↓
127.0.0.1:8787 local Node gateway
   ↓
selected provider
```

- The original PDF is not uploaded to a PaperMaxing server.
- There is no PaperMaxing account or central database.
- Provider settings live on your computer.
- With Ollama/LM Studio, inference can also remain local.
- With Gemini/OpenRouter/OpenAI/Claude, the relevant extracted text leaves your computer and is sent to that provider when you request analysis/chat.

## Paper workflow

1. Choose/configure a provider.
2. Press **Test connection**. This performs a real model request.
3. Load a PDF or paste extracted paper text.
4. Press **Analyze paper**.
5. Ask follow-up questions grounded in the extracted paper text.

The current extraction cap is enforced client-side so accidental giant requests are avoided.

## Diagnostics

While the app is running:

```bash
npm run doctor
```

This checks common local endpoints for Ollama, LM Studio and the PaperMaxing API.

You can also inspect:

```text
http://127.0.0.1:8787/api/health
```

## Production-style local run

Build the frontend:

```bash
npm run build
npm start
```

The Node gateway will serve the built `dist/` app and its API locally. The development command remains the easiest way to work on the project.

## Why there is no Python

The local gateway is written entirely in Node.js and uses Node's built-in `fetch`. PDF extraction is done by PDF.js in the browser. No Python environment, Docker container or NotebookLM session is required.

## Security boundary

This project is intentionally local-first, not a public multi-user server. Do not expose port `8787` directly to the internet: it can use the provider credentials stored on the machine.

## Repository split

`Local_PaperMaxing` is the local-first implementation. The main `PaperMaxing` repository can continue experimenting with hosted/NotebookLM workflows without making this local version depend on them.
