import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, ".papermaxing");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const PORT = Number(process.env.PAPERMAXING_API_PORT || 8787);

const PROVIDERS = {
  ollama: {
    name: "Ollama",
    kind: "local",
    description: "Modelos totalmente locales. Sin API key.",
    defaultModel: "gemma3:4b",
    defaultBaseUrl: "http://127.0.0.1:11434",
    apiKeyMode: "none",
  },
  lmstudio: {
    name: "LM Studio",
    kind: "local",
    description: "Servidor OpenAI-compatible de LM Studio. Sin API key por defecto.",
    defaultModel: "local-model",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    apiKeyMode: "optional",
  },
  compatible: {
    name: "OpenAI-compatible",
    kind: "local-or-remote",
    description: "Cualquier servidor con /v1/chat/completions: llama.cpp, vLLM, LocalAI, etc.",
    defaultModel: "model",
    defaultBaseUrl: "http://127.0.0.1:8080/v1",
    apiKeyMode: "optional",
  },
  gemini: {
    name: "Google Gemini",
    kind: "cloud",
    description: "Gemini Developer API. Puedes usar un proyecto con Free Tier.",
    defaultModel: "gemini-2.5-flash-lite",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyMode: "required",
  },
  openrouter: {
    name: "OpenRouter",
    kind: "cloud",
    description: "Catálogo de modelos vía OpenRouter.",
    defaultModel: "openrouter/auto",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiKeyMode: "required",
  },
  openai: {
    name: "OpenAI",
    kind: "cloud",
    description: "API oficial de OpenAI.",
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyMode: "required",
  },
  anthropic: {
    name: "Anthropic Claude",
    kind: "cloud",
    description: "API oficial de Anthropic.",
    defaultModel: "claude-sonnet-4-5",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    apiKeyMode: "required",
  },
};

function defaultConfig() {
  return {
    selectedProvider: "ollama",
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, provider]) => [
        id,
        {
          model: provider.defaultModel,
          baseUrl: provider.defaultBaseUrl,
          apiKey: "",
        },
      ]),
    ),
  };
}

async function loadConfig() {
  const defaults = defaultConfig();
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
    const merged = {
      selectedProvider: PROVIDERS[raw.selectedProvider] ? raw.selectedProvider : defaults.selectedProvider,
      providers: { ...defaults.providers },
    };
    for (const id of Object.keys(PROVIDERS)) {
      const current = raw.providers?.[id];
      if (!current || typeof current !== "object") continue;
      merged.providers[id] = {
        model: typeof current.model === "string" && current.model.trim() ? current.model.trim() : defaults.providers[id].model,
        baseUrl: typeof current.baseUrl === "string" && current.baseUrl.trim() ? current.baseUrl.trim().replace(/\/$/, "") : defaults.providers[id].baseUrl,
        apiKey: typeof current.apiKey === "string" ? current.apiKey : "",
      };
    }
    return merged;
  } catch {
    return defaults;
  }
}

async function saveConfig(config) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try { await fs.chmod(CONFIG_FILE, 0o600); } catch { /* Windows ignores POSIX modes. */ }
}

function publicSettings(config) {
  return {
    selectedProvider: config.selectedProvider,
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, definition]) => [
        id,
        {
          id,
          ...definition,
          model: config.providers[id].model,
          baseUrl: config.providers[id].baseUrl,
          hasApiKey: Boolean(config.providers[id].apiKey),
        },
      ]),
    ),
    configPath: CONFIG_FILE,
  };
}

function cleanUpdate(current, body) {
  const next = structuredClone(current);
  if (typeof body.selectedProvider === "string" && PROVIDERS[body.selectedProvider]) {
    next.selectedProvider = body.selectedProvider;
  }
  const incomingProviders = body.providers && typeof body.providers === "object" ? body.providers : {};
  for (const id of Object.keys(PROVIDERS)) {
    const incoming = incomingProviders[id];
    if (!incoming || typeof incoming !== "object") continue;
    if (typeof incoming.model === "string" && incoming.model.trim()) next.providers[id].model = incoming.model.trim();
    if (typeof incoming.baseUrl === "string" && incoming.baseUrl.trim()) next.providers[id].baseUrl = incoming.baseUrl.trim().replace(/\/$/, "");
    if (incoming.apiKey === "__CLEAR__") next.providers[id].apiKey = "";
    else if (typeof incoming.apiKey === "string" && incoming.apiKey.trim()) next.providers[id].apiKey = incoming.apiKey.trim();
  }
  return next;
}

async function requestJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!response.ok) {
      const nested = data?.error?.message || data?.message || data?.error || raw || `HTTP ${response.status}`;
      throw new Error(typeof nested === "string" ? nested.slice(0, 1000) : JSON.stringify(nested).slice(0, 1000));
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("El proveedor tardó más de 120 segundos en responder.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function requireKey(id, config) {
  const definition = PROVIDERS[id];
  const key = config.providers[id].apiKey;
  if (definition.apiKeyMode === "required" && !key) {
    throw new Error(`${definition.name} necesita una API key. Configúrala en Settings.`);
  }
  return key;
}

function chatCompletionText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || "").filter(Boolean).join("\n").trim();
  return "";
}

async function runProvider({ providerId, model, system, prompt, config }) {
  const definition = PROVIDERS[providerId];
  if (!definition) throw new Error("Proveedor desconocido.");
  const provider = config.providers[providerId];
  const selectedModel = model?.trim() || provider.model || definition.defaultModel;
  const baseUrl = (provider.baseUrl || definition.defaultBaseUrl).replace(/\/$/, "");
  const apiKey = requireKey(providerId, config);
  let data;
  let text = "";

  if (providerId === "ollama") {
    data = await requestJson(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    text = data?.message?.content || "";
  } else if (providerId === "gemini") {
    data = await requestJson(`${baseUrl}/models/${encodeURIComponent(selectedModel)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    });
    const parts = data?.candidates?.[0]?.content?.parts;
    text = Array.isArray(parts) ? parts.map((part) => part?.text || "").filter(Boolean).join("\n") : "";
  } else if (providerId === "anthropic") {
    data = await requestJson(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    text = Array.isArray(data?.content) ? data.content.map((part) => part?.text || "").filter(Boolean).join("\n") : "";
  } else {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (providerId === "openrouter") {
      headers["HTTP-Referer"] = "http://localhost:5173";
      headers["X-Title"] = "Local PaperMaxing";
    }
    data = await requestJson(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: selectedModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    text = chatCompletionText(data);
  }

  if (!String(text).trim()) throw new Error(`${definition.name} respondió sin texto.`);
  return { text: String(text).trim(), provider: providerId, providerName: definition.name, model: data?.model || selectedModel };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));

app.get("/api/health", async (_request, response) => {
  response.json({ ok: true, mode: "local", node: process.version, configPath: CONFIG_FILE });
});

app.get("/api/settings", async (_request, response) => {
  response.json(publicSettings(await loadConfig()));
});

app.post("/api/settings", async (request, response) => {
  try {
    const current = await loadConfig();
    const next = cleanUpdate(current, request.body || {});
    await saveConfig(next);
    response.json({ ok: true, ...publicSettings(next) });
  } catch (error) {
    response.status(400).json({ ok: false, error: error instanceof Error ? error.message : "No se pudo guardar la configuración." });
  }
});

app.post("/api/providers/test", async (request, response) => {
  const started = Date.now();
  try {
    const config = await loadConfig();
    const providerId = request.body?.provider || config.selectedProvider;
    const result = await runProvider({
      providerId,
      model: request.body?.model,
      system: "You are a connection test. Follow the instruction exactly.",
      prompt: "Reply with exactly: PAPERMAXING_OK",
      config,
    });
    response.json({ ok: true, ...result, latencyMs: Date.now() - started });
  } catch (error) {
    response.status(502).json({ ok: false, error: error instanceof Error ? error.message : "La prueba falló.", latencyMs: Date.now() - started });
  }
});

app.post("/api/chat", async (request, response) => {
  try {
    const config = await loadConfig();
    const providerId = request.body?.provider || config.selectedProvider;
    const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
    if (!prompt) return response.status(400).json({ error: "prompt es requerido." });
    const system = typeof request.body?.system === "string" && request.body.system.trim()
      ? request.body.system.trim()
      : "You are PaperMaxing, a careful academic research assistant.";
    const result = await runProvider({ providerId, model: request.body?.model, system, prompt, config });
    response.json(result);
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "El proveedor falló." });
  }
});

const dist = path.join(ROOT, "dist");
try {
  await fs.access(dist);
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_request, response) => response.sendFile(path.join(dist, "index.html")));
} catch {
  // In development Vite serves the frontend and proxies /api here.
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Local PaperMaxing API: http://127.0.0.1:${PORT}`);
  console.log(`Config local: ${CONFIG_FILE}`);
});
