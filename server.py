#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
telecom_agent_mcp — 人工智能+信息通信 MCP 服务器（课题10 核心交付）

把本地自研工程引擎封装为 LLM 可调用的 MCP 工具，构成
「规范检索 → 基站出图 → 方案成文」与「政企专线设计」两条链路：

  1. search_telecom_std   通信设计规范宝典检索（128 标准 / 782 强条 / 489 万字全文）
  2. list_telecom_std     标准清单与统计
  3. generate_station_dxf 基站表生图（Excel → 单站图/设计院整套图纸 DXF）
  4. compose_design_doc   基站建设工程设计方案 Word 文档生成
  5. telecom_suite_status 引擎自检（数据源/Node/路径可用性）
  6. design_dedicated_line 政企专线设计（路由/选型/投资估算/方案文档+路由图）

传输：stdio（TeleAgent 子进程）。
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

# 预导入 openpyxl/python-docx：确保重依赖在启动单线程阶段完成加载，
# 规避运行时在事件循环线程首次触发扩展模块加载时的 Windows loader-lock 死锁
import openpyxl  # noqa: F401
import docx  # noqa: F401

# 让 tools/ 可导入
sys.path.insert(0, str(Path(__file__).resolve().parent))

from tools import baodian_search
from tools.dedicated_line import DedLineInput, design_dedicated_line
from tools.document_gen import ComposeDocInput, compose_design_document
from tools.station_dxf import StationDxfInput, generate_station_dxf

mcp = FastMCP("telecom_agent_mcp")

SERVER_ROOT = Path(__file__).resolve().parent
VERSION = "1.2.2"  # 1.2.2：部署包自包含（engine/station-dxf-js 引擎同步 v3.1 文字避让版，自检优先查部署包）


# ============================================================
# 工具 1：规范检索
# ============================================================
class SearchStdInput(BaseModel):
    """规范检索输入。"""
    query: str = Field(
        default="",
        description="检索关键词，空格分隔多词为 AND 语义，如 '抗震设防 基站'；"
        "与 code/category 至少提供一个",
        max_length=200,
    )
    category: str = Field(
        default="",
        description="专业过滤：无线网/线路/设备/外市电/集客/管道/补充核验",
        max_length=20,
    )
    code: str = Field(
        default="",
        description="标准号模糊过滤，如 'YD 5059'（忽略空格与大小写）",
        max_length=40,
    )
    mandatory_only: bool = Field(
        default=False,
        description="仅检索强制性条文（共 782 条）",
    )
    limit: int = Field(default=20, description="单页返回条数（1-100）", ge=1, le=100)
    offset: int = Field(default=0, description="分页偏移", ge=0)


@mcp.tool(
    name="search_telecom_std",
    annotations={
        "title": "通信设计规范检索",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def search_telecom_std(params: SearchStdInput) -> str:
    """在《通信设计依据宝典》全文库中检索规范条文（无线网/线路/设备/外市电/集客/管道）。

    数据库收录 128 项通信设计标准、782 条强制性条文、约 489 万字条文级全文。
    适用于：查设计依据、查强条、验证方案合规性、为设计方案编制"编制依据"章节。

    Args:
        params (SearchStdInput):
            - query: 关键词（AND 语义），如 "抗震设防" 或 "铁塔 防雷"
            - category: 专业过滤（无线网/线路/设备/外市电/集客/管道/补充核验）
            - code: 标准号模糊过滤，如 "GB 51194"、"YD/T 5231"
            - mandatory_only: 仅返回强制性条文
            - limit/offset: 分页（默认 20 条/页）

    Returns:
        str: JSON 字符串，含 total/count/standards_hit/results[]。
        每条结果含：code（标准号）、title（标准名）、category（专业）、
        clause_kind（强条/条文）、number（条文号）、text（条文内容，超长截断至 500 字）。

    Examples:
        - "查基站抗震设计的强制性条文" -> query="抗震 基站", mandatory_only=true
        - "GB 51194 里关于蓄电池的条文" -> code="GB 51194", query="蓄电池"
        - "列出无线网专业所有标准" -> category="无线网"（配合 list 工具更佳）
    """
    try:
        result = baodian_search.search_standards(
            query=params.query,
            category=params.category or None,
            code=params.code or None,
            mandatory_only=params.mandatory_only,
            limit=params.limit,
            offset=params.offset,
        )
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as e:
        return json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False)
    except FileNotFoundError as e:
        return json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False)


# ============================================================
# 工具 2：标准清单
# ============================================================
class ListStdInput(BaseModel):
    """标准清单输入。"""
    category: str = Field(
        default="",
        description="按专业过滤（留空列出全部 128 项）",
        max_length=20,
    )


@mcp.tool(
    name="list_telecom_std",
    annotations={
        "title": "通信标准清单",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def list_telecom_std(params: ListStdInput) -> str:
    """列出《通信设计依据宝典》收录的标准清单（含各标准全文与强条数量统计）。

    适用场景：设计前盘点可用依据标准、按专业浏览规范体系、
    编制设计文件"编制依据"章节前确认标准现行状态。

    Args:
        params (ListStdInput):
            - category: 按专业过滤（无线网/线路/设备/外市电/集客/管道/补充核验），留空返回全部

    Returns:
        str: JSON，含 total 与 standards[]（code/title/category/status/
        fulltext_clauses/mandatory_clauses）。

    Examples:
        - "看看宝典里有哪些无线网标准" -> category="无线网"
        - "列出全部标准" -> 不带参数
    """
    result = baodian_search.list_standards(category=params.category or None)
    return json.dumps(result, ensure_ascii=False, indent=2)


# ============================================================
# 工具 3：基站出图
# ============================================================
@mcp.tool(
    name="generate_station_dxf",
    annotations={
        "title": "基站表生图（Excel→DXF）",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def tool_generate_station_dxf(params: StationDxfInput) -> str:
    """把基站勘察数据工作簿（Excel）自动转换为成套 DXF 图纸。

    复用《基站表生图系统 v3.0》全部绘图引擎（对齐中国移动设计院施工图模板）：
    自动解析「基站主表/安装明细表」→ 识别 10 类塔型（单管塔/角钢塔/三管塔/
    拉线塔/H杆/楼顶抱杆/楼顶平台/美化塔等）→ 生成 R12 兼容 DXF（毫米单位、
    分图层、含图框/标题栏/尺寸标注/俯视图/设备明细表）。

    两种出图模式：
    - single：每站 1 张基站总图（含塔体立面、俯视图、明细表、图例）
    - kit：每站 6 张设计院标准图纸（机房布置平面图/综合柜立面图/导线路由图/
      天馈线系统图/施工安全说明图×2）

    Args:
        params (StationDxfInput):
            - excel_path: 基站数据工作簿路径（须含「基站主表」「安装明细表」，
              模板：E:\\软件开发\\基站表生图\\基站数据模板.xlsx）
            - mode: single（单站图）或 kit（设计院整套），默认 single
            - station_name: 指定基站名称（与主表一致）；留空则全部站点
            - output_dir: 输出目录（自动创建）
            - show_plan/show_table/show_dim: 单站图内容开关

    Returns:
        str: JSON，含 ok/files[]（DXF 路径列表）/stations[]（站名、塔型、塔高、
        平台数、天线数、坐标等项目摘要，可直接喂给方案文档工具）/
        warnings[]/summary（人类可读摘要）。数据校验失败时返回 errors 与
        可用站点列表 available[]。

    Examples:
        - "把这份勘察表出成设计院整套图纸" -> excel_path=..., mode="kit"
        - "只出示范站A的单站图" -> station_name="示范站A", mode="single"
    """
    return generate_station_dxf(params)


# ============================================================
# 工具 4：方案文档生成
# ============================================================
@mcp.tool(
    name="compose_design_doc",
    annotations={
        "title": "基站设计方案文档生成",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": False,
    },
)
async def tool_compose_design_doc(params: ComposeDocInput) -> str:
    """生成《基站建设工程设计方案》Word 文档（公文风格 A4 版式）。

    与其他两个工具串联构成课题10"生成全套文档"链路：
    search_telecom_std 的检索结果 → citations（编制依据章节）；
    generate_station_dxf 的 stations → stations（工程概况/建设方案章节）；
    generate_station_dxf 的 files → drawings（图纸清单章节）。

    文档结构：封面（项目名/工程编号/设计单位/日期）→ 一、编制依据（规范
    条文级引用）→ 二、工程概况（站点汇总表）→ 三、建设方案（分站描述）
    → 四、图纸清单 → 五、注意事项 → 附加章节（自定义）。

    Args:
        params (ComposeDocInput):
            - output_path: 输出 docx 完整路径
            - project_name/project_no/design_unit: 项目信息（缺省取站点数据）
            - stations: 站点列表（直接使用 generate_station_dxf 返回的 stations）
            - citations: 规范引用（直接使用 search_telecom_std 返回的 results）
            - drawings: 图纸清单（直接使用 generate_station_dxf 返回的 files）
            - notes: 注意事项
            - extra_sections: 附加章节 [{title, content}]

    Returns:
        str: JSON，含 ok/file/size_bytes/summary。

    Examples:
        - "为这批基站出一份设计方案" -> stations=[...], citations=[...], drawings=[...]
    """
    try:
        return compose_design_document(params)
    except Exception as e:
        return json.dumps(
            {"ok": False, "error": f"文档生成失败：{type(e).__name__}: {e}"},
            ensure_ascii=False,
        )


# ============================================================
# 工具 5：引擎自检
# ============================================================
@mcp.tool(
    name="telecom_suite_status",
    annotations={
        "title": "电信智能体套件自检",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def telecom_suite_status() -> str:
    """自检本 MCP 服务器依赖的三套本地引擎是否可用。

    检查项：规范宝典数据文件、基站表生图 JS 引擎与 Node 运行时、
    文档生成依赖（python-docx）。任一缺失时给出具体修复指引。

    Returns:
        str: JSON，含各组件 status（ok/missing）与总体 ok 标志。

    Examples:
        - "出图工具报错前先自检一下" -> 无参数调用
    """
    from tools.station_dxf import NODE_SCRIPT
    from tools.baodian_search import BAODIAN_DATA

    checks = {}
    # 宝典数据
    checks["baodian_data"] = {
        "path": str(BAODIAN_DATA),
        "status": "ok" if BAODIAN_DATA.exists() else "missing",
    }
    if BAODIAN_DATA.exists():
        try:
            st = baodian_search.stats()
            checks["baodian_data"]["standards"] = st["standards"]
            checks["baodian_data"]["mandatory_clauses"] = st["mandatory_clauses"]
        except Exception as e:
            checks["baodian_data"]["status"] = f"error: {e}"
    # 表生图引擎（与 station_dxf.cjs 同一解析链：部署包 → 开发机原路径）
    bundled_engine = SERVER_ROOT / "engine" / "station-dxf-js"
    dev_engine = Path(r"E:\软件开发\基站表生图\app\js")
    engine = bundled_engine if (bundled_engine / "dxf.js").exists() else dev_engine
    checks["station_engine"] = {
        "path": str(engine),
        "source": "bundled" if engine == bundled_engine else "dev-fallback",
        "status": "ok" if (engine / "dxf.js").exists() else "missing",
        "script": str(NODE_SCRIPT),
        "script_status": "ok" if NODE_SCRIPT.exists() else "missing",
    }
    # Node 运行时（与出图工具同一解析链：NODE_BIN → TeleAgent 运行时 → 常见位 → PATH）
    from tools.station_dxf import resolve_node
    node = resolve_node()
    node_found = Path(node).exists() if Path(node).is_absolute() else shutil.which(node) is not None
    node_ver = ""
    if node_found:
        try:
            p = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10)
            node_ver = (p.stdout or "").strip()
        except Exception:
            node_ver = "unknown"
    checks["node"] = {
        "path": node,
        "resolved": node_found,
        "version": node_ver,
        "status": "ok" if node_found else "missing",
    }
    # 文档引擎
    try:
        import docx  # noqa: F401
        checks["document_engine"] = {"status": "ok", "lib": "python-docx"}
    except ImportError:
        checks["document_engine"] = {"status": "missing", "lib": "python-docx"}

    ok = all(c.get("status") == "ok" for c in checks.values())
    return json.dumps(
        {"ok": ok, "version": VERSION, "server_root": str(SERVER_ROOT), "checks": checks},
        ensure_ascii=False,
        indent=2,
    )


# ============================================================
# 工具 6：政企专线设计
# ============================================================
@mcp.tool(
    name="design_dedicated_line",
    annotations={
        "title": "政企专线设计（路由/选型/投资/方案）",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": False,
    },
)
async def tool_design_dedicated_line(params: DedLineInput) -> str:
    """设计政企专线接入方案：路由估算 → 选型 → 材料与投资估算 → 方案文档 + 路由图。

    输入客户与接入局站信息（经纬度成对提供，或 distance_km/route_length_km 覆盖），
    自动完成：
    - 路由距离：球面直线距离（haversine）× 绕曲系数（默认 1.35）；双路由按主路由 80% 估算
    - 光缆选型：GYTA/GYTA53（直埋），芯数按专线类型与带宽自动确定
    - 设备选型：光模块（GE/10GE/40GE/100GE）、ONU/分光器（PON）、协议转换器（MSTP）、
      OTU 板卡（OTN）；裸光纤无设备
    - 投资估算：材料/施工/设备 + 设计费 4% + 不可预见费 3%（参考单价表
      config/dedline_prices.json，可编辑校准，正式报审须套 451 定额）
    - 产出：《政企专线建设方案》.docx + 路由示意图 .dxf（R12）

    支持 5 类专线：pon（PON专线）/ mstp（数字电路）/ otn（波分专线）/
    ethernet（以太网点到点）/ darkfiber（裸光纤租用）；3 种敷设：管道/架空/直埋。

    Args:
        params (DedLineInput): 客户信息、接入局站信息、line_type、bandwidth_mbps、
            route_type、protection、坐标或距离覆盖、output_docx/output_dxf、
            citations（可用 search_telecom_std 集客专业检索结果）。

    Returns:
        str: JSON，含 route（直线/主路由/第二路由）、scheme（光缆/芯数/带宽）、
        materials[]、devices[]、investment（材料/施工/设备/设计费/不可预见费/总投资）、
        duration_days、files{docx,dxf}、summary（人类可读摘要）、prices_note。

    Examples:
        - "给XX医院设计一条到广文路通信站的千兆以太网专线，出方案文档和路由图"
        - "PON 专线 300M，管道敷设，双路由保护" -> line_type="pon", bandwidth_mbps=300,
          route_type="管道", protection=true
    """
    try:
        return design_dedicated_line(params)
    except Exception as e:
        return json.dumps(
            {"ok": False, "error": f"专线设计失败：{type(e).__name__}: {e}"},
            ensure_ascii=False,
        )


if __name__ == "__main__":
    mcp.run()
