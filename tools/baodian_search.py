# -*- coding: utf-8 -*-
"""baodian_search.py — 通信设计规范宝典检索工具（课题10 MCP 封装）

数据源：通信设计依据宝典 data.json（128 项标准、782 条强制性条文、
489 万字条文级全文，覆盖无线网/线路/设备/外市电/集客/管道专业）。
模块级缓存：首次调用加载约 12MB，进程内复用。
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

# 宝典数据解析：环境变量 → 工程内 data/ 副本（部署包自包含）→ 原绝对路径（开发机）
def _resolve_baodian_data() -> Path:
    import os
    env = os.environ.get("BAODIAN_DATA_FILE", "").strip()
    if env and Path(env).exists():
        return Path(env)
    bundled = Path(__file__).resolve().parent.parent / "data" / "baodian_data.json"
    if bundled.exists():
        return bundled
    return Path(r"E:\软件开发\通信设计依据宝典\github-publication\communication-design-reference\app\data.json")


BAODIAN_DATA = _resolve_baodian_data()

_CACHE: Optional[Dict[str, Any]] = None

# 专业分类（与宝典 categories 对应）
CATEGORIES = ["无线网", "线路", "设备", "外市电", "集客", "管道", "补充核验"]


def _load() -> Dict[str, Any]:
    """懒加载宝典数据（进程内只加载一次）。"""
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    if not BAODIAN_DATA.exists():
        raise FileNotFoundError(
            f"宝典数据文件不存在：{BAODIAN_DATA}。"
            "请确认《通信设计依据宝典》项目仍在原位置，或修改 BAODIAN_DATA 常量。"
        )
    with open(BAODIAN_DATA, encoding="utf-8") as f:
        _CACHE = json.load(f)
    return _CACHE


def _iter_clauses(record: Dict[str, Any], include_fulltext: bool):
    """遍历一条标准的所有条文：优先强条（clauses），可选全文（fullText）。"""
    for c in record.get("clauses") or []:
        yield {"kind": "强条", "number": c.get("number", ""), "text": c.get("text", "")}
    if include_fulltext:
        seen = {c.get("number") for c in record.get("clauses") or []}
        for c in record.get("fullText") or []:
            if c.get("number") not in seen:
                yield {"kind": "条文", "number": c.get("number", ""), "text": c.get("text", "")}


def _match(text: str, terms: List[str]) -> bool:
    """所有关键词都命中（不区分大小写）才算匹配。"""
    t = text.lower()
    return all(term in t for term in terms)


def search_standards(
    query: str,
    category: Optional[str] = None,
    code: Optional[str] = None,
    mandatory_only: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> Dict[str, Any]:
    """在宝典全文中检索规范条文。

    Args:
        query: 关键词，空格分隔多个词（AND 语义），如 "抗震设防 基站"。
        category: 专业过滤（无线网/线路/设备/外市电/集客/管道/补充核验）。
        code: 标准号过滤，支持模糊匹配，如 "GB 51194" 或 "YD 5059"。
        mandatory_only: 仅检索强制性条文（782 条）。
        limit/offset: 分页。

    Returns:
        dict: {total, count, offset, standards_hit, results: [{code, title,
        category, status, clause_kind, number, text}]}
    """
    data = _load()
    records = data.get("records", [])

    terms = [t.lower() for t in (query or "").split() if t.strip()]
    if not terms and not code and not category:
        raise ValueError(
            "query、code、category 至少提供一个。"
            "例如：query='抗震设防'，或 code='YD/T 5231'，或 category='无线网'。"
        )

    results: List[Dict[str, Any]] = []
    standards_hit = 0

    for rec in records:
        # 标准号过滤（模糊、不区分大小写）
        if code:
            code_l = code.lower().replace(" ", "")
            rec_code = (rec.get("code") or "").lower().replace(" ", "")
            if code_l not in rec_code:
                continue
        # 专业过滤
        if category:
            cats = rec.get("categories") or []
            if category not in cats:
                continue

        # 标题/标准号级命中（关键词命中标准名而非具体条文）
        title_hit = bool(terms) and _match(
            (rec.get("title") or "") + " " + (rec.get("code") or ""), terms
        )

        clause_matches: List[Dict[str, Any]] = []
        # 条文级匹配：条文自身文本命中关键词（强条优先迭代）
        for cl in _iter_clauses(rec, include_fulltext=not mandatory_only):
            if mandatory_only and cl["kind"] != "强条":
                continue
            if terms and not _match(cl["text"], terms):
                continue
            clause_matches.append({
                "code": rec.get("code", ""),
                "title": rec.get("title", ""),
                "category": "、".join(rec.get("categories") or []),
                "status": rec.get("status", ""),
                "clause_kind": cl["kind"],
                "number": cl["number"],
                "text": cl["text"][:500],  # 截断超长条文，控制上下文
            })

        if clause_matches:
            standards_hit += 1
            results.extend(clause_matches)
        elif title_hit or (not terms and code):
            # 无条文命中但标题命中（或仅按标准号定位）→ 标准级条目
            standards_hit += 1
            results.append({
                "code": rec.get("code", ""),
                "title": rec.get("title", ""),
                "category": "、".join(rec.get("categories") or []),
                "status": rec.get("status", ""),
                "clause_kind": "标准",
                "number": "",
                "text": (
                    f"标准信息：{rec.get('statusNote', '')}"
                    f"（全文 {len(rec.get('fullText') or [])} 条，"
                    f"强条 {len(rec.get('clauses') or [])} 条）"
                ),
            })
        elif not terms and not code and category:
            # 仅按专业列出时不逐条展开，只汇总标准级条目
            standards_hit += 1
            results.append({
                "code": rec.get("code", ""),
                "title": rec.get("title", ""),
                "category": "、".join(rec.get("categories") or []),
                "status": rec.get("status", ""),
                "clause_kind": "标准",
                "number": "",
                "text": (
                    f"全文 {len(rec.get('fullText') or [])} 条，"
                    f"强条 {len(rec.get('clauses') or [])} 条"
                ),
            })

    total = len(results)
    page = results[offset: offset + limit]
    return {
        "total": total,
        "count": len(page),
        "offset": offset,
        "standards_hit": standards_hit,
        "has_more": total > offset + limit,
        "next_offset": offset + limit if total > offset + limit else None,
        "results": page,
    }


def list_standards(category: Optional[str] = None) -> Dict[str, Any]:
    """列出宝典收录的标准清单（128 项）。"""
    data = _load()
    records = data.get("records", [])
    items = []
    for rec in records:
        if category and category not in (rec.get("categories") or []):
            continue
        items.append({
            "code": rec.get("code", ""),
            "title": rec.get("title", ""),
            "category": "、".join(rec.get("categories") or []),
            "status": rec.get("status", ""),
            "fulltext_clauses": len(rec.get("fullText") or []),
            "mandatory_clauses": len(rec.get("clauses") or []),
        })
    return {"total": len(items), "standards": items}


def stats() -> Dict[str, Any]:
    """宝典数据统计信息。"""
    data = _load()
    records = data.get("records", [])
    mandatory = sum(len(r.get("clauses") or []) for r in records)
    fulltext = sum(len(r.get("fullText") or []) for r in records)
    return {
        "generated_at": data.get("generatedAt", ""),
        "standards": len(records),
        "mandatory_clauses": mandatory,
        "fulltext_clauses": fulltext,
        "categories": CATEGORIES,
        "scope_note": data.get("scopeNote", ""),
    }
