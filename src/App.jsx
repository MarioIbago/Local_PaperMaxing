import { useEffect, useMemo, useState } from "react";
import { extractPdfText } from "./pdf";

async function api(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function analysisPrompt(title, text) {
  return `Analyze ONLY the supplied research-paper text. Do not invent facts, citations, methods, sample sizes, results, statistics, or limitations. When something is not visible in the extracted source, say so explicitly.

Return the answer in Spanish with exactly these sections:
# Resumen
# Pregunta de investigación
# Metodología
# Hallazgos principales
# Limitaciones
# Evidencia clave del texto
# Qué revisar manualmente

PAPER: ${title || "Untitled paper"}

EXTRACTED PAPER TEXT:
${text}`;
}

function questionPrompt(title, text, question) {
  return `Answer the question using ONLY the supplied paper text. Be precise and conservative. If the source does not support the answer, say that clearly. Answer in Spanish.

PAPER: ${title || "Untitled paper"}
QUESTION: ${question}

EXTRACTED PAPER TEXT:
${text}`;
}

function providerReady(provider) {
  if (!provider) return false;
  if (provider.apiKeyMode === "required") return provider.hasApiKey;
  return true;
}

export default function App() {
  const [settings, setSettings] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState("ollama");
  const [draft, setDraft] = useState({ model: "", baseUrl: "", apiKey: "" });
  const [settingsState, setSettingsState] = useState("loading");
  const [settingsMessage, setSettingsMessage] = useState("Cargando configuración local…");
  const [testing, setTesting] = useState(false);
  const [paperName, setPaperName] = useState("");
  const [paperText, setPaperText] = useState("");
  const [paperMeta, setPaperMeta] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [analysisMeta, setAnalysisMeta] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    api("/api/settings")
      .then((value) => {
        setSettings(value);
        setSelectedProvider(value.selectedProvider);
        const provider = value.providers[value.selectedProvider];
        setDraft({ model: provider.model, baseUrl: provider.baseUrl, apiKey: "" });
        setSettingsState("idle");
        setSettingsMessage("Configuración cargada desde tu equipo.");
      })
      .catch((error) => {
        setSettingsState("error");
        setSettingsMessage(error instanceof Error ? error.message : "No se pudo conectar al backend local.");
      });
  }, []);

  const provider = settings?.providers?.[selectedProvider] || null;
  const configured = providerReady(provider);
  const providerList = useMemo(() => settings ? Object.values(settings.providers) : [], [settings]);

  const chooseProvider = (id) => {
    const next = settings?.providers?.[id];
    if (!next) return;
    setSelectedProvider(id);
    setDraft({ model: next.model, baseUrl: next.baseUrl, apiKey: "" });
    setSettingsState("idle");
    setSettingsMessage(`${next.name} seleccionado. Guarda y prueba la conexión.`);
  };

  const saveCurrent = async ({ quiet = false } = {}) => {
    if (!provider) throw new Error("No hay proveedor seleccionado.");
    if (!draft.model.trim()) throw new Error("Escribe el ID del modelo.");
    if (!draft.baseUrl.trim()) throw new Error("Escribe la URL del proveedor.");
    if (!quiet) {
      setSettingsState("saving");
      setSettingsMessage("Guardando configuración en tu equipo…");
    }
    const payload = {
      selectedProvider,
      providers: {
        [selectedProvider]: {
          model: draft.model.trim(),
          baseUrl: draft.baseUrl.trim(),
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        },
      },
    };
    const value = await api("/api/settings", { method: "POST", body: JSON.stringify(payload) });
    setSettings(value);
    setDraft((current) => ({ ...current, apiKey: "" }));
    if (!quiet) {
      setSettingsState("ok");
      setSettingsMessage(`Guardado localmente. ${value.providers[selectedProvider].name} es el proveedor activo.`);
    }
    return value;
  };

  const saveSettings = async () => {
    try {
      await saveCurrent();
    } catch (error) {
      setSettingsState("error");
      setSettingsMessage(error instanceof Error ? error.message : "No se pudo guardar.");
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setSettingsState("testing");
    setSettingsMessage("Guardando y enviando una prueba real…");
    try {
      await saveCurrent({ quiet: true });
      const result = await api("/api/providers/test", {
        method: "POST",
        body: JSON.stringify({ provider: selectedProvider, model: draft.model.trim() }),
      });
      setSettingsState("ok");
      setSettingsMessage(`Conectado a ${result.providerName} · ${result.model} · ${result.latencyMs} ms`);
    } catch (error) {
      setSettingsState("error");
      setSettingsMessage(error instanceof Error ? error.message : "La prueba del proveedor falló.");
    } finally {
      setTesting(false);
    }
  };

  const clearApiKey = async () => {
    if (!provider || provider.apiKeyMode === "none") return;
    setSettingsState("saving");
    try {
      const value = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          selectedProvider,
          providers: { [selectedProvider]: { apiKey: "__CLEAR__", model: draft.model, baseUrl: draft.baseUrl } },
        }),
      });
      setSettings(value);
      setDraft((current) => ({ ...current, apiKey: "" }));
      setSettingsState("ok");
      setSettingsMessage("API key eliminada del archivo local.");
    } catch (error) {
      setSettingsState("error");
      setSettingsMessage(error instanceof Error ? error.message : "No se pudo eliminar la clave.");
    }
  };

  const onPdf = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setAnalysis("");
    setAnswer("");
    try {
      const extracted = await extractPdfText(file);
      setPaperName(file.name);
      setPaperText(extracted.text);
      setPaperMeta(extracted);
    } catch (error) {
      setPaperName(file.name);
      setPaperText("");
      setPaperMeta({ error: error instanceof Error ? error.message : "No se pudo leer el PDF." });
    } finally {
      setExtracting(false);
    }
  };

  const runPrompt = async (prompt) => api("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      provider: selectedProvider,
      model: provider?.model,
      system: "You are PaperMaxing, a careful academic research assistant. Ground every claim in the supplied source text and never fabricate citations.",
      prompt,
    }),
  });

  const analyze = async () => {
    if (!paperText || !configured) return;
    setAnalyzing(true);
    setAnalysis("");
    setAnalysisMeta(null);
    try {
      const result = await runPrompt(analysisPrompt(paperName, paperText));
      setAnalysis(result.text);
      setAnalysisMeta(result);
    } catch (error) {
      setAnalysis(`ERROR: ${error instanceof Error ? error.message : "No se pudo analizar el paper."}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const ask = async () => {
    const cleanQuestion = question.trim();
    if (!paperText || !cleanQuestion || !configured) return;
    setAsking(true);
    setAnswer("");
    try {
      const result = await runPrompt(questionPrompt(paperName, paperText, cleanQuestion));
      setAnswer(result.text);
    } catch (error) {
      setAnswer(`ERROR: ${error instanceof Error ? error.message : "No se pudo responder."}`);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Local PaperMaxing">PAPER<span>MAXING</span><small>LOCAL</small></a>
        <div className="topbar-actions">
          <span className={`status-dot ${settingsState === "ok" || configured ? "online" : ""}`} />
          <span>{provider ? `${provider.name} · ${provider.kind}` : "Backend local"}</span>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1>Todo local.<br />Elige el<br /><em>cerebro.</em></h1>
            <p>
              PaperMaxing corre en tu computadora. El PDF se extrae en el navegador, las claves se guardan solo en tu disco y un backend Node local conecta el proveedor que tú elijas.
            </p>
          </div>
          <div className="principle-card">
            <span>Arquitectura local</span>
            <pre>{`PDF → navegador\n        ↓\n127.0.0.1:8787\n        ↓\n${provider?.name || "tu proveedor"}`}</pre>
          </div>
        </section>

        <section className="workspace-grid">
          <aside className="setup-panel panel">
            <div className="section-number">01</div>
            <h2>Proveedor</h2>
            <p className="muted">Configúralo una vez. Los secretos nunca se devuelven al navegador después de guardarlos.</p>

            <label>
              <span>Provider</span>
              <select value={selectedProvider} onChange={(event) => chooseProvider(event.target.value)} disabled={!settings}>
                {providerList.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.kind}</option>)}
              </select>
            </label>

            {provider ? <p className="provider-description">{provider.description}</p> : null}

            <label>
              <span>Model ID</span>
              <input value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} placeholder={provider?.defaultModel || "model"} />
            </label>

            <label>
              <span>Base URL</span>
              <input value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder={provider?.defaultBaseUrl || "http://127.0.0.1"} />
            </label>

            {provider && provider.apiKeyMode !== "none" ? (
              <label>
                <span>API key {provider.apiKeyMode === "optional" ? "(opcional)" : ""}</span>
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                  placeholder={provider.hasApiKey ? "Ya hay una clave guardada · escribe otra para reemplazarla" : "Pega tu clave"}
                  autoComplete="off"
                />
              </label>
            ) : null}

            <div className="button-row">
              <button className="primary-button" type="button" onClick={saveSettings} disabled={!provider || settingsState === "saving"}>Guardar</button>
              <button className="secondary-button" type="button" onClick={testConnection} disabled={!provider || testing}>{testing ? "Probando…" : "Probar conexión"}</button>
            </div>

            {provider?.hasApiKey ? <button className="text-button" type="button" onClick={clearApiKey}>Eliminar API key guardada</button> : null}
            <div className={`notice ${settingsState}`}>{settingsMessage}</div>

            <div className="setup-notes">
              <strong>Opciones sin costo por API</strong>
              <p><b>Ollama:</b> instala un modelo local, por ejemplo <code>ollama pull gemma3:4b</code>.</p>
              <p><b>LM Studio:</b> carga un modelo y activa Local Server.</p>
              <p><b>Gemini:</b> puedes usar la cuota Free Tier de tu propia clave/proyecto.</p>
              {settings?.configPath ? <p className="config-path">Config: <code>{settings.configPath}</code></p> : null}
            </div>
          </aside>

          <section className="paper-panel panel">
            <div className="section-number">02</div>
            <h2>Cargar paper</h2>
            <label className="drop-zone">
              <input type="file" accept="application/pdf,.pdf" onChange={onPdf} />
              <strong>{extracting ? "Extrayendo texto…" : paperName || "Selecciona un PDF"}</strong>
              <span>El archivo se procesa localmente con PDF.js.</span>
            </label>

            {paperMeta ? (
              <div className="paper-meta">
                {paperMeta.error ? <span>{paperMeta.error}</span> : (
                  <>
                    <span><b>{paperMeta.totalPages}</b> páginas</span>
                    <span><b>{paperMeta.pagesRead}</b> leídas</span>
                    <span><b>{paperText.length.toLocaleString()}</b> caracteres</span>
                    {paperMeta.truncated ? <span>Texto truncado al límite local</span> : null}
                  </>
                )}
              </div>
            ) : null}

            <textarea
              className="paper-text"
              value={paperText}
              onChange={(event) => {
                setPaperText(event.target.value);
                if (!paperName) setPaperName("Texto pegado");
              }}
              placeholder="También puedes pegar aquí el texto de un paper."
            />

            <button className="primary-button" type="button" onClick={analyze} disabled={!configured || !paperText || analyzing}>
              {analyzing ? `Analizando con ${provider?.name || "provider"}…` : "Analizar paper"}
            </button>
            {!configured ? <p className="inline-warning">Configura la API key del proveedor seleccionado antes de analizar.</p> : null}
          </section>
        </section>

        <section className="results panel">
          <div className="results-heading">
            <div><div className="section-number">03</div><h2>Análisis</h2></div>
            <span>{analysisMeta ? `${analysisMeta.providerName} · ${analysisMeta.model}` : `${provider?.name || "provider"} · ${provider?.model || draft.model}`}</span>
          </div>
          <div className="result-body">
            {analysis ? <pre>{analysis}</pre> : <p className="empty-state">Configura un proveedor, carga un paper y ejecuta el análisis.</p>}
          </div>
        </section>

        <section className="ask panel">
          <div className="section-number">04</div>
          <h2>Preguntar al paper</h2>
          <div className="ask-row">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) ask(); }}
              placeholder="¿Cuál es la metodología? ¿Qué limitaciones reporta?"
            />
            <button type="button" onClick={ask} disabled={!configured || !paperText || !question.trim() || asking}>{asking ? "Pensando…" : "Preguntar"}</button>
          </div>
          {answer ? <pre className="answer">{answer}</pre> : null}
        </section>

        <section className="truth-panel">
          <h2>Local significa local</h2>
          <p><b>PDF:</b> se lee en tu navegador y no se sube a PaperMaxing. Solo el texto necesario se envía al proveedor cuando haces una consulta.</p>
          <p><b>Con Ollama/LM Studio:</b> incluso la inferencia puede quedarse en tu computadora. Con proveedores cloud, el texto sí sale hacia ese proveedor.</p>
        </section>
      </main>

      <footer>Local PaperMaxing · Node + React · no Python · no Vercel</footer>
    </div>
  );
}
