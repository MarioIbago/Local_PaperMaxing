import { getNotebookLMToken, NOTEBOOKLM_API_URL } from "./notebooklm-runtime.mjs";

const checks = [
  { name: "NotebookLM health", url: `${NOTEBOOKLM_API_URL}/healthz` },
  { name: "Ollama", url: "http://127.0.0.1:11434/api/tags" },
  { name: "LM Studio", url: "http://127.0.0.1:1234/v1/models" },
  { name: "Local PaperMaxing API", url: "http://127.0.0.1:8787/api/health" },
];

console.log(`Node ${process.version}`);
console.log("Local PaperMaxing doctor\n");

for (const check of checks) {
  try {
    const response = await fetch(check.url, { signal: AbortSignal.timeout(2500) });
    console.log(`${response.ok ? "✓" : "!"} ${check.name}: ${response.status} ${check.url}`);
  } catch {
    console.log(`· ${check.name}: no detectado en ${check.url}`);
  }
}

try {
  const token = await getNotebookLMToken();
  const response = await fetch(`${NOTEBOOKLM_API_URL}/v1/notebooks`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  console.log(`${response.ok ? "✓" : "!"} NotebookLM Google session: ${response.status}`);
} catch {
  console.log("· NotebookLM Google session: no validada");
}

console.log("\nPara NotebookLM usa: npm run notebooklm:auth");
