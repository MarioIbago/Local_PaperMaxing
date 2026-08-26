# Local PaperMaxing

PaperMaxing local con **NotebookLM sin Docker** y usando directamente el `notebook-llm.zip` que ya tienes.

La integración de NotebookLM no levanta FastAPI, uvicorn ni un servidor Python. El backend Node de PaperMaxing ejecuta el CLI de `notebooklm-py` incluido en tu ZIP, por lo que no hace `pip install` ni descarga paquetes de NotebookLM.

## Inicio rápido en Windows

Requisitos:

- Node.js 22+
- Google Chrome instalado
- Python 3.12 disponible en Windows si el entorno incluido necesita reparar su ruta base
- `notebook-llm.zip` junto a `start-local.bat`

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

1. instala las dependencias Node de la interfaz con `npm install` si todavía no existe `node_modules`;
2. extrae tu `notebook-llm.zip` dentro de `.papermaxing/runtime/`;
3. reutiliza el `notebooklm-py 0.8.1` ya contenido en ese ZIP;
4. corrige `pyvenv.cfg` si el ZIP fue creado en otra ruta de Windows;
5. valida tu sesión de Google;
6. si hace falta login, abre **tu Google Chrome instalado** con NotebookLM;
7. levanta únicamente la API Node de PaperMaxing y la UI local.

**No se usa Docker. No se instala `notebooklm-py`. No se descarga Chromium. No existe un gateway NotebookLM en el puerto 8100.**

> `npm install` puede descargar las dependencias JavaScript de PaperMaxing la primera vez si no tienes `node_modules`. Esto es independiente de NotebookLM; los paquetes Python/NotebookLM salen del ZIP que ya proporcionaste.

## Arquitectura

```text
PDF
 ↓
PDF.js en el navegador
 ↓
texto extraído
 ↓
PaperMaxing API · 127.0.0.1:8787
 ↓
Python del runtime incluido
 ↓
python -m notebooklm ...
 ↓
sesión local de Google
 ↓
NotebookLM
```

No hay contenedor y no hay proceso `notebooklm-server`.

## Qué hace PaperMaxing al analizar un paper

Cuando eliges **NotebookLM** como provider:

```text
1. crea un notebook temporal
2. manda el texto extraído del paper por stdin
3. espera a que NotebookLM procese la fuente
4. manda la pregunta/instrucción
5. recibe respuesta + referencias
6. elimina el archivo temporal del prompt
7. elimina únicamente el notebook temporal que PaperMaxing acaba de crear
```

Tus notebooks existentes no se seleccionan ni se borran.

## Login de Google

PaperMaxing usa el perfil local:

```text
papermaxing
```

La sesión queda en:

```text
.papermaxing/notebooklm/profiles/papermaxing/storage_state.json
```

Si la sesión expiró:

```bash
npm run notebooklm:login
```

El comando que se ejecuta internamente equivale a:

```text
<python del ZIP> -m notebooklm -p papermaxing login --browser chrome
```

Se usa `--browser chrome` para abrir Chrome instalado en tu PC y evitar que Playwright intente descargar Chromium.

## Comandos útiles

Preparar/extractar el runtime:

```bash
npm run notebooklm:prepare
```

Validar o abrir login si hace falta:

```bash
npm run notebooklm:auth
```

Forzar login:

```bash
npm run notebooklm:login
```

Verificar autenticación:

```bash
npm run notebooklm:check
```

Probar acceso real a tus notebooks:

```bash
npm run notebooklm:probe
```

Arrancar PaperMaxing:

```bash
npm run dev
```

La interfaz queda en:

```text
http://127.0.0.1:5173
```

La API local queda en:

```text
http://127.0.0.1:8787
```

## Providers

La UI soporta:

- **NotebookLM** — usa el runtime local del ZIP y tu sesión de Google; sin API key.
- Ollama — local.
- LM Studio — local.
- OpenAI-compatible — local o remoto.
- Gemini — API.
- OpenRouter — API.
- OpenAI — API.
- Anthropic — API.

En instalaciones nuevas, NotebookLM aparece como provider predeterminado. Si ya habías ejecutado Local PaperMaxing antes, tu `.papermaxing/config.json` conserva el provider anterior; simplemente selecciona **NotebookLM** en la UI y guarda.

## Dónde se guarda todo

```text
.papermaxing/
├─ config.json
├─ notebooklm/
│  └─ profiles/
│     └─ papermaxing/
│        └─ storage_state.json
├─ runtime/
│  └─ notebook-llm/
│     └─ .venv/
└─ tmp/
```

`.papermaxing/` y `notebook-llm.zip` están en `.gitignore`, por lo que la sesión de Google y el runtime no deben subirse al repositorio.

## El ZIP es portable hasta donde lo permite Python

El ZIP recibido contiene un entorno virtual de **Python 3.12 para Windows x64** que originalmente fue creado en otra ruta. Los launchers `.exe` de un `venv` de Windows pueden conservar rutas absolutas, por eso PaperMaxing **no ejecuta `notebooklm.exe` ni `notebooklm-server.exe` directamente**.

En su lugar ejecuta:

```text
.venv\Scripts\python.exe -m notebooklm ...
```

Si `pyvenv.cfg` todavía apunta a la computadora/ruta donde se creó el ZIP, PaperMaxing intenta repararlo usando un Python 3.12 ya instalado en tu PC. Nunca descarga Python o paquetes silenciosamente.

## Diagnóstico

```bash
npm run doctor
```

El diagnóstico prueba la sesión de NotebookLM mediante el CLI real, además de detectar Ollama, LM Studio y la API local de PaperMaxing.

## Privacidad

- El PDF original se procesa con PDF.js en el navegador.
- PaperMaxing no sube el PDF a un servidor propio.
- Si usas NotebookLM, el texto extraído se envía a Google NotebookLM porque ese es el motor seleccionado.
- La sesión de Google se queda en `.papermaxing/` en tu equipo.
- No existe una base de datos central de PaperMaxing para esta versión local.
