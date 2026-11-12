# -*- coding: utf-8 -*-
"""station_dxf.py — 基站表生图 MCP 工具（课题10 封装）

调用 scripts/station_dxf.cjs（Node 无头入口），复用《基站表生图系统 v3.0》
全部绘图引擎：Excel 解析校验 → 塔型识别 → 世界图元收集 → R12 DXF 输出。
支持单站基站图与设计院整套图纸（6 张/站）两种模式。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

SERVER_ROOT = Path(__file__).resolve().parent.parent
NODE_SCRIPT = SERVER_ROOT / "scripts" / "station_dxf.cjs"


def resolve_node() -> str:
    """Node 可执行文件解析：环境变量 NODE_BIN → TeleAgent 自带运行时 → 常见安装位 → PATH。"""
    import os
    env = os.environ.get("NODE_BIN", "").strip()
    if env:
        return env
    candidates = [
        Path.home() / ".local" / "share" / "TeleAgent" / "runtimes" / "node" / "node.exe",
        Path(r"C:\Program Files\nodejs\node.exe"),
        Path(r"C:\Program Files (x86)\nodejs\node.exe"),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return "node"  # 回退 PATH


NODE_BIN = resolve_node()


class StationDxfInput(BaseModel):
    """基站出图工具输入。"""
    excel_path: str = Field(
        ...,
        description="基站数据工作簿路径（xlsx/xls），需含「基站主表」与「安装明细表」两个工作表，"
        "模板见工程 templates/基站数据模板.xlsx",
        min_length=3,
    )
    mode: str = Field(
        default="single",
        description="出图模式：single=单站基站图（每站1张总图）；kit=设计院整套图纸（每站6张："
        "机房布置平面图/综合柜立面图/导线路由图/天馈线系统图/施工安全说明图×2）",
        pattern="^(single|kit)$",
    )
    station_name: Optional[str] = Field(
        default=None,
        description="只出指定基站（须与主表「基站名称」完全一致）；留空则整本工作簿全部站点出图",
        max_length=100,
    )
    output_dir: str = Field(
        ...,
        description="DXF 输出目录（不存在会自动创建）。建议每次任务使用独立子目录。",
        min_length=3,
    )
    show_plan: bool = Field(default=True, description="单站图是否包含俯视图")
    show_table: bool = Field(default=True, description="单站图是否包含设备明细表")
    show_dim: bool = Field(default=True, description="单站图是否包含尺寸标注")


def generate_station_dxf(params: StationDxfInput) -> str:
    """运行 Node 无头出图并返回结果 JSON。"""
    excel = Path(params.excel_path)
    if not excel.exists():
        return json.dumps({
            "ok": False,
            "error": f"Excel 文件不存在：{excel}",
            "hint": "请先确认路径；数据模板见工程 templates/基站数据模板.xlsx",
        }, ensure_ascii=False)

    if not NODE_SCRIPT.exists():
        return json.dumps({
            "ok": False,
            "error": f"出图脚本缺失：{NODE_SCRIPT}",
        }, ensure_ascii=False)

    # 参数经临时 JSON 文件传递（避免命令行中文转义问题）
    tmp_args = SERVER_ROOT / ".temp" / f"mcp-args-{id(params)}.json"
    tmp_args.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "excelPath": str(excel.resolve()),
        "stationName": params.station_name,
        "mode": params.mode,
        "outputDir": str(Path(params.output_dir).resolve()),
        "options": {
            "showPlan": params.show_plan,
            "showTable": params.show_table,
            "showDim": params.show_dim,
        },
    }
    tmp_args.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    try:
        proc = subprocess.run(
            [NODE_BIN, str(NODE_SCRIPT), str(tmp_args)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=300,
            cwd=str(SERVER_ROOT),
        )
    except FileNotFoundError:
        return json.dumps({
            "ok": False,
            "error": "未找到 node 可执行文件（已尝试：NODE_BIN 环境变量、TeleAgent 自带运行时、"
                     "Program Files 常见位、PATH）。请安装 Node.js 18+ 或设置 NODE_BIN 指向 node.exe。",
        }, ensure_ascii=False)
    except subprocess.TimeoutExpired:
        return json.dumps({
            "ok": False,
            "error": "出图超时（>300 秒）。站点过多时建议分批出图。",
        }, ensure_ascii=False)
    finally:
        try:
            tmp_args.unlink(missing_ok=True)
        except OSError:
            pass

    out = (proc.stdout or "").strip()
    if not out:
        return json.dumps({
            "ok": False,
            "error": f"出图脚本无输出（退出码 {proc.returncode}）",
            "stderr": (proc.stderr or "")[:2000],
        }, ensure_ascii=False)
    try:
        result = json.loads(out)
    except json.JSONDecodeError:
        return json.dumps({
            "ok": False,
            "error": "出图脚本输出不是有效 JSON",
            "raw": out[:2000],
            "stderr": (proc.stderr or "")[:2000],
        }, ensure_ascii=False)

    # 附加人类可读摘要，便于 Agent 直接引用
    if result.get("ok"):
        files = result.get("files", [])
        stations = result.get("stations", [])
        lines = [
            f"DXF 出图成功：{len(files)} 张图纸，{len(stations)} 个基站（模式 {result.get('mode')}）",
        ]
        for st in stations:
            lines.append(
                f"- {st.get('name')}：{st.get('tower')}，塔高 {st.get('height')}m"
                f"（总高 {st.get('totalHeight')}m），{st.get('platforms')} 层平台，"
                f"{st.get('antennas')} 副天线"
            )
        for w in (result.get("warnings") or [])[:5]:
            lines.append(f"⚠ {w}")
        result["summary"] = "\n".join(lines)
    return json.dumps(result, ensure_ascii=False, indent=2)
