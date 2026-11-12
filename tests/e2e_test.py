# -*- coding: utf-8 -*-
"""端到端测试：检索 → 出图 → 成文 全链路（不经过 MCP 协议层）"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import baodian_search
from tools.station_dxf import StationDxfInput, generate_station_dxf
from tools.document_gen import ComposeDocInput, StationInfo, CitationInfo, compose_design_document

PASS = "✓"
FAIL = "✗"
results = []


def check(name, cond, detail=""):
    results.append((name, cond, detail))
    print(f"{PASS if cond else FAIL} {name} {('- ' + detail) if detail and not cond else ''}")


print("=" * 60)
print("测试 1：规范检索")
print("=" * 60)
# 1.1 统计
st = baodian_search.stats()
check("宝典统计加载", st["standards"] == 128, f"standards={st['standards']}")
check("强条数量", st["mandatory_clauses"] == 782, f"mandatory={st['mandatory_clauses']}")

# 1.2 关键词检索
r = baodian_search.search_standards(query="抗震设防", limit=10)
check("关键词检索有结果", r["total"] > 0, f"total={r['total']}")

# 1.3 强条过滤
r2 = baodian_search.search_standards(query="抗震", mandatory_only=True, limit=10)
check("强条检索", r2["total"] > 0 and all(
    x["clause_kind"] in ("强条",) for x in r2["results"] if x["clause_kind"] != "标准"
), f"total={r2['total']}")

# 1.4 标准号过滤
r3 = baodian_search.search_standards(query="蓄电池", code="GB 51194", limit=10)
check("标准号+关键词组合检索", r3["total"] > 0, f"total={r3['total']}")

# 1.5 专业清单
r4 = baodian_search.list_standards(category="无线网")
check("专业清单", r4["total"] == 40, f"无线网={r4['total']}")

print()
print("=" * 60)
print("测试 2：基站出图（Python 包装层）")
print("=" * 60)
out_dir = Path(__file__).resolve().parent / "e2e-out"
inp = StationDxfInput(
    excel_path=r"E:\软件开发\基站表生图\基站数据模板.xlsx",
    mode="single",
    station_name="示范站A-城东工业园",
    output_dir=str(out_dir),
)
resp = json.loads(generate_station_dxf(inp))
check("出图调用成功", resp.get("ok") is True, str(resp.get("error", "")))
check("生成 1 张 DXF", len(resp.get("files", [])) == 1)
check("返回站点摘要", resp.get("stations", [{}])[0].get("tower") == "单管塔")
dxf_file = Path(resp["files"][0]) if resp.get("files") else None
check("DXF 文件真实存在", dxf_file is not None and dxf_file.exists())
if dxf_file and dxf_file.exists():
    head = dxf_file.read_text(encoding="utf-8")[:200]
    check("DXF 头部 R12 (AC1009)", "AC1009" in head)

print()
print("=" * 60)
print("测试 3：方案文档生成（串联前两步结果）")
print("=" * 60)
doc_path = out_dir / "示范站A-设计方案.docx"
stations = [StationInfo(**{k: v for k, v in s.items() if k in StationInfo.model_fields})
            for s in resp.get("stations", [])]
citations = [CitationInfo(**{k: v for k, v in c.items() if k in CitationInfo.model_fields})
             for c in r2["results"][:5]]
doc_inp = ComposeDocInput(
    output_path=str(doc_path),
    project_name="2025年极简站（示范站A）",
    stations=stations,
    citations=citations,
    drawings=resp.get("files", []),
    notes=resp.get("warnings", []),
    extra_sections=[{"title": "验收要求", "content": "工程验收按 YD/T 5231 及现行验收规范执行。\n铁塔安装后应进行垂直度测量。"}],
)
doc_resp = json.loads(compose_design_document(doc_inp))
check("文档生成成功", doc_resp.get("ok") is True, str(doc_resp.get("error", "")))
check("docx 文件存在", doc_path.exists())
if doc_path.exists():
    check("文档非空 (>10KB)", doc_path.stat().st_size > 10240, f"{doc_path.stat().st_size} bytes")

print()
print("=" * 60)
total = len(results)
passed = sum(1 for _, c, _ in results if c)
print(f"结果：{passed}/{total} 通过")
print("=" * 60)
sys.exit(0 if passed == total else 1)
