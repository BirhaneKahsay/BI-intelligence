# BI Intelligence

A Business Intelligence chat agent. Upload CSV/XLSX files, ask questions in plain English, and get answers backed by pandas analysis and Chart.js visualizations.

## Tech Stack

- **Backend**: FastAPI + MCP (Model Context Protocol)
- **AI/LLM**: Ollama (`qwen2.5:3b` by default, configurable)
- **Data Processing**: pandas, openpyxl
- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Charts**: Chart.js + react-chartjs-2

## Prerequisites

- Python 3.10+
- Node.js 18+
- Ollama (running locally, e.g. `ollama serve`)

## Project Structure

```
BI-intelligence/
├── main.py              # FastAPI backend / MCP client
├── mcp_server.py        # MCP server exposing data tools (pandas)
├── requirements.txt     # Python dependencies
├── static/              # Built frontend (served by FastAPI)
├── frontend/            # React frontend source
│   ├── package.json
│   ├── vite.config.js
│   └── src/
└── uploads/             # Uploaded data files
```

## Setup

### 1. Clone and install backend dependencies

```bash
cd BI-intelligence
pip install -r requirements.txt
```

or

```bash
pip install fastapi uvicorn mcp requests pandas numpy openpyxl
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 3. Configure environment

Create a `.env` file in `BI-intelligence/` if you need custom Ollama settings:

```
OLLAMA_URL=http://localhost:11434/api/chat
OLLAMA_MODEL=qwen2.5:3b
```

## Running the Project

### Step 1: Start Ollama

Make sure Ollama is running in a separate terminal:

```bash
ollama serve
```

If you haven't pulled the model yet:

```bash
ollama pull qwen2.5:3b
```

### Step 2: Start the Backend (FastAPI + MCP)

```bash
cd BI-intelligence
py main.py
```

The backend will:
1. Start the MCP server subprocess (`mcp_server.py`)
2. Initialize the MCP client session
3. Serve the FastAPI app on `http://0.0.0.0:8000`

You should see:
```
INFO:     Application startup complete.
Connected to MCP server. Tools available: ['load_file_tool', 'list_datasets', ...]
```

### Step 3: Start the Frontend (Vite dev server)

In a new terminal:

```bash
cd BI-intelligence/frontend
npm run dev
```

The frontend will run on `http://localhost:5173` and proxy API requests to `http://localhost:8000`.

### Step 4: Open the App

Visit [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

1. **Upload a file** — Click the upload area and select a `.csv` or `.xlsx` file.
2. **Ask a question** — Type a natural language question about the data, e.g.:
   - *"Which countries have the most orders?"*
   - *"Show me the total revenue by product type."*
   - *"What is the average unit price per country?"*
3. **View results** — The agent will use pandas to analyze the data and return tables and charts.

## Available Tools

The agent automatically discovers these tools from the MCP server:

| Tool | Description |
|------|-------------|
| `load_file_tool` | Load a CSV or XLSX file into memory |
| `list_datasets` | List all loaded datasets with row/column counts |
| `unload_dataset` | Remove a dataset from memory |
| `list_columns` | Inspect columns, dtypes, and sample rows |
| `run_pandas` | Run a pandas expression against a dataset |
| `describe_dataset` | Get summary statistics for numeric/categorical columns |
| `group_agg` | Group by one column and aggregate another |
| `top_n` | Get the top N rows by a column, optionally filtered |
| `pivot` | Build a pivot table |
| `correlation` | Compute correlation between columns |
| `trend` | Resample a dataset over time |
| `generate_chart` | Generate a Chart.js specification |

## Troubleshooting

**`Application startup failed` with `MCPError: Connection closed`**
- Ensure `mcp_server.py` has no syntax errors.
- Ensure `mcp` and `openpyxl` are installed.
- Make sure port `8000` is not already in use.

**`winerror 10048` / port already in use**
- Another instance is already running. Stop it or change the port in `main.py`.

**Ollama is unreachable**
- Verify `ollama serve` is running.
- Check `OLLAMA_URL` in your `.env` or environment variables.

**Model returns text but never calls a tool**
- `qwen2.5:3b` sometimes stops before emitting tool calls.
- Try a larger model: `OLLAMA_MODEL=qwen2.5:7b` or `ollama pull llama3:8b`.
