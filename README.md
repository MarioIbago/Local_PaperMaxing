# Local PaperMaxing

Local-first experimental PaperMaxing client that tests **Google OAuth + Gemini Developer API Free Tier** without Python, NotebookLM, Docker, or a Gemini API key pasted into the app.

## What this prototype does

1. The user enters their own Google Cloud **Project ID** and OAuth **Web Client ID**.
2. The browser opens the official Google OAuth account picker.
3. Google returns a short-lived OAuth access token to the browser.
4. Local PaperMaxing sends that token to the official Gemini Developer API together with the user's quota project.
5. PDFs are parsed locally in the browser with PDF.js.
6. Only extracted paper text is sent to Gemini when the user explicitly asks for analysis or asks a question.

The OAuth access token is kept only in React memory. It is not written to localStorage or committed to GitHub. The Client ID, Project ID, and selected model can be saved in localStorage because those values are configuration, not bearer credentials.

## Important limitation: Google Sign-In does not create free Gemini quota by itself

Gemini OAuth requests still need a **quota project**. For this local experiment, the person signing in should use a Google Cloud project they own or a project where they have permission to consume services (`serviceusage.services.use`). The Free Tier belongs to that project.

This makes the design useful for Local PaperMaxing: each technical user can bring their own Google project and use that project's Free Tier without sharing a central PaperMaxing API key.

It is **not** yet a zero-setup public-login system where any random Google account automatically brings personal Gemini API quota. A public SaaS would need a different quota/billing architecture or an onboarding flow that provisions/links projects.

## Free models used by the UI

- `gemini-2.5-flash-lite`
- `gemini-2.5-flash`

Google currently lists both with Free Tier input/output subject to rate limits. Free-tier prompts may be used by Google to improve products; do not use confidential material unless that is acceptable for your use case.

## One-time Google Cloud setup

Use the same Google account that will sign in to Local PaperMaxing.

1. Create or choose a Google Cloud project.
2. Enable **Generative Language API** (`generativelanguage.googleapis.com`).
3. Open **Google Auth Platform** and configure an OAuth consent screen.
4. For a private test, add your Google account as a test user if required.
5. Create an OAuth 2.0 Client ID with application type **Web application**.
6. Add this Authorized JavaScript origin:

```text
http://localhost:5173
```

7. Copy the OAuth Client ID and the Google Cloud Project ID.

For OAuth requests that use the project for quota, the signed-in account must have permission to consume services from that project. Project owners normally already have the required permission.

## Run locally

```bash
git clone https://github.com/MarioIbago/Local_PaperMaxing.git
cd Local_PaperMaxing
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Then:

1. Paste the OAuth Web Client ID.
2. Paste the Project ID.
3. Click **Continuar con Google**.
4. Choose the account that owns/has access to the project.
5. Load a PDF or paste paper text.
6. Click **Analizar paper** or ask a question.

## Request path

```text
PDF
  ↓ (PDF.js, local browser only)
extracted text
  ↓
Google OAuth access token
  ↓
Gemini Developer API
  ↓
Local PaperMaxing result
```

No Python process and no NotebookLM gateway are required.

## OAuth scopes used

The experiment asks for:

```text
openid
email
profile
https://www.googleapis.com/auth/cloud-platform
https://www.googleapis.com/auth/generative-language.retriever
```

Google's Gemini OAuth documentation demonstrates user OAuth credentials with Generative Language API enabled and a quota project sent through `x-goog-user-project`.

## Why this repo exists separately

`Local_PaperMaxing` is intentionally isolated from the main `PaperMaxing` repository so OAuth/Gemini experiments can be validated without breaking the NotebookLM/OpenRouter implementation in the primary project.
