# 🔍 Meet BI Intelligence — Your Local AI Data Analyst

I built a full-stack **Business Intelligence chat agent** that turns raw CSV/XLSX files into instant insights, charts, and answers — all running locally on your machine.

---

## 📸 Image 1: App Screenshot — Chat Interface

> **Visual**: A clean chat UI with a sidebar showing uploaded files and a main conversation area.  
> The user asks: *"Which countries have the most orders?"*  
> The agent replies with a formatted table + a generated bar chart showing top countries.  
> Below the text, two "cards" appear: one with a data table artifact and one with an embedded Chart.js visualization.

---

## 🧠 The Problem

Data analysis still requires writing SQL, configuring BI tools, or waiting on a data team.  
What if you could just **upload a spreadsheet and ask a question in plain English**?

---

## ⚙️ How It Works

### Architecture

> **Visual**: Architecture diagram with three connected blocks.  
> 1. **Frontend** (React + Vite + Tailwind) — chat UI, file uploads, chart rendering.  
> 2. **Backend** (FastAPI + MCP Client) — lifespan session management, Ollama streaming, artifact routing.  
> 3. **MCP Server** (pandas in-memory DataFrames) — 12 tools (`group_agg`, `pivot`, `correlation`, `trend`, `run_pandas`, etc.).

Arrows show:  
- User → Frontend → Backend → Ollama (reasoning)  
- Backend → MCP Server → pandas → result → Frontend

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, TypeScript, Tailwind CSS, Vite |
| **Backend** | FastAPI, Uvicorn |
| **AI/LLM** | Ollama (`qwen2.5:3b` — fully local, no API keys) |
| **Protocol** | MCP (Model Context Protocol) |
| **Data** | pandas, openpyxl (CSV/XLSX) |
| **Visualization** | Chart.js + react-chartjs-2 |

---

## ✨ Key Features

1. **Natural Language Queries** — Ask *"What's the trend in monthly revenue?"* and get an answer.
2. **In-Memory pandas Engine** — No database required. Load `.csv` or `.xlsx` directly.
3. **12 Auto-Discovered Tools**
   - `group_agg` — Group + aggregate (sum, mean, count, etc.)
   - `top_n` — Ranked results with optional filters
   - `pivot` — Cross-tab pivot tables
   - `correlation` — Correlation matrix between numeric columns
   - `trend` — Time-series resampling (D/W/M/Q/Y)
   - `run_pandas` — Free-form pandas expressions
   - `describe_dataset` — Statistical summary
   - `generate_chart` — Chart.js specs for bar, line, pie, doughnut
4. **Streaming Responses** — Real-time streaming via Server-Sent Events.
5. **File Upload & Management** — Upload, inspect, and unload datasets from the UI.
6. **Fully Local** — Ollama runs on your machine; no cloud inference, no data leaves your laptop.

---

## 🚀 Try It Yourself

```bash
# 1. Backend
pip install -r requirements.txt
py main.py

# 2. Frontend
cd frontend && npm install && npm run dev

# 3. Ollama
ollama serve
ollama pull qwen2.5:3b  # or a larger model like qwen2.5:7b
```

Open `http://localhost:5173` → Upload a dataset → Start asking questions.

---

## 📸 Image 2: Terminal — Startup Sequence

> **Visual**: A terminal split into three panes.  
> - **Pane 1 (Ollama)**: `ollama serve` running.  
> - **Pane 2 (Backend)**: `py main.py` showing `Connected to MCP server. Tools available: [load_file_tool, list_datasets, ...]`.  
> - **Pane 3 (Frontend)**: `npm run dev` with Vite ready on `localhost:5173`.

---

## 💡 What I Learned Building This

- **MCP is powerful** — It standardizes how LLMs talk to tools. The client/server separation is clean.
- **Small models need guardrails** — `qwen2.5:3b` sometimes stops reasoning before emitting a tool call. Prompt engineering and model size matter.
- **AnyIO task groups are tricky** — Properly entering/exiting async context managers in `FastAPI` lifespan hooks is critical for stable MCP stdio connections.
- **CORS + proxy strategy** — Using Vite's proxy for dev keeps the frontend simple while avoiding port headaches.

---

## 📸 Image 3: Code Snippet — MCP Tool Registration

> **Visual**: A side-by-side code snippet showing how a tool is registered in `mcp_server.py`.  
> Left: `@mcp.tool()` decorator + `def group_agg(table, group_by, value_col, agg="sum")`.  
> Right: The corresponding schema object that Ollama receives for function calling.

---

## 🔗 GitHub

The full source code and README are available here:  
👉 **github.com/[your-username]/BI-intelligence**

*(Star ⭐ if you find it useful!)*

---

## 🙋 Who is this for?

If you're a:
- **Data Analyst** tired of repetitive SQL queries
- **Engineer** exploring local LLMs + tool use
- **Founder** who wants to talk to spreadsheets without hiring a data team

...this project might spark an idea for your own stack.

---

## 📣 Let's Discuss

**What's the most tedious part of your data workflow right now?**  
Drop a comment below — I read every one.

And if you found this helpful, repost to help other builders discover it. 🙏

---

#DataScience #AI #LLM #Ollama #Python #FastAPI #React #TypeScript #TailwindCSS #BusinessIntelligence #Pandas #MCP #ModelContextProtocol #OpenSource #LocalAI #DataEngineering #BuildInPublic
