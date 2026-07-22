"""
MCP server for the BI Agent - pandas-only, no database.

Supports CSV and XLSX files loaded into pandas DataFrames in memory.
Tools let the model inspect columns, run pandas expressions, and generate
chart specifications for the frontend.

Requires:
    pip install "mcp[cli]" pandas openpyxl

Test standalone with:
    mcp dev mcp_server.py
"""

import json
import os
import sys
import pandas as pd
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("bi-agent-tools")

# table_name -> DataFrame
DATAFRAMES: dict[str, pd.DataFrame] = {}


def _table_name_from_path(path: str) -> str:
    base = os.path.basename(path)
    return base.rsplit(".", 1)[0]


def load_file(path: str) -> str:
    if not os.path.exists(path):
        return f"Error: file not found: {path}"
    table_name = _table_name_from_path(path)
    try:
        if path.lower().endswith(".csv"):
            DATAFRAMES[table_name] = pd.read_csv(path)
        elif path.lower().endswith((".xlsx", ".xls")):
            DATAFRAMES[table_name] = pd.read_excel(path)
        else:
            return f"Error: unsupported file type '{path}'. Use .csv, .xlsx, or .xls"
        df = DATAFRAMES[table_name]
        return f"Loaded '{table_name}' ({len(df)} rows, {len(df.columns)} columns)"
    except Exception as e:
        return f"Error loading file: {e}"


@mcp.tool()
def load_file_tool(path: str) -> str:
    """Load a CSV or XLSX file into memory from the given absolute path."""
    return load_file(path)


@mcp.tool()
def list_datasets() -> str:
    """List all loaded datasets with row count, column count, and column names."""
    if not DATAFRAMES:
        return "No datasets loaded."
    info = {}
    for name, df in DATAFRAMES.items():
        info[name] = {
            "rows": len(df),
            "columns": len(df.columns),
            "column_names": list(df.columns),
        }
    return json.dumps(info, indent=2)


@mcp.tool()
def unload_dataset(name: str) -> str:
    """Remove a dataset from memory by name."""
    if name not in DATAFRAMES:
        return f"Error: dataset '{name}' not found."
    del DATAFRAMES[name]
    return f"Unloaded '{name}'."


@mcp.tool()
def list_columns(dataset: str) -> str:
    """List columns, dtypes, and sample rows for a dataset."""
    if dataset not in DATAFRAMES:
        return f"Error: unknown dataset '{dataset}'. Call list_datasets first."
    df = DATAFRAMES[dataset]
    summary = {
        "dataset": dataset,
        "columns": {col: str(dtype) for col, dtype in df.dtypes.items()},
        "row_count": len(df),
        "sample_rows": json.loads(df.head(3).to_json(orient="records", default_handler=str)),
    }
    return json.dumps(summary, indent=2, default=str)


@mcp.tool()
def run_pandas(dataset: str, expression: str) -> str:
    """Evaluate a pandas expression against a dataset.

    'dataset' is the name from list_datasets.
    'expression' is a pandas expression using 'df' as the DataFrame variable.
    Only read/aggregation operations are allowed - no assignment, no imports, no exec.
    """
    if dataset not in DATAFRAMES:
        return f"Error: unknown dataset '{dataset}'. Call list_datasets first."

    disallowed = ["import", "__", "exec(", "eval(", "open(", "os.", "sys.", ";"]
    if any(tok in expression for tok in disallowed):
        return "Error: expression contains a disallowed token"

    try:
        df = DATAFRAMES[dataset]
        result = eval(expression, {"__builtins__": {}}, {"df": df, "pd": pd})

        if isinstance(result, pd.DataFrame):
            return json.dumps(
                json.loads(result.head(200).to_json(orient="records", default_handler=str)),
                indent=2,
            )
        elif isinstance(result, pd.Series):
            return json.dumps(
                json.loads(result.head(200).to_json(orient="index", default_handler=str)),
                indent=2,
            )
        return json.dumps(result, default=str)
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def generate_chart(
    dataset: str,
    chart_type: str,
    x_column: str,
    y_column: str,
    operation: str = "sum",
    limit: int = 20,
) -> str:
    """Generate a Chart.js specification JSON.

    chart_type: bar, line, pie, doughnut
    operation: sum, mean, count, min, max
    """
    if dataset not in DATAFRAMES:
        return f"Error: unknown dataset '{dataset}'."
    if chart_type not in ("bar", "line", "pie", "doughnut"):
        return "Error: chart_type must be bar, line, pie, or doughnut."
    if x_column not in DATAFRAMES[dataset].columns:
        return f"Error: x_column '{x_column}' not found."
    if y_column not in DATAFRAMES[dataset].columns:
        return f"Error: y_column '{y_column}' not found."

    try:
        grouped = DATAFRAMES[dataset].groupby(x_column)[y_column]
        if operation == "sum":
            agg = grouped.sum()
        elif operation == "mean":
            agg = grouped.mean()
        elif operation == "count":
            agg = grouped.count()
        elif operation == "min":
            agg = grouped.min()
        elif operation == "max":
            agg = grouped.max()
        else:
            return f"Error: unknown operation '{operation}'."

        agg = agg.sort_values(ascending=False).head(limit)
        labels = [str(idx) for idx in agg.index]
        values = [float(v) for v in agg.values]

        colors = [
            "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
            "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
        ]
        chart_spec = {
            "type": chart_type,
            "data": {
                "labels": labels,
                "datasets": [
                    {
                        "label": f"{y_column} ({operation})",
                        "data": values,
                        "backgroundColor": colors * ((len(values) // 10) + 1),
                        "borderColor": "#1e3a8a",
                        "borderWidth": 1,
                    }
                ],
            },
            "options": {
                "responsive": True,
                "plugins": {
                    "title": {"display": True, "text": f"{y_column} by {x_column} ({operation})"},
                    "legend": {"display": chart_type in ("line", "doughnut")},
                },
                "scales": {
                    "y": {"beginAtZero": True, "display": chart_type not in ("pie", "doughnut")},
                    "x": {"display": chart_type not in ("pie", "doughnut")},
                },
            },
        }
        return json.dumps(chart_spec)
    except Exception as e:
        return f"Error generating chart: {e}"


if __name__ == "__main__":
    load_paths = sys.argv[1:] if len(sys.argv) > 1 else []
    for path in load_paths:
        print(load_file(path), file=sys.stderr)
    mcp.run(transport="stdio")
