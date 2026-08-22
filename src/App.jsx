import { useMemo, useState } from "react";
import { extractPdfText } from "./pdf";
import {
  generateWithGemini,
  getGoogleProfile,
  requestGoogleAccessToken,
  testGeminiAccess,
} from "./gemini";

const STORAGE_KEY = "local-papermaxing-google-config";
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      clientId: typeof saved.clientId === "string" ? saved.clientId : "",
      projectId: typeof saved.projectId === "string" ? saved.projectId : "",
      model: typeof saved.model === "string" ? saved.model : DEFAULT_MODEL,
    };
  } catch {
    return { clientId: "", projectId: "", model: DEFAULT_MODEL };
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function analysisPrompt(title, text) {
  return `You are PaperMaxing, a careful academic research assistant. Analyze ONLY the supplied paper text. Do not invent facts, citations, methods, results, sample sizes, or limitations. If something is not visible in the extracted text, say so clearly.

Return the answer in Spanish with these exact sections:
# Resumen
# Pregunta de investigación
# Metodología
# Hallazgos principales
# Limitaciones
# Qué vale la pena revisar manualmente

PAPER: ${title || "Untitled paper"}

EXTRACTED PAPER TEXT:
${text}`;
}

function questionPrompt(title, text, question) {
  return `Answer the user's question using ONLY the supplied paper text. Be precise and conservative. If the answer is not supported by the text, say that it is not available in the extracted source. Answer in Spanish.

PAPER: ${title || "Untitled paper"}
QUESTION: ${question}

EXTRACTED PAPER TEXT:
${text}`;
}

export default function App() {
  const initial = useMemo(loadConfig, []);
  const [clientId, setClientId] = useState(initial.clientId);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [model, setModel] = useState(initial.model);
  const [accessToken, setAccessToken] = useState("");
  const [profile, setProfile] = useState(null);
  const [googleState, setGoogleState] = useState("idle");
  const [googleMessage, setGoogleMessage] = useState("");
  const [paperName, setPaperName] = useState("");
  const [paperText, setPaperText] = useState("");
  const [paperMeta, setPaperMeta] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  const connected = Boolean(accessToken && profile);
  const canUseGemini = connected && Boolean(projectId);

  const connectGoogle = async () => {
    const cleanClientId = clientId.trim();
    const cleanProjectId = projectId.trim();
    if (!cleanClientId || !cleanProjectId) {
      setGoogleState("error");
      setGoogleMessage("Agrega tu OAuth Client ID y tu Google Cloud Project ID primero.");
      return;
    }

    saveConfig({ clientId: cleanClientId, projectId: cleanProjectId, model });
    setGoogleState("loading");
    setGoogleMessage("Abriendo Google y comprobando Gemini…");

    try {
      const tokenResponse = await requestGoogleAccessToken(cleanClientId);
      const token = tokenResponse.access_token;
      const [user, models] = await Promise.all([
        getGoogleProfile(token),
        testGeminiAccess({ accessToken: token, projectId: cleanProjectId }),
      ]);
      setAccessToken(token);
      setProfile(user);
      setGoogleState("ok");
      const freeModelVisible = models.some((item) => item?.name?.endsWith(`/${model}`));
      setGoogleMessage(
        freeModelVisible
          ? `Gemini conectado. ${model} aparece disponible para este proyecto.`
          : `Gemini conectado. El proyecto respondió correctamente; verifica que ${model} esté habilitado antes de analizar.`,
      );
    } catch (error) {
      setAccessToken("");
      setProfile(null);
      setGoogleState("error");
      setGoogleMessage(error instanceof Error ? error.message : "No se pudo conectar con Google/Gemini.");
    }
  };

  const disconnectGoogle = () => {
    if (accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
    setAccessToken("");
    setProfile(null);
    setGoogleState("idle");
    setGoogleMessage("Sesión OAuth retirada del navegador.");
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

  const analyze = async () => {
    if (!canUseGemini || !paperText) return;
    saveConfig({ clientId, projectId, model });
    setAnalyzing(true);
    setAnalysis("");
    try {
      const text = await generateWithGemini({
        accessToken,
        projectId: projectId.trim(),
        model: model.trim() || DEFAULT_MODEL,
        prompt: analysisPrompt(paperName, paperText),
      });
      setAnalysis(text);
    } catch (error) {
      setAnalysis(`ERROR: ${error instanceof Error ? error.message : "No se pudo analizar el paper."}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const ask = async () => {
    const cleanQuestion = question.trim();
    if (!canUseGemini || !paperText || !cleanQuestion) return;
    setAsking(true);
    setAnswer("");
    try {
      const text = await generateWithGemini({
        accessToken,
        projectId: projectId.trim(),
        model: model.trim() || DEFAULT_MODEL,
        prompt: questionPrompt(paperName, paperText, cleanQuestion),
      });
      setAnswer(text);
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
          <span className={`status-dot ${connected ? "online" : ""}`} />
          <span>{connected ? "Google + Gemini conectados" : "Local-first"}</span>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1>Tus papers.<br />Tu cuenta.<br /><em>Tu cuota.</em></h1>
            <p>
              Una prueba de PaperMaxing sin Python, sin NotebookLM y sin una API key pegada en la app.
              El PDF se lee en tu navegador y Gemini se autoriza con Google OAuth.
            </p>
          </div>
          <div className="principle-card">
            <span>Arquitectura</span>
            <pre>{`PDF local\n   ↓\nGoogle OAuth\n   ↓\nGemini API\n   ↓\nPaperMaxing`}</pre>
          </div>
        </section>

        <section className="workspace-grid">
          <aside className="setup-panel panel">
            <div className="section-number">01</div>
            <h2>Conectar Google</h2>
            <p className="muted">
              Para esta prueba local, usa un proyecto de Google Cloud que pertenezca a la misma cuenta con la que iniciarás sesión.
            </p>

            <label>
              <span>OAuth Web Client ID</span>
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="123456789-...apps.googleusercontent.com"
                autoComplete="off"
              />
            </label>

            <label>
              <span>Google Cloud Project ID</span>
              <input
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                placeholder="my-gemini-project"
                autoComplete="off"
              />
            </label>

            <label>
              <span>Modelo</span>
              <select value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite — Free Tier</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash — Free Tier</option>
              </select>
            </label>

            {!connected ? (
              <button className="primary-button" type="button" onClick={connectGoogle} disabled={googleState === "loading"}>
                {googleState === "loading" ? "Conectando…" : "Continuar con Google"}
              </button>
            ) : (
              <div className="account-row">
                {profile?.picture ? <img src={profile.picture} alt="" referrerPolicy="no-referrer" /> : null}
                <div><strong>{profile?.name || "Google user"}</strong><small>{profile?.email || "OAuth activo"}</small></div>
                <button type="button" onClick={disconnectGoogle}>Salir</button>
              </div>
            )}

            {googleMessage ? <div className={`notice ${googleState}`}>{googleMessage}</div> : null}

            <div className="setup-notes">
              <strong>Antes del primer login</strong>
              <ol>
                <li>Habilita Generative Language API en tu proyecto.</li>
                <li>Crea un OAuth Client de tipo Web.</li>
                <li>Agrega <code>http://localhost:5173</code> como Authorized JavaScript origin.</li>
                <li>Tu cuenta debe poder consumir cuota de ese proyecto.</li>
              </ol>
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
                {paperMeta.error ? (
                  <span>{paperMeta.error}</span>
                ) : (
                  <>
                    <span><b>{paperMeta.totalPages}</b> páginas</span>
                    <span><b>{paperText.length.toLocaleString()}</b> caracteres extraídos</span>
                    {paperMeta.truncated ? <span>Texto limitado para la prueba</span> : null}
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
              placeholder="También puedes pegar aquí el texto de un paper para probar sin PDF."
            />

            <button className="primary-button" type="button" onClick={analyze} disabled={!canUseGemini || !paperText || analyzing}>
              {analyzing ? "Analizando con Gemini…" : "Analizar paper"}
            </button>
          </section>
        </section>

        <section className="results panel">
          <div className="results-heading">
            <div><div className="section-number">03</div><h2>Resultado</h2></div>
            <span>{model}</span>
          </div>
          <div className="result-body">
            {analysis ? <pre>{analysis}</pre> : <p className="empty-state">Conecta Google, carga un paper y ejecuta el análisis.</p>}
          </div>
        </section>

        <section className="ask panel">
          <div className="section-number">04</div>
          <h2>Preguntar al paper</h2>
          <div className="ask-row">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") ask(); }}
              placeholder="¿Cuál es la metodología? ¿Qué limitaciones reporta?"
            />
            <button type="button" onClick={ask} disabled={!canUseGemini || !paperText || !question.trim() || asking}>
              {asking ? "Pensando…" : "Preguntar"}
            </button>
          </div>
          {answer ? <pre className="answer">{answer}</pre> : null}
        </section>

        <section className="truth-panel">
          <h2>Qué significa “gratis” aquí</h2>
          <p>
            PaperMaxing no paga una API central por todos. La prueba intenta usar el proyecto de Google Cloud del propio usuario.
            Gemini 2.5 Flash y Flash-Lite tienen Free Tier con límites; si el proyecto deja el Free Tier o alcanza sus límites, Google puede rechazar solicitudes.
          </p>
          <p>
            En el Free Tier, Google indica que el contenido puede usarse para mejorar sus productos. No uses esta prueba con documentos que no debas enviar a Gemini.
          </p>
        </section>
      </main>

      <footer>Local PaperMaxing · OAuth experiment · no Python required</footer>
    </div>
  );
}
