import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runNotebookLMJson } from "./notebooklm-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, ".papermaxing");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const PORT = Number(process.env.PAPERMAXING_API_PORT || 8787);

const PROVIDERS = {
  notebooklm: {
    name: "NotebookLM",
    kind: "google-grounded",
    description: "NotebookLM usando el CLI local incluido y tu sesión de Google. Sin Docker, servidor Python ni API key.",
    defaultModel: "notebooklm",
    defaultBaseUrl: "local://notebooklm-cli",
    apiKeyMode: "none",
  },
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
    selectedProvider: "notebooklm",
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, provider]) => [
        id,
        { model: provider.defaultModel, baseUrl: provider.defaultBaseUrl, apiKey: "" },
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
  try { await fs.chmod(CONFIG_FILE, 0o600); } catch { /* Windows ACLs apply. */ }
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

function parseGroundedPrompt(prompt) {
  const marker = "EXTRACTED PAPER TEXT:\n";
  const index = prompt.lastIndexOf(marker);
  if (index === -1) return { question: prompt.trim(), sourceText: "", title: "PaperMaxing paper" };
  const question = prompt.slice(0, index).trim();
  const sourceText = prompt.slice(index + marker.length).trim();
  const titleMatch = question.match(/^PAPER:\s*(.+)$/mi);
  const title = titleMatch?.[1]?.trim() || "PaperMaxing paper";
  return { question, sourceText, title: title.slice(0, 180) };
}

function notebookIdFrom(raw) {
  return raw?.notebook?.id || raw?.notebook_id || raw?.id || "";
}

function sourceIdFrom(raw) {
  return raw?.source?.id || raw?.source_id || raw?.id || "";
}

async function runNotebookLM({ system, prompt }) {
  let notebookId = "";
  let promptFile = "";
  try {
    if (prompt.trim() === "Reply with exactly: PAPERMAXING_OK") {
      await runNotebookLMJson(["list", "--json"], { timeoutMs: 60_000 });
      return { text: "PAPERMAXING_OK", provider: "notebooklm", providerName: "NotebookLM", model: "notebooklm" };
    }

    const grounded = parseGroundedPrompt(prompt);
    if (!grounded.sourceText) {
      throw new Error("NotebookLM necesita el texto del paper como fuente. Carga un PDF o pega el texto antes de preguntar.");
    }

    const created = await runNotebookLMJson(
      ["create", `PaperMaxing · ${grounded.title}`, "--json"],
      { timeoutMs: 60_000 },
    );
    notebookId = notebookIdFrom(created);
    if (!notebookId) throw new Error("NotebookLM creó el notebook temporal pero no devolvió su ID.");

    const added = await runNotebookLMJson(
      ["source", "add", "-", "--type", "text", "--title", grounded.title, "-n", notebookId, "--json"],
      { stdin: grounded.sourceText, timeoutMs: 120_000 },
    );
    const sourceId = sourceIdFrom(added);
    if (!sourceId) throw new Error("NotebookLM recibió el paper pero no devolvió el ID de la fuente.");

    await runNotebookLMJson(
      ["source", "wait", sourceId, "-n", notebookId, "--timeout", "110", "--interval", "1", "--json"],
      { timeoutMs: 130_000 },
    );

    await fs.mkdir(TMP_DIR, { recursive: true });
    promptFile = path.join(TMP_DIR, `notebooklm-${crypto.randomUUID()}.txt`);
    await fs.writeFile(
      promptFile,
      `${system}\n\n${grounded.question}\n\nResponde usando únicamente las fuentes cargadas en este notebook. No inventes datos ni citas.`,
      "utf8",
    );

    const answer = await runNotebookLMJson(
      ["ask", "--prompt-file", promptFile, "-n", notebookId, "--json"],
      { timeoutMs: 180_000 },
    );
    const text = typeof answer?.answer === "string" ? answer.answer.trim() : "";
    if (!text) throw new Error("NotebookLM respondió sin texto.");

    return {
      text,
      provider: "notebooklm",
      providerName: "NotebookLM",
      model: "notebooklm",
      references: Array.isArray(answer?.references) ? answer.references : [],
      conversationId: typeof answer?.conversation_id === "string" ? answer.conversation_id : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/auth|cookie|login|storage_state|token_fetch|authentication/i.test(message)) {
      throw new Error("La sesión de Google para NotebookLM no es válida. Ejecuta npm run notebooklm:login y vuelve a probar.");
    }
    throw error;
  } finally {
    if (promptFile) await fs.rm(promptFile, { force: true }).catch(() => {});
    if (notebookId) {
      await runNotebookLMJson(["delete", "-n", notebookId, "--yes", "--json"], { timeoutMs: 60_000 }).catch(() => {});
    }
  }
}

async function runProvider({ providerId, model, system, prompt, config }) {
  const definition = PROVIDERS[providerId];
  if (!definition) throw new Error("Proveedor desconocido.");

  if (providerId === "notebooklm") return runNotebookLM({ system, prompt });

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
  console.log("NotebookLM: CLI local incluido · sin Docker · sin servidor Python");
  console.log(`Config local: ${CONFIG_FILE}`);
});
