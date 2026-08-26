import { probeNotebookLM } from "./notebooklm-runtime.mjs";

const checks = [
  { name: "Ollama", url: "http://127.0.0.1:11434/api/tags" },
  { name: "LM Studio", url: "http://127.0.0.1:1234/v1/models" },
  { name: "Local PaperMaxing API", url: "http://127.0.0.1:8787/api/health" },
];

console.log(`Node ${process.version}`);
console.log("Local PaperMaxing doctor\n");

try {
  const result = await probeNotebookLM();
  const count = Array.isArray(result?.notebooks) ? result.notebooks.length : 0;
  console.log(`✓ NotebookLM Google session: OK · ${count} notebook(s) visibles`);
} catch (error) {
  console.log(`· NotebookLM: ${error instanceof Error ? error.message : "no disponible"}`);
}

for (const check of checks) {
  try {
    const response = await fetch(check.url, { signal: AbortSignal.timeout(2500) });
    console.log(`${response.ok ? "✓" : "!"} ${check.name}: ${response.status} ${check.url}`);
  } catch {
    console.log(`· ${check.name}: no detectado en ${check.url}`);
  }
}

console.log("\nNotebookLM no usa Docker ni un servidor Python. Para renovar la sesión: npm run notebooklm:login");
