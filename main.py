"""
FastAPI app for the BI Agent - talks to Ollama for reasoning, and to the
MCP server (mcp_server.py) over stdio for tool execution.

Requires:
    pip install fastapi uvicorn "mcp[cli]" httpx openpyxl

Run:
    python main.py
    # open http://localhost:8000
"""

import json
import os
import sys
import uvicorn

from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import asyncio
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://10.58.230.33:11434/api/chat")
MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

mcp_session: ClientSession | None = None
tool_schemas: list[dict] = []
_mcp_stdio = None
_mcp_client_session = None
_mcp_lock = asyncio.Lock()


def mcp_tool_to_ollama_schema(tool) -> dict:
    """Convert an MCP tool definition into the JSON schema Ollama's /api/chat expects."""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description or "",
            "parameters": tool.inputSchema,
        },
    }


async def _call_mcp_tool(name: str, arguments: dict) -> tuple[str, dict | None]:
    """Execute an MCP tool and return (content, artifact_or_None)."""
    if mcp_session is None:
        return "Error: MCP session not initialized.", None
    async with _mcp_lock:
        result = await mcp_session.call_tool(name, arguments)
    content = "".join(block.text for block in result.content if hasattr(block, "text"))

    artifact = None
    try:
        parsed = json.loads(content)
        if name == "generate_chart" and isinstance(parsed, dict) and parsed.get("type") in ("bar", "line", "pie", "doughnut"):
            artifact = {"type": "chart", "spec": parsed}
        elif name == "run_pandas" and isinstance(parsed, list):
            headers = list(parsed[0].keys()) if parsed else []
            artifact = {"type": "table", "headers": headers, "rows": parsed}
        elif name == "run_pandas" and isinstance(parsed, dict):
            headers = list(parsed.keys())
            rows = [{"index": k, **v} if isinstance(v, dict) else {"index": k, "value": v} for k, v in parsed.items()]
            artifact = {"type": "table", "headers": ["index"] + headers, "rows": rows[:200]}
    except (json.JSONDecodeError, TypeError, IndexError):
        pass
    return content, artifact


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mcp_session, tool_schemas, _mcp_stdio, _mcp_client_session

    server_params = StdioServerParameters(
        command=sys.executable,
        args=["mcp_server.py"],
        cwd=Path(".").resolve(),
    )

    try:
        _mcp_stdio = stdio_client(server_params)
        read, write = await _mcp_stdio.__aenter__()
        _mcp_client_session = ClientSession(read, write)
        await _mcp_client_session.__aenter__()
        await _mcp_client_session.initialize()

        tools_result = await _mcp_client_session.list_tools()
        tool_schemas = [mcp_tool_to_ollama_schema(t) for t in tools_result.tools]
        mcp_session = _mcp_client_session
        print(f"Connected to MCP server. Tools available: {[t.name for t in tools_result.tools]}")
    except Exception as e:
        print(f"Failed to connect to MCP server: {e}")
        raise

    try:
        yield
    finally:
        mcp_session = None
        if _mcp_client_session:
            try:
                await _mcp_client_session.__aexit__(None, None, None)
            except Exception:
                pass
            finally:
                _mcp_client_session = None
        if _mcp_stdio:
            try:
                await _mcp_stdio.__aexit__(None, None, None)
            except RuntimeError:
                pass
            except Exception:
                pass
            finally:
                _mcp_stdio = None


app = FastAPI(title="BI Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/health")
async def health():
    return {"status": "ok", "mcp_connected": mcp_session is not None}


@app.get("/files")
async def list_files():
    files = []
    for f in sorted(UPLOAD_DIR.iterdir()):
        if f.is_file():
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "modified": f.stat().st_mtime,
            })
    return {"files": files}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Empty filename")
    dest = UPLOAD_DIR / file.filename
    content = await file.read()
    dest.write_bytes(content)
    msg = ""
    if mcp_session:
            await _call_mcp_tool("load_file_tool", {"path": str(dest.resolve())})
    return {"filename": file.filename, "size": len(content)}


@app.delete("/files/{filename}")
async def delete_uploaded_file(filename: str):
    dest = UPLOAD_DIR / filename
    if not dest.exists():
        raise HTTPException(404, "File not found")
    if mcp_session:
        await _call_mcp_tool("unload_dataset", {"name": dest.stem})
    dest.unlink()
    return {"deleted": filename}


class ChatRequest(BaseModel):
    message: str


async def _chat_logic(req: ChatRequest, max_steps: int = 6):
    messages = [
        {
            "role": "system",
            "content": (
                "You are a business intelligence analyst. "
                "Always call list_datasets first to see what data is available. "
                "Use list_columns to inspect column names and types before writing pandas code. "
                "Use 'df' as the DataFrame variable in run_pandas. "
                "When data is ready, explain findings in plain business language. "
                "Use generate_chart when the user asks for a graph, chart, or visualization."
            ),
        },
        {"role": "user", "content": req.message},
    ]

    artifacts = []
    for _ in range(max_steps):
        message = await call_ollama(messages)
        messages.append(message)

        tool_calls = message.get("tool_calls")
        if not tool_calls:
            yield {"type": "text", "content": message.get("content", "")}
            yield {"type": "done", "artifacts": artifacts}
            return

        for call in tool_calls:
            name = call["function"]["name"]
            args = call["function"]["arguments"]
            if isinstance(args, str):
                args = json.loads(args)

            content, artifact = await _call_mcp_tool(name, args)
            if artifact:
                artifacts.append(artifact)
            yield {"type": "tool", "name": name, "content": content}
            if artifact:
                yield {"type": "artifact", "artifact": artifact}
            messages.append({"role": "tool", "content": content})

    yield {"type": "text", "content": "Max steps reached without a final answer."}
    yield {"type": "done", "artifacts": artifacts}


@app.post("/chat")
async def chat(req: ChatRequest, max_steps: int = 6):
    answer = ""
    artifacts = []
    async for event in _chat_logic(req, max_steps):
        if event.get("type") == "text":
            answer += event.get("content", "")
        elif event.get("type") == "done":
            artifacts = event.get("artifacts", [])
    return {"answer": answer, "artifacts": artifacts, "steps": []}


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest, max_steps: int = 6):
    async def event_generator():
        try:
            async for event in _chat_logic(req, max_steps):
                print(f"Streaming event: {event}")
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


async def call_ollama(messages: list[dict]) -> dict:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                OLLAMA_URL,
                json={"model": MODEL, "messages": messages, "tools": tool_schemas, "stream": False},
                timeout=120.0,
            )
            resp.raise_for_status()
            return resp.json()["message"]
    except Exception as e:
        return {
            "role": "assistant",
            "content": f"Sorry, I cannot reach the AI model server right now ({OLLAMA_URL}). Please check that Ollama is running and accessible.\n\nError: {e}",
        }


if __name__ == "__main__":
    
    uvicorn.run(app, host="0.0.0.0", port=8000)