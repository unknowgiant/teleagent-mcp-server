# -*- coding: utf-8 -*-
"""document_gen.py — 基站建设工程设计方案文档生成工具（课题10 MCP 封装）

输入结构化方案数据（通常来自 generate_station_dxf 的站点摘要 +
search_telecom_std 的规范引用），输出正式《设计方案》Word 文档。
与基站表生图、规范宝典检索串联，构成课题10"生成全套文档"能力。
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from pydantic import BaseModel, Field


class StationInfo(BaseModel):
    """单个站点信息（与 generate_station_dxf 输出的 stations[] 字段对齐）。"""
    name: str = Field(..., description="基站名称", min_length=1, max_length=100)
    tower: str = Field(default="", description="塔型，如 单管塔/角钢塔/楼顶抱杆")
    height: Optional[float] = Field(default=None, description="塔体自身高度（米）")
    total_height: Optional[float] = Field(default=None, description="总挂高/总高（米）")
    platforms: Optional[int] = Field(default=None, description="平台层数")
    antennas: Optional[int] = Field(default=None, description="天线总数")
    addr: str = Field(default="", description="站址")
    lon: str = Field(default="", description="经度")
    lat: str = Field(default="", description="纬度")
    proj_no: str = Field(default="", description="工程编号")
    proj_name: str = Field(default="", description="项目名称")


class CitationInfo(BaseModel):
    """规范引用条目（与 search_telecom_std 输出的 results[] 字段对齐）。"""
    code: str = Field(..., description="标准号，如 YD/T 5231-2019", min_length=1)
    title: str = Field(default="", description="标准名称")
    number: str = Field(default="", description="条文号，如 4.1.2")
    text: str = Field(default="", description="条文内容（可截断）")


class ComposeDocInput(BaseModel):
    """方案文档生成输入。"""
    output_path: str = Field(
        ...,
        description="输出 docx 文件完整路径（含文件名），如 E:\\方案\\XX基站设计方案.docx",
        min_length=5,
    )
    project_name: str = Field(default="", description="项目名称（默认取站点 proj_name 或「无线基站建设工程」）")
    project_no: str = Field(default="", description="工程编号")
    design_unit: str = Field(default="中国电信", description="设计单位名称")
    stations: List[StationInfo] = Field(
        default_factory=list,
        description="站点列表，可直接使用 generate_station_dxf 返回的 stations 数组",
        max_length=500,
    )
    citations: List[CitationInfo] = Field(
        default_factory=list,
        description="编制依据规范引用，可直接使用 search_telecom_std 返回的 results 数组",
        max_length=200,
    )
    drawings: List[str] = Field(
        default_factory=list,
        description="图纸文件路径清单（generate_station_dxf 返回的 files 数组）",
        max_length=2000,
    )
    notes: List[str] = Field(
        default_factory=list,
        description="注意事项/警告（如数据校验 warnings）",
        max_length=50,
    )
    extra_sections: List[Dict[str, str]] = Field(
        default_factory=list,
        description="附加章节，每项 {title, content}，将按顺序追加到方案正文之后",
        max_length=20,
    )


def _set_cn_font(run, name="仿宋", size=12, bold=False, color=None):
    """设置中文字体。"""
    run.font.name = "Times New Roman"
    run.font.size = Pt(size)
    run.font.bold = bold
    if color:
        run.font.color.rgb = color
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)


def _add_heading_cn(doc, text, level=1):
    """中文标题（黑体）。"""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER if level == 0 else WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run(text)
    _set_cn_font(run, name="黑体", size=22 if level == 0 else (16 if level == 1 else 14), bold=True)
    if level == 0:
        p.paragraph_format.space_before = Pt(120)
        p.paragraph_format.space_after = Pt(60)
    return p


def _add_body(doc, text, indent=True):
    """正文段落（仿宋，首行缩进两字符）。"""
    p = doc.add_paragraph()
    run = p.add_run(text)
    _set_cn_font(run, name="仿宋", size=12)
    if indent:
        p.paragraph_format.first_line_indent = Cm(0.85)
    p.paragraph_format.line_spacing = 1.5
    return p


def _add_table(doc, headers: List[str], rows: List[List[str]]):
    """三线风格表格。"""
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ""
        run = hdr[i].paragraphs[0].add_run(str(h))
        _set_cn_font(run, name="黑体", size=10.5, bold=True)
    for row in rows:
        cells = table.add_row().cells
        for i, v in enumerate(row):
            if i < len(cells):
                cells[i].text = ""
                run = cells[i].paragraphs[0].add_run(str(v))
                _set_cn_font(run, name="仿宋", size=10.5)
    return table


def compose_design_document(params: ComposeDocInput) -> str:
    """生成《基站建设工程设计方案》Word 文档。"""
    out_path = Path(params.output_path)
    if out_path.suffix.lower() != ".docx":
        out_path = out_path.with_suffix(".docx")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    doc = Document()
    # 页面：A4
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = section.right_margin = Cm(2.6)
    section.top_margin = section.bottom_margin = Cm(2.8)

    project_name = params.project_name or (
        params.stations[0].proj_name if params.stations else "无线基站建设工程"
    )
    project_no = params.project_no or (
        params.stations[0].proj_no if params.stations else ""
    )

    # ===== 封面 =====
    _add_heading_cn(doc, f"{project_name}", 0)
    _add_heading_cn(doc, "设 计 方 案", 0)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(
        f"\n工程编号：{project_no or '—'}\n"
        f"设计单位：{params.design_unit}\n"
        f"编制日期：{date.today().isoformat()}"
    )
    _set_cn_font(run, name="仿宋", size=14)
    doc.add_page_break()

    # ===== 一、编制依据 =====
    _add_heading_cn(doc, "一、编制依据", 1)
    if params.citations:
        # 按标准号去重，保留条文级引用
        seen_codes = {}
        for c in params.citations:
            key = c.code
            if key not in seen_codes:
                seen_codes[key] = {"code": c.code, "title": c.title, "clauses": []}
            if c.number:
                seen_codes[key]["clauses"].append(f"{c.number} {c.text[:80]}")
        for i, (code, info) in enumerate(seen_codes.items(), 1):
            _add_body(doc, f"{i}. 《{info['title'] or '（标准）'}》{code}")
            for cl in info["clauses"][:3]:
                _add_body(doc, f"　　· 条 {cl}…", indent=False)
        _add_body(doc, f"{len(seen_codes) + 1}. 工程现场勘察资料及建设单位提供的相关技术资料。")
    else:
        _add_body(doc, "1. 工程现场勘察资料及建设单位提供的相关技术资料。")
        _add_body(doc, "（本次未附规范引用，可通过规范检索工具补充编制依据。）")

    # ===== 二、工程概况 =====
    _add_heading_cn(doc, "二、工程概况", 1)
    if params.stations:
        _add_body(doc, f"本工程共包含 {len(params.stations)} 个基站站点，具体情况见下表：")
        rows = []
        for st in params.stations:
            rows.append([
                st.name,
                st.tower or "—",
                f"{st.height}m" if st.height is not None else "—",
                f"{st.total_height}m" if st.total_height is not None else "—",
                str(st.platforms if st.platforms is not None else "—"),
                str(st.antennas if st.antennas is not None else "—"),
                st.addr or "—",
            ])
        _add_table(
            doc,
            ["基站名称", "塔型", "塔高", "总高", "平台", "天线", "站址"],
            rows,
        )
    else:
        _add_body(doc, "（未提供站点数据。）")

    # ===== 三、建设方案 =====
    _add_heading_cn(doc, "三、建设方案", 1)
    for st in params.stations:
        _add_heading_cn(doc, f"3.{params.stations.index(st) + 1} {st.name}", 2)
        desc = []
        if st.tower:
            desc.append(f"本站采用{st.tower}")
        if st.height is not None:
            desc.append(f"塔体高度 {st.height}m")
        if st.total_height is not None:
            desc.append(f"最高挂高约 {st.total_height}m")
        if st.platforms is not None:
            desc.append(f"共 {st.platforms} 层平台")
        if st.antennas is not None:
            desc.append(f"本期布设天线 {st.antennas} 副")
        _add_body(doc, "，".join(desc) + "。天线方位角与安装明细详见安装明细表及天馈线系统图。")
        if st.lon or st.lat:
            _add_body(
                doc,
                f"站址坐标：东经 {st.lon or '—'}，北纬 {st.lat or '—'}"
                f"（站址：{st.addr or '—'}）。",
            )

    # ===== 四、图纸清单 =====
    _add_heading_cn(doc, "四、图纸清单", 1)
    if params.drawings:
        _add_body(doc, f"本方案配套图纸共 {len(params.drawings)} 张（DXF 格式，R12 兼容，毫米单位）：")
        for i, d in enumerate(params.drawings, 1):
            _add_body(doc, f"{i}. {Path(d).name}", indent=False)
    else:
        _add_body(doc, "（图纸另行成册。）")

    # ===== 五、注意事项 =====
    if params.notes:
        _add_heading_cn(doc, "五、注意事项", 1)
        for i, n in enumerate(params.notes, 1):
            _add_body(doc, f"{i}. {n}")

    # ===== 附加章节 =====
    sec_no = 6 if params.notes else 5
    for extra in params.extra_sections:
        title = extra.get("title", "")
        content = extra.get("content", "")
        _add_heading_cn(doc, f"{'一二三四五六七八九十'[(sec_no - 1) % 10]}、{title}", 1)
        for para in content.split("\n"):
            if para.strip():
                _add_body(doc, para.strip())
        sec_no += 1

    doc.save(str(out_path))

    return json.dumps(
        {
            "ok": True,
            "file": str(out_path),
            "size_bytes": out_path.stat().st_size,
            "stations": len(params.stations),
            "citations": len(params.citations),
            "drawings": len(params.drawings),
            "summary": (
                f"设计方案已生成：{out_path.name}（{len(params.stations)} 站、"
                f"{len(params.citations)} 条规范引用、{len(params.drawings)} 张图纸清单）"
            ),
        },
        ensure_ascii=False,
        indent=2,
    )
