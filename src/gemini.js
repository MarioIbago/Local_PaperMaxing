export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language.retriever",
].join(" ");

function detailFromGoogleError(payload, fallback) {
  if (payload && typeof payload === "object") {
    const error = payload.error;
    if (error && typeof error === "object" && typeof error.message === "string") return error.message;
    if (typeof payload.error_description === "string") return payload.error_description;
  }
  return fallback;
}

export function waitForGoogleIdentity(timeoutMs = 10000) {
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error("Google Identity Services no cargó. Revisa tu conexión o bloqueadores del navegador."));
      }
    }, 100);
  });
}

export async function requestGoogleAccessToken(clientId) {
  await waitForGoogleIdentity();

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      include_granted_scopes: true,
      callback: (response) => {
        if (response?.access_token) resolve(response);
        else reject(new Error(detailFromGoogleError(response, "Google no devolvió un access token.")));
      },
      error_callback: (error) => reject(new Error(error?.type || "No se pudo abrir Google OAuth.")),
    });

    client.requestAccessToken({ prompt: "select_account" });
  });
}

export async function getGoogleProfile(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("No se pudo leer el perfil de Google.");
  return response.json();
}

export async function testGeminiAccess({ accessToken, projectId }) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-goog-user-project": projectId,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(detailFromGoogleError(payload, `Gemini respondió ${response.status}.`));
  }

  return Array.isArray(payload.models) ? payload.models : [];
}

export async function generateWithGemini({ accessToken, projectId, model, prompt }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-goog-user-project": projectId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(detailFromGoogleError(payload, `Gemini respondió ${response.status}.`));
  }

  const parts = payload?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((part) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean).join("\n")
    : "";

  if (!text) throw new Error("Gemini no devolvió texto.");
  return text.trim();
}
