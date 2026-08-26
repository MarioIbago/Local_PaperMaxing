import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const PAPERMAXING_DIR = path.join(ROOT, ".papermaxing");
export const NOTEBOOKLM_HOME = path.join(PAPERMAXING_DIR, "notebooklm");
export const NOTEBOOKLM_PROFILE = "papermaxing";
export const NOTEBOOKLM_API_URL = "http://127.0.0.1:8100";
export const NOTEBOOKLM_ZIP = path.join(ROOT, "notebook-llm.zip");
export const NOTEBOOKLM_RUNTIME_ROOT = path.join(PAPERMAXING_DIR, "runtime");
export const NOTEBOOKLM_BUNDLE_ROOT = path.join(NOTEBOOKLM_RUNTIME_ROOT, "notebook-llm");
export const NOTEBOOKLM_VENV = path.join(NOTEBOOKLM_BUNDLE_ROOT, ".venv");
export const NOTEBOOKLM_CLI = path.join(NOTEBOOKLM_VENV, "Scripts", "notebooklm.exe");
export const NOTEBOOKLM_SERVER = path.join(NOTEBOOKLM_VENV, "Scripts", "notebooklm-server.exe");
export const NOTEBOOKLM_PYTHON = path.join(NOTEBOOKLM_VENV, "Scripts", "python.exe");
const TOKEN_FILE = path.join(PAPERMAXING_DIR, "notebooklm-server-token.txt");

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function runSync(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: false,
    ...options,
  });
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function repairPortableVenv() {
  const current = runSync(NOTEBOOKLM_PYTHON, ["--version"]);
  if (current.status === 0) return;

  const probes = process.platform === "win32"
    ? [
        ["py", ["-3.12", "-c", "import sys; print(sys.base_prefix); print(sys.executable); print('.'.join(map(str, sys.version_info[:3])))"]],
        ["python", ["-c", "import sys; print(sys.base_prefix); print(sys.executable); print('.'.join(map(str, sys.version_info[:3])))"]],
      ]
    : [];

  for (const [command, args] of probes) {
    const probe = runSync(command, args);
    if (probe.status !== 0) continue;
    const lines = String(probe.stdout || "").trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 3 || !lines[2].startsWith("3.12.")) continue;
    const [home, executable, version] = lines;
    const cfg = `home = ${home}\ninclude-system-site-packages = false\nversion = ${version}\nexecutable = ${executable}\ncommand = ${executable} -m venv ${NOTEBOOKLM_VENV}\n`;
    await fs.writeFile(path.join(NOTEBOOKLM_VENV, "pyvenv.cfg"), cfg, "utf8");
    const retry = runSync(NOTEBOOKLM_PYTHON, ["--version"]);
    if (retry.status === 0) return;
  }

  throw new Error(
    "El runtime incluido existe, pero su Python 3.12 no puede arrancar en este equipo. " +
    "PaperMaxing no descargará nada automáticamente: instala/activa Python 3.12 o vuelve a generar notebook-llm.zip en este mismo equipo."
  );
}

export async function ensureNotebookLMRuntime() {
  if (process.platform !== "win32") {
    throw new Error("El notebook-llm.zip incluido es un runtime de Windows (Python 3.12 win_amd64). Usa Local PaperMaxing en Windows para este bundle.");
  }

  if (!(await exists(NOTEBOOKLM_PYTHON))) {
    if (!(await exists(NOTEBOOKLM_ZIP))) {
      throw new Error(`No encuentro ${NOTEBOOKLM_ZIP}. Copia notebook-llm.zip a la raíz de Local_PaperMaxing.`);
    }
    await fs.mkdir(NOTEBOOKLM_RUNTIME_ROOT, { recursive: true });
    console.log("[NotebookLM] Extrayendo el runtime local incluido (sin descargar nada)...");
    const script = `Expand-Archive -LiteralPath ${powershellQuote(NOTEBOOKLM_ZIP)} -DestinationPath ${powershellQuote(NOTEBOOKLM_RUNTIME_ROOT)} -Force`;
    const extracted = runSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "inherit" });
    if (extracted.status !== 0 || !(await exists(NOTEBOOKLM_PYTHON))) {
      throw new Error("No se pudo extraer notebook-llm.zip con PowerShell.");
    }
  }

  await repairPortableVenv();
  return {
    cli: NOTEBOOKLM_CLI,
    server: NOTEBOOKLM_SERVER,
    python: NOTEBOOKLM_PYTHON,
    home: NOTEBOOKLM_HOME,
    profile: NOTEBOOKLM_PROFILE,
  };
}

export async function getNotebookLMToken() {
  await fs.mkdir(PAPERMAXING_DIR, { recursive: true });
  try {
    const token = (await fs.readFile(TOKEN_FILE, "utf8")).trim();
    if (token) return token;
  } catch {
    // Create it below.
  }
  const token = crypto.randomBytes(32).toString("hex");
  await fs.writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  try { await fs.chmod(TOKEN_FILE, 0o600); } catch { /* Windows ACLs apply. */ }
  return token;
}

export async function notebookLMEnvironment() {
  const token = await getNotebookLMToken();
  await fs.mkdir(NOTEBOOKLM_HOME, { recursive: true });
  return {
    ...process.env,
    NOTEBOOKLM_HOME,
    NOTEBOOKLM_PROFILE,
    NOTEBOOKLM_SERVER_HOST: "127.0.0.1",
    NOTEBOOKLM_SERVER_PORT: "8100",
    NOTEBOOKLM_SERVER_TOKEN: token,
  };
}

async function authCheck({ quiet = false } = {}) {
  await ensureNotebookLMRuntime();
  const env = await notebookLMEnvironment();
  const result = runSync(NOTEBOOKLM_PYTHON, ["-m", "notebooklm", "-p", NOTEBOOKLM_PROFILE, "auth", "check", "--test", "--json"], {
    env,
    stdio: quiet ? "pipe" : "inherit",
  });
  return result.status === 0;
}

export async function ensureNotebookLMAuth({ interactive = true } = {}) {
  if (await authCheck({ quiet: true })) return true;
  if (!interactive) return false;

  console.log("\n[NotebookLM] Falta iniciar sesión o la sesión expiró.");
  console.log("[NotebookLM] Abriré Google en tu Chrome instalado. No se descargará Chromium.\n");
  const env = await notebookLMEnvironment();
  const login = spawnSync(
    NOTEBOOKLM_PYTHON,
    ["-m", "notebooklm", "-p", NOTEBOOKLM_PROFILE, "login", "--browser", "chrome"],
    { cwd: ROOT, env, stdio: "inherit", windowsHide: false }
  );
  if (login.status !== 0) {
    throw new Error("El inicio de sesión de NotebookLM no terminó correctamente.");
  }
  if (!(await authCheck({ quiet: true }))) {
    throw new Error("Google abrió, pero NotebookLM todavía no puede validar la sesión.");
  }
  console.log("[NotebookLM] Sesión validada.\n");
  return true;
}

export async function probeNotebookLM() {
  const token = await getNotebookLMToken();
  const health = await fetch(`${NOTEBOOKLM_API_URL}/healthz`);
  if (!health.ok) throw new Error(`NotebookLM health respondió HTTP ${health.status}.`);
  const notebooks = await fetch(`${NOTEBOOKLM_API_URL}/v1/notebooks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!notebooks.ok) {
    const detail = await notebooks.text();
    throw new Error(`NotebookLM auth respondió HTTP ${notebooks.status}: ${detail.slice(0, 400)}`);
  }
  return true;
}

export async function serveNotebookLM() {
  await ensureNotebookLMRuntime();
  const env = await notebookLMEnvironment();
  console.log(`[NotebookLM] Gateway local: ${NOTEBOOKLM_API_URL}`);
  const child = spawn(NOTEBOOKLM_PYTHON, ["-m", "notebooklm.server"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
    windowsHide: false,
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) return resolve();
      if (code === 0) return resolve();
      reject(new Error(`notebooklm-server terminó con código ${code}.`));
    });
  });
}

async function main() {
  const command = process.argv[2] || "prepare";
  if (command === "prepare") {
    await ensureNotebookLMRuntime();
    console.log("[NotebookLM] Runtime listo.");
    return;
  }
  if (command === "login") {
    await ensureNotebookLMRuntime();
    const env = await notebookLMEnvironment();
    const result = spawnSync(NOTEBOOKLM_PYTHON, ["-m", "notebooklm", "-p", NOTEBOOKLM_PROFILE, "login", "--browser", "chrome"], {
      cwd: ROOT,
      env,
      stdio: "inherit",
      windowsHide: false,
    });
    process.exitCode = result.status ?? 1;
    return;
  }
  if (command === "ensure-auth") {
    await ensureNotebookLMAuth({ interactive: true });
    return;
  }
  if (command === "auth-check") {
    process.exitCode = (await authCheck({ quiet: false })) ? 0 : 1;
    return;
  }
  if (command === "serve") {
    await serveNotebookLM();
    return;
  }
  if (command === "probe") {
    await probeNotebookLM();
    console.log("[NotebookLM] Gateway y sesión OK.");
    return;
  }
  throw new Error(`Comando desconocido: ${command}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`[NotebookLM] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
