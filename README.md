# Local PaperMaxing

PaperMaxing local con **NotebookLM sin Docker**.

Esta versión usa un frontend React/Vite, una API local Node.js y el runtime de `notebooklm-py` que tú colocas como `notebook-llm.zip`. PaperMaxing no hace `pip install`, no crea contenedores y no descarga Chromium para el login: usa Google Chrome instalado en Windows.

## Inicio rápido en Windows

Requisitos:

- Node.js 22+
- Google Chrome
- El archivo `notebook-llm.zip` junto a `start-local.bat`

Estructura:

```text
Local_PaperMaxing/
├─ notebook-llm.zip
├─ start-local.bat
├─ server/
└─ src/
```

Después haz doble clic en:

```text
start-local.bat
```

En el primer inicio PaperMaxing:

1. instala las dependencias de la interfaz con npm si todavía no existen;
2. extrae `notebook-llm.zip` dentro de `.papermaxing/runtime/`;
3. reutiliza el `notebooklm-py 0.8.1` contenido en ese ZIP;
4. valida la sesión de Google;
5. si hace falta login, abre tu Chrome instalado (no descarga Chromium);
6. levanta NotebookLM en `127.0.0.1:8100`;
7. levanta la API de PaperMaxing en `127.0.0.1:8787`;
8. levanta la interfaz en `127.0.0.1:5173`.

## Comandos

```bash
npm run notebooklm:prepare
npm run notebooklm:auth
npm run notebooklm:check
npm run notebooklm:server
npm run notebooklm:probe
npm run dev:notebooklm
```

### Rehacer el login

```bash
npm run notebooklm:login
```

El login usa:

```text
notebooklm -p papermaxing login --browser chrome
```

Por eso no necesita descargar el Chromium de Playwright.

## Dónde se guarda todo

Todo lo sensible/local queda bajo:

```text
.papermaxing/
├─ config.json
├─ notebooklm-server-token.txt
├─ notebooklm/
│  └─ profiles/papermaxing/storage_state.json
└─ runtime/
   └─ notebook-llm/.venv/...
```

`.papermaxing/` y `notebook-llm.zip` están ignorados por Git para evitar subir credenciales o el runtime binario.

## Cómo funciona NotebookLM dentro de PaperMaxing

```text
PDF
 ↓
PDF.js (browser)
 ↓
texto extraído
 ↓
PaperMaxing API 127.0.0.1:8787
 ↓
NotebookLM REST 127.0.0.1:8100
 ↓
sesión local de Google
 ↓
NotebookLM
```

Al analizar un paper con el provider **NotebookLM**, PaperMaxing crea un notebook temporal, añade el texto extraído como fuente, espera a que la fuente esté lista, realiza la pregunta grounded y elimina el notebook temporal al terminar.

## Providers

- NotebookLM — sesión local de Google, sin API key y sin Docker.
- Ollama — local.
- LM Studio — local.
- OpenAI-compatible — local o remoto.
- Gemini — API.
- OpenRouter — API.
- OpenAI — API.
- Anthropic — API.

NotebookLM es el provider predeterminado para instalaciones nuevas.

## Diagnóstico

Con PaperMaxing corriendo:

```bash
npm run doctor
```

Para comprobar específicamente NotebookLM:

```bash
npm run notebooklm:probe
```

## Nota sobre el ZIP

El ZIP incluido fue creado como un entorno Python 3.12 de Windows. PaperMaxing intenta reutilizarlo tal cual y reparar automáticamente `pyvenv.cfg` si la ruta original de Python cambió, siempre sin descargar paquetes. Si en esa computadora no existe Python 3.12 compatible, el launcher lo indicará en lugar de hacer descargas silenciosas.
