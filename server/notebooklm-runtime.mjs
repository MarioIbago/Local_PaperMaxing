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
export const NOTEBOOKLM_ZIP = path.join(ROOT, "notebook-llm.zip");
export const NOTEBOOKLM_RUNTIME_ROOT = path.join(PAPERMAXING_DIR, "runtime");
export const NOTEBOOKLM_BUNDLE_ROOT = path.join(NOTEBOOKLM_RUNTIME_ROOT, "notebook-llm");
export const NOTEBOOKLM_VENV = path.join(NOTEBOOKLM_BUNDLE_ROOT, ".venv");
export const NOTEBOOKLM_PYTHON = path.join(NOTEBOOKLM_VENV, "Scripts", "python.exe");

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
    "PaperMaxing no descargará nada automáticamente: activa Python 3.12 o vuelve a generar notebook-llm.zip en este equipo."
  );
}

export async function ensureNotebookLMRuntime() {
  if (process.platform !== "win32") {
    throw new Error("El notebook-llm.zip recibido contiene binarios win_amd64 de Python 3.12 y está preparado para Windows.");
  }

  if (!(await exists(NOTEBOOKLM_PYTHON))) {
    if (!(await exists(NOTEBOOKLM_ZIP))) {
      throw new Error(`No encuentro ${NOTEBOOKLM_ZIP}. Copia notebook-llm.zip junto a start-local.bat.`);
    }
    await fs.mkdir(NOTEBOOKLM_RUNTIME_ROOT, { recursive: true });
    console.log("[NotebookLM] Extrayendo el runtime que ya tienes (sin descargar paquetes)...");
    const script = `Expand-Archive -LiteralPath ${powershellQuote(NOTEBOOKLM_ZIP)} -DestinationPath ${powershellQuote(NOTEBOOKLM_RUNTIME_ROOT)} -Force`;
    const extracted = runSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "inherit" });
    if (extracted.status !== 0 || !(await exists(NOTEBOOKLM_PYTHON))) {
      throw new Error("No se pudo extraer notebook-llm.zip con PowerShell.");
    }
  }

  await repairPortableVenv();
  return { python: NOTEBOOKLM_PYTHON, home: NOTEBOOKLM_HOME, profile: NOTEBOOKLM_PROFILE };
}

export async function notebookLMEnvironment() {
  await fs.mkdir(NOTEBOOKLM_HOME, { recursive: true });
  return {
    ...process.env,
    NOTEBOOKLM_HOME,
    NOTEBOOKLM_PROFILE,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("NotebookLM no devolvió JSON.");
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try { return JSON.parse(text.slice(first, last + 1)); } catch { /* handled below */ }
    }
    throw new Error(`No se pudo interpretar la salida JSON de NotebookLM: ${text.slice(0, 500)}`);
  }
}

export async function runNotebookLMCommand(args, { stdin = "", timeoutMs = 180_000, inherit = false } = {}) {
  await ensureNotebookLMRuntime();
  const env = await notebookLMEnvironment();

  if (inherit) {
    const result = spawnSync(NOTEBOOKLM_PYTHON, ["-m", "notebooklm", "-p", NOTEBOOKLM_PROFILE, ...args], {
      cwd: ROOT,
      env,
      input: stdin || undefined,
      stdio: stdin ? ["pipe", "inherit", "inherit"] : "inherit",
      windowsHide: false,
      timeout: timeoutMs,
    });
    if (result.status !== 0) throw new Error(`NotebookLM terminó con código ${result.status ?? "desconocido"}.`);
    return { stdout: "", stderr: "" };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(NOTEBOOKLM_PYTHON, ["-m", "notebooklm", "-p", NOTEBOOKLM_PROFILE, ...args], {
      cwd: ROOT,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      settled = true;
      reject(new Error(`NotebookLM tardó más de ${Math.round(timeoutMs / 1000)} segundos.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const detail = (stderr || stdout || `exit ${code}`).trim().slice(-1200);
      reject(new Error(detail));
    });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

export async function runNotebookLMJson(args, options = {}) {
  const result = await runNotebookLMCommand(args, options);
  return parseJsonFromStdout(result.stdout);
}

async function authCheck({ quiet = false } = {}) {
  try {
    if (quiet) {
      const result = await runNotebookLMJson(["auth", "check", "--test", "--json"], { timeoutMs: 45_000 });
      return result?.status === "ok" && result?.checks?.token_fetch === true;
    }
    await runNotebookLMCommand(["auth", "check", "--test", "--json"], { inherit: true, timeoutMs: 45_000 });
    return true;
  } catch {
    return false;
  }
}

export async function ensureNotebookLMAuth({ interactive = true } = {}) {
  if (await authCheck({ quiet: true })) return true;
  if (!interactive) return false;

  console.log("\n[NotebookLM] Falta iniciar sesión o la sesión expiró.");
  console.log("[NotebookLM] Abriré tu Chrome instalado. No se descargará Chromium ni paquetes.\n");
  await runNotebookLMCommand(["login", "--browser", "chrome"], { inherit: true, timeoutMs: 10 * 60_000 });
  if (!(await authCheck({ quiet: true }))) {
    throw new Error("El login terminó, pero Google todavía no valida la sesión de NotebookLM.");
  }
  console.log("[NotebookLM] Sesión validada.\n");
  return true;
}

export async function probeNotebookLM() {
  return runNotebookLMJson(["list", "--json"], { timeoutMs: 60_000 });
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
    await runNotebookLMCommand(["login", "--browser", "chrome"], { inherit: true, timeoutMs: 10 * 60_000 });
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
  if (command === "probe") {
    const result = await probeNotebookLM();
    const count = Array.isArray(result?.notebooks) ? result.notebooks.length : 0;
    console.log(`[NotebookLM] Sesión OK · ${count} notebook(s) visibles.`);
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
