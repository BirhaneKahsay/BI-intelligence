import React, { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
  ChartData,
  ChartType,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const API_BASE = '';

interface FileInfo {
  name: string;
  size: number;
  modified: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  artifacts?: Artifact[];
}

interface TableArtifact {
  type: 'table';
  headers: string[];
  rows: Record<string, unknown>[];
}

interface ChartArtifact {
  type: 'chart';
  spec: {
    type: string;
    data: {
      labels: string[];
      datasets: Array<{
        label: string;
        data: number[];
        backgroundColor?: string | string[];
        borderColor?: string;
        borderWidth?: number;
      }>;
    };
    options?: Record<string, unknown>;
  };
}

type Artifact = TableArtifact | ChartArtifact;

interface HealthStatus {
  status: string;
  mcp_connected: boolean;
}

function escapeHtml(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! Upload a dataset and ask me anything about it.', artifacts: [] },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthStatus>({ status: 'checking', mcp_connected: false });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkHealth();
    loadFiles();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function checkHealth() {
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      setHealth({ status: 'ok', mcp_connected: data.mcp_connected });
    } catch {
      setHealth({ status: 'offline', mcp_connected: false });
    }
  }

  async function loadFiles() {
    try {
      const res = await fetch(`${API_BASE}/files`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch {
      // ignore
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      await fetch(`${API_BASE}/upload`, { method: 'POST', body: form });
      await loadFiles();
    } catch (err) {
      alert('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      e.target.value = '';
    }
  }

  async function deleteFile(name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    await fetch(`${API_BASE}/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await loadFiles();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text, artifacts: [] }]);
    setLoading(true);

    const assistantIndex = messages.length;
    setMessages((prev) => [...prev, { role: 'assistant', content: '', artifacts: [] }]);

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader available');
      
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const event = JSON.parse(payload);
            if (event.type === 'text') {
              setMessages((prev) => {
                const next = [...prev];
                next[assistantIndex] = {
                  ...next[assistantIndex],
                  content: next[assistantIndex].content + event.content,
                };
                return next;
              });
            } else if (event.type === 'tool') {
              setMessages((prev) => {
                const next = [...prev];
                next[assistantIndex] = {
                  ...next[assistantIndex],
                  content: next[assistantIndex].content + `\n[Tool: ${event.name}] ${event.content}\n`,
                };
                return next;
              });
            } else if (event.type === 'artifact') {
              setMessages((prev) => {
                const next = [...prev];
                const artifacts = [...(next[assistantIndex].artifacts || []), event.artifact];
                next[assistantIndex] = { ...next[assistantIndex], artifacts };
                return next;
              });
            } else if (event.type === 'done') {
              setMessages((prev) => {
                const next = [...prev];
                next[assistantIndex] = { ...next[assistantIndex], artifacts: event.artifacts || [] };
                return next;
              });
            } else if (event.type === 'error') {
              setMessages((prev) => {
                const next = [...prev];
                next[assistantIndex] = { ...next[assistantIndex], content: event.content };
                return next;
              });
            }
          } catch {
            // ignore parse error
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[assistantIndex] = { ...next[assistantIndex], content: 'Error: ' + (err instanceof Error ? err.message : 'Unknown error') };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  function renderArtifact(artifact: Artifact, index: number) {
    if (!artifact) return null;
    const key = `${artifact.type}-${index}`;
    if (artifact.type === 'table') {
      const headers = artifact.headers || [];
      const rows = artifact.rows || [];
      return (
        <div key={key} className="mt-2 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="px-3 md:px-4 py-2 md:py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      {escapeHtml(String(h))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.slice(0, 100).map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {headers.map((h) => (
                      <td key={h} className="px-3 md:px-4 py-2 text-xs md:text-sm text-slate-700 whitespace-nowrap">
                        {escapeHtml(String(row[h] ?? ''))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (artifact.type === 'chart' && artifact.spec) {
      const spec = artifact.spec;
      const chartType = spec.type || 'bar';
      const labels = spec.data?.labels || [];
      const datasets = spec.data?.datasets || [];

      const chartData: ChartData = {
        labels,
        datasets: datasets.map((ds) => ({
          label: ds.label || '',
          data: ds.data || [],
          backgroundColor: ds.backgroundColor || '#3b82f6',
          borderColor: ds.borderColor || '#1e3a8a',
          borderWidth: ds.borderWidth ?? 1,
        })),
      };

      const chartOptions: ChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: typeof spec.options?.title === 'string' ? spec.options.title : '',
          },
          legend: {
            display: chartType === 'line' || chartType === 'doughnut' || chartType === 'pie',
          },
        },
        scales:
          chartType === 'pie' || chartType === 'doughnut'
            ? undefined
            : {
                y: {
                  beginAtZero: true,
                  display: true,
                },
                x: {
                  display: true,
                },
              },
      };

      return (
        <div key={key} className="mt-2 bg-white border border-slate-200 rounded-xl shadow-sm p-3 md:p-4">
          <div className="relative w-full" style={{ height: '250px', minHeight: '250px' }}>
            <Chart type={chartType as ChartType} data={chartData} options={chartOptions} />
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-800 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-600"
            aria-label="Toggle sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">BI</div>
          <h1 className="text-lg font-semibold text-slate-800">BI Agent</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`w-2 h-2 rounded-full ${
              health.status === 'ok' && health.mcp_connected ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          <span
            className={
              health.status === 'ok' && health.mcp_connected
                ? 'text-emerald-600 text-sm font-medium hidden sm:inline'
                : 'text-amber-600 text-sm font-medium hidden sm:inline'
            }
          >
            {health.status === 'ok' && health.mcp_connected ? 'Connected' : 'MCP offline'}
          </span>
        </div>
      </header>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-20"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside
          className={`
            fixed inset-y-0 left-0 z-30 w-80 bg-white border-r border-slate-200 flex flex-col flex-shrink-0
            transform transition-transform duration-300 ease-in-out
            lg:static lg:translate-x-0 lg:block lg:z-auto
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <div className="p-4 border-b border-slate-100 flex items-center justify-between lg:hidden">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Datasets</h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded-md hover:bg-slate-100 text-slate-500"
              aria-label="Close sidebar"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4 border-b border-slate-100 hidden lg:block">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Datasets</h2>
            <label className="block w-full cursor-pointer">
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <svg
                  className="mx-auto h-8 w-8 text-slate-400 mb-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <span className="text-sm text-slate-600 font-medium">Upload CSV or XLSX</span>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {files.length === 0 && <p className="text-sm text-slate-400 italic">No files uploaded yet.</p>}
            {files.map((f) => (
              <div
                key={f.name}
                className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 border border-slate-200"
              >
                <div className="min-w-0 flex-1 mr-2">
                  <p className="text-sm font-medium text-slate-700 truncate">{escapeHtml(f.name)}</p>
                  <p className="text-xs text-slate-500">{formatBytes(f.size)}</p>
                </div>
                <button
                  onClick={() => deleteFile(f.name)}
                  className="text-slate-400 hover:text-red-500 flex-shrink-0 p-1"
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {/* Mobile upload floating button */}
          <div className="p-4 border-t border-slate-100 lg:hidden">
            <label className="block w-full cursor-pointer">
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <svg
                  className="mx-auto h-6 w-6 text-slate-400 mb-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <span className="text-sm text-slate-600 font-medium">Upload CSV or XLSX</span>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>
        </aside>

        {/* Chat */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-50">
          <div className="flex-1 overflow-y-auto chat-scroll p-4 md:p-6 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-full md:max-w-2xl rounded-2xl px-4 py-3 shadow-sm text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-none'
                      : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'
                  }`}
                >
                  <p style={{ whiteSpace: 'pre-wrap' }}>{escapeHtml(msg.content)}</p>
                  {msg.artifacts?.map((artifact, idx) => renderArtifact(artifact, idx))}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
                  <span className="text-sm text-slate-500 loading-dots">Thinking</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 bg-white p-3 md:p-4">
            <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex gap-2 md:gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question about your data..."
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 md:px-4 md:py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 text-white px-4 py-2.5 md:px-5 md:py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
