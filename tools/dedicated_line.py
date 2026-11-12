# -*- coding: utf-8 -*-
"""dedicated_line.py — 政企专线设计模块 v1（课题10：补有线侧能力缺口）

链路：客户/局站信息 → 路由距离估算（haversine × 绕曲系数）→ 光缆与设备选型
→ 材料清单与投资估算（参考单价表 config/dedline_prices.json，可编辑校准）
→ 《政企专线建设方案》Word 文档 + 路由示意图 DXF（R12）。

v1 说明：
- 投资估算为参考单价（编辑 config/dedline_prices.json 校准为本地行情/定额单价），
  正式报审应套用 451 定额及当地工料机价格。
- 局站侧资源核查（OLT/OTN 端口、管孔占用）需资源系统支撑，v1 未覆盖，由人工确认。
"""
from __future__ import annotations

import json
import math
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm
from pydantic import BaseModel, Field

from .document_gen import CitationInfo, _add_body, _add_heading_cn, _add_table, _set_cn_font

SERVER_ROOT = Path(__file__).resolve().parent.parent
PRICE_FILE = SERVER_ROOT / "config" / "dedline_prices.json"

DEFAULT_PRICES: Dict[str, Any] = {
    "_note": "参考单价（元），非定额权威数据；请按本地行情与 451 定额校准后使用。",
    "cable_material_per_km": {"12": 2600, "24": 3800, "48": 5600},
    "cable_direct_buried_per_km": {"12": 3200, "24": 4500, "48": 6300},
    "construction_per_km": {"管道": 4500, "架空": 3800, "直埋": 5200},
    "materials": {
        "接头盒": 260, "ODF_24芯": 420, "ODF_144芯": 850, "尾纤": 35,
        "光纤跳线": 45, "子管3孔": 2200, "电杆": 350, "吊线": 1600,
    },
    "devices": {
        "光模块_GE": 380, "光模块_10GE": 1300, "光模块_40GE": 3200, "光模块_100GE": 8500,
        "ONU企业级": 1200, "分光器1:8": 450, "协议转换器": 900, "OTU客户侧板卡": 25000,
    },
    "rates": {"设计费率": 0.04, "不可预见费率": 0.03},
}

LINE_TYPE_INFO = {
    "pon": "PON 专线（无源光网络）：局端 OLT 经分光器接入客户端 ONU，适合中小带宽政企业务",
    "mstp": "MSTP 数字电路专线：基于 SDH/MSTP 传输网提供刚性带宽电路，客户端需协议转换设备",
    "otn": "OTN 波分专线：基于 OTN 波分网络提供大带宽透明传输，客户端配置 OTU 客户侧板卡",
    "ethernet": "以太网专线（点到点）：两端光模块经专纤直连，结构简单、时延低",
    "darkfiber": "裸光纤租用：整芯光纤出租，客户自备传输设备，运营商仅保证纤芯性能",
}

CORES_BY_TYPE = {"pon": 12, "mstp": 12, "otn": 24, "ethernet": 12, "darkfiber": 12}


# ============================================================
# 基础函数
# ============================================================
def _load_prices() -> Dict[str, Any]:
    """加载单价表（config 优先，失败回退内置默认）。"""
    if PRICE_FILE.exists():
        try:
            with open(PRICE_FILE, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "construction_per_km" in data:
                return data
        except Exception:
            pass
    return DEFAULT_PRICES


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """球面大圆距离（km）。"""
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(min(1.0, a)))


def _f(v) -> Optional[float]:
    """容错解析数字。"""
    try:
        x = float(str(v).strip())
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _ceil_to(v: float, step: float = 0.1) -> float:
    """向上取整到步长（防浮点噪声）。"""
    return round(math.ceil(v / step - 1e-9) * step, 3)


def _module_for_bw(bw: int) -> Tuple[str, str]:
    """按带宽选光模块（key, 显示名）。"""
    if bw <= 1250:
        return "光模块_GE", "光模块（GE，单模）"
    if bw <= 10500:
        return "光模块_10GE", "光模块（10GE，单模）"
    if bw <= 42000:
        return "光模块_40GE", "光模块（40GE，单模）"
    return "光模块_100GE", "光模块（100GE，单模）"


def _row(name: str, spec: str, unit: str, qty, price) -> Dict[str, Any]:
    """材料/设备行。"""
    return {"名称": name, "规格": spec, "单位": unit, "数量": qty,
            "单价": price, "小计": round(qty * price)}


# ============================================================
# 输入模型
# ============================================================
class DedLineInput(BaseModel):
    """政企专线设计输入。"""
    customer_name: str = Field(..., description="客户名称", min_length=1, max_length=100)
    customer_addr: str = Field(default="", description="客户地址", max_length=200)
    customer_lon: str = Field(default="", description="客户经度（十进制度，如 112.32364）", max_length=20)
    customer_lat: str = Field(default="", description="客户纬度（十进制度，如 34.68807）", max_length=20)
    access_station: str = Field(..., description="接入局站名称", min_length=1, max_length=100)
    access_addr: str = Field(default="", description="接入局站地址", max_length=200)
    access_lon: str = Field(default="", description="接入局站经度", max_length=20)
    access_lat: str = Field(default="", description="接入局站纬度", max_length=20)
    line_type: str = Field(
        default="ethernet",
        description="专线类型：pon（PON专线）/mstp（数字电路）/otn（波分专线）/"
                    "ethernet（以太网点到点）/darkfiber（裸光纤租用）",
        pattern="^(pon|mstp|otn|ethernet|darkfiber)$",
    )
    bandwidth_mbps: int = Field(default=100, description="接入带宽（Mbps）", ge=2, le=400000)
    route_type: str = Field(default="管道", description="敷设方式：管道/架空/直埋", pattern="^(管道|架空|直埋)$")
    protection: bool = Field(default=False, description="是否双路由保护（第二路由按主路由 80% 估算）")
    distance_km: Optional[float] = Field(default=None, description="直线距离覆盖值（km），仍按绕曲系数计算路由", ge=0.05, le=500)
    route_length_km: Optional[float] = Field(default=None, description="路由长度覆盖值（km，实测/规划，直接采用）", ge=0.05, le=500)
    redundancy_ratio: float = Field(default=1.35, description="绕曲系数（默认 1.35）", ge=1.0, le=2.0)
    cable_cores: Optional[int] = Field(default=None, description="光缆芯数覆盖（默认按专线类型自动）", ge=4, le=144)
    estimate_mode: str = Field(
        default="simplified",
        description="投资估算口径：simplified=简化参考口径（默认）；std451=451 表二结构口径"
        "（人工费=敷设工日×技工单价，按真实费率计措施费/规费/企管费/利润/税金；"
        "需先在 config/dedline_prices.json 填入 lay_workdays_per_km 定额工日）",
        pattern="^(simplified|std451)$",
    )
    operator: Optional[str] = Field(
        default=None,
        description="运营商：mobile=移动（按站定额：勘察4250元/站、环评450.5元/站等）"
        "/unicom=联通（按中标折扣：监理2%、安全生产费2%、人工成本资本化1%等）。"
        "提供时按 config table5_rules 计算表五（工程建设其他费用）并计入总投资；"
        "留空则不计表五（兼容旧口径）",
        pattern="^(mobile|unicom)$",
    )
    station_count: int = Field(
        default=1,
        description="站数（表五按站定额费用的基数，如移动勘察费 4250 元/站 × 站数）",
        ge=1, le=10000,
    )
    output_docx: str = Field(default="", description="《政企专线建设方案》输出路径（.docx，留空不生成）")
    output_dxf: str = Field(default="", description="路由示意图输出路径（.dxf，留空不生成）")
    output_xlsx: str = Field(default="", description="投资估算表输出路径（.xlsx，三表：汇总/材料/设备，留空不生成）")
    citations: List[CitationInfo] = Field(
        default_factory=list,
        description="编制依据（可用 search_telecom_std 的集客专业检索结果）",
    )


# ============================================================
# 主计算
# ============================================================
def design_dedicated_line(params: DedLineInput) -> str:
    """政企专线方案主入口：路由 → 选型 → 材料/投资 → 文档与图纸。"""
    prices = _load_prices()
    mat_p = prices.get("materials", DEFAULT_PRICES["materials"])
    dev_p = prices.get("devices", DEFAULT_PRICES["devices"])
    rates = prices.get("rates", DEFAULT_PRICES["rates"])

    # ---------- 1. 路由距离 ----------
    missing = []
    lon_c, lat_c = _f(params.customer_lon), _f(params.customer_lat)
    lon_a, lat_a = _f(params.access_lon), _f(params.access_lat)
    if params.customer_lon and lon_c is None:
        missing.append("客户经度")
    if params.customer_lat and lat_c is None:
        missing.append("客户纬度")
    if params.access_lon and lon_a is None:
        missing.append("局站经度")
    if params.access_lat and lat_a is None:
        missing.append("局站纬度")
    if missing:
        return json.dumps({
            "ok": False,
            "error": "坐标格式无法解析：" + "、".join(missing) + "（应为十进制度，如 112.32364）",
        }, ensure_ascii=False)

    straight_km = None
    if None not in (lon_c, lat_c, lon_a, lat_a):
        straight_km = round(haversine_km(lon_c, lat_c, lon_a, lat_a), 3)
    elif params.distance_km is not None:
        straight_km = round(params.distance_km, 3)

    if params.route_length_km is not None:
        route_km = round(params.route_length_km, 3)
        if straight_km is None:
            straight_km = round(route_km / params.redundancy_ratio, 3)
    elif straight_km is not None:
        route_km = round(straight_km * params.redundancy_ratio, 3)
    else:
        return json.dumps({
            "ok": False,
            "error": "无法计算路由距离：请提供客户与接入局站的经纬度（成对），或 distance_km / route_length_km 覆盖值。",
            "hint": "示例：customer_lon='112.32364', customer_lat='34.68807', "
                    "access_lon='112.33731', access_lat='34.66903'",
        }, ensure_ascii=False)

    route2_km = round(route_km * 0.8, 3) if params.protection else 0.0
    cons_len_km = round(route_km + route2_km, 3)

    # ---------- 2. 光缆与设备选型 ----------
    cores = params.cable_cores or CORES_BY_TYPE.get(params.line_type, 12)
    if (params.line_type == "ethernet" and params.cable_cores is None
            and params.bandwidth_mbps > 1250):
        cores = 24
    table = prices.get(
        "cable_direct_buried_per_km" if params.route_type == "直埋" else "cable_material_per_km",
        {},
    )
    cable_price = table.get(str(cores), table.get("12", 2600))
    cable_model = ("GYTA53-" if params.route_type == "直埋" else "GYTA-") + f"{cores}B1"
    bw_disp = (f"{params.bandwidth_mbps / 1000:g} Gbps" if params.bandwidth_mbps >= 1000
               else f"{params.bandwidth_mbps} Mbps")

    # ---------- 3. 材料清单 ----------
    rows_m: List[Dict[str, Any]] = []
    rows_m.append(_row("光缆", cable_model, "km", _ceil_to(route_km * 1.03), cable_price))
    if route2_km:
        rows_m.append(_row("光缆（第二路由）", cable_model, "km", _ceil_to(route2_km * 1.03), cable_price))
    n_box = max(0, math.ceil(route_km / 2) - 1) + (max(0, math.ceil(route2_km / 2) - 1) if route2_km else 0)
    if n_box:
        # 接头盒按芯数取校准价（无对应档位时 fallback 到通用校准值）
        box_price = mat_p.get(f"接头盒_{cores}芯", mat_p["接头盒"])
        rows_m.append(_row("光缆接头盒", "帽式", "个", n_box, box_price))
    odf_key = "ODF_144芯" if cores > 24 else "ODF_24芯"
    odf_spec = "144 芯壁挂式" if cores > 24 else "24 芯壁挂式"
    rows_m.append(_row("ODF 光纤配线架", odf_spec, "套", 2, mat_p[odf_key]))
    rows_m.append(_row("尾纤", "单模 LC/UPC 1.5m", "条", 4, mat_p["尾纤"]))
    rows_m.append(_row("光纤跳线", "单模 LC-LC 2m", "条", 2, mat_p["光纤跳线"]))
    if params.route_type == "管道":
        rows_m.append(_row("子管", "3 孔（硅芯管）", "km", _ceil_to(cons_len_km), mat_p["子管3孔"]))
    elif params.route_type == "架空":
        poles = math.ceil(cons_len_km * 20)
        rows_m.append(_row("水泥电杆", "8m 预应力", "根", poles, mat_p["电杆"]))
        rows_m.append(_row("吊线", "7/2.2 镀锌钢绞线", "km", _ceil_to(cons_len_km * 1.05), mat_p["吊线"]))

    # ---------- 4. 设备清单 ----------
    rows_d: List[Dict[str, Any]] = []
    if params.line_type != "darkfiber":
        key, label = _module_for_bw(params.bandwidth_mbps)
        rows_d.append(_row(label, "单模 双纤 LC", "个", 2, dev_p[key]))
    if params.line_type == "pon":
        rows_d.append(_row("ONU（企业级）", "4×GE + 2×POTS", "台", 1, dev_p["ONU企业级"]))
        rows_d.append(_row("分光器", "1:8 PLC 盒式", "个", 1, dev_p["分光器1:8"]))
    elif params.line_type == "mstp":
        rows_d.append(_row("协议转换器", "E1/以太网 ↔ STM-N", "台", 1, dev_p["协议转换器"]))
    elif params.line_type == "otn":
        rows_d.append(_row("OTU 客户侧板卡", "10GE/100GE 可配置", "块", 1, dev_p["OTU客户侧板卡"]))

    # ---------- 5. 投资估算 ----------
    mat_total = sum(r["小计"] for r in rows_m)
    dev_total = sum(r["小计"] for r in rows_d)
    cons_price = prices.get("construction_per_km", {}).get(params.route_type, 4500)
    construction = round(cons_len_km * cons_price)

    detail_451: Optional[List[Dict[str, Any]]] = None
    vat_451: Optional[int] = None
    estimate_mode_used = params.estimate_mode
    if params.estimate_mode == "std451":
        workdays_map = prices.get("lay_workdays_per_km", {})
        wd = workdays_map.get(params.route_type) if isinstance(workdays_map, dict) else None
        if not wd:
            return json.dumps({
                "ok": False,
                "error": "451 口径估算需要定额工日：请先在 config/dedline_prices.json 的 "
                         "lay_workdays_per_km 中填入「" + params.route_type + "」敷设的技工工日/km"
                         "（451 线路定额 TMS1 系列，勿估；填入后无需改代码即自动启用）。",
            }, ensure_ascii=False)
        labor_price = float(prices.get("labor_rates_per_day", {}).get("技工", 114.0))
        rr = prices.get("rates_451", {})
        labor = round(cons_len_km * wd * labor_price)          # 人工费（敷设）
        aux_mat = round(mat_total * rr.get("辅助材料费率", 0.03))   # 辅助材料费
        measure = round(labor * rr.get("措施费率_人工费基数", 0.229))  # 措施费
        welfare = round(labor * (rr.get("社会保障费率", 0.285) + rr.get("住房公积金费率", 0.0419)
                         + rr.get("危险作业意外伤害保险费率", 0.01)))   # 规费
        mgmt = round(labor * rr.get("企业管理费率", 0.274))        # 企业管理费
        profit = round(labor * rr.get("利润率", 0.20))             # 利润
        pre_tax = mat_total + aux_mat + dev_total + labor + measure + welfare + mgmt + profit
        vat = round(pre_tax * rr.get("销项税率", 0.09))            # 销项税额
        construction = labor + measure
        mat_total = mat_total + aux_mat
        subtotal = pre_tax
        vat_451 = vat
        design_fee = round(subtotal * rates.get("设计费率", 0.04))
        contingency = round(subtotal * rates.get("不可预见费率", 0.03))
        total = subtotal + vat + design_fee + contingency   # 建安费（含税）+ 其他费
        detail_451 = [
            {"项目": "人工费（光缆敷设）", "算法": f"{cons_len_km}km × {wd}工日/km × {labor_price}元", "金额（元）": labor},
            {"项目": "主要材料费", "算法": "Σ材料（表四口径）", "金额（元）": round(mat_total - aux_mat)},
            {"项目": "辅助材料费", "算法": "主要材料×3%", "金额（元）": aux_mat},
            {"项目": "设备费", "算法": "Σ设备", "金额（元）": dev_total},
            {"项目": "措施费", "算法": "人工费×22.9%（真实预算反推）", "金额（元）": measure},
            {"项目": "规费", "算法": "人工费×33.69%（社保28.5+公积金4.19+危险保险1.0）", "金额（元）": welfare},
            {"项目": "企业管理费", "算法": "人工费×27.4%", "金额（元）": mgmt},
            {"项目": "利润", "算法": "人工费×20%", "金额（元）": profit},
            {"项目": "销项税额", "算法": "税前合计×9%", "金额（元）": vat},
        ]
    else:
        subtotal = mat_total + dev_total + construction
        design_fee = round(subtotal * rates.get("设计费率", 0.04))
        contingency = round(subtotal * rates.get("不可预见费率", 0.03))
        total = subtotal + design_fee + contingency

    # ---------- 5.5 表五：工程建设其他费用（按运营商规则） ----------
    table5_rows = None
    t5_extra = 0
    operator_label = None
    if params.operator:
        op_rules = (prices.get("table5_rules") or {}).get(params.operator)
        if not op_rules:
            return json.dumps({
                "ok": False,
                "error": f"config/dedline_prices.json 缺少运营商「{params.operator}」的表五规则"
                         "（table5_rules.mobile / table5_rules.unicom）",
            }, ensure_ascii=False)
        operator_label = op_rules.get("label", params.operator)
        table5_rows = []
        for it in op_rules.get("items", []):
            c = it.get("calc", "none")
            name = it.get("name", "")
            basis = it.get("basis", "")
            tax = float(it.get("tax", 0.06))
            ex = 0.0
            note = ""
            is_design = name in ("设计费", "勘察设计费") and c == "rate_of_a1"
            if is_design:
                ex = float(design_fee)          # 复用主汇总设计费，不重复计列
                note = "已含于主汇总设计费，此处仅列示不重复加总"
            elif c == "fixed_per_station":
                inc = float(it.get("value", 0)) * params.station_count
                ex = round(inc / (1 + tax), 2)
            elif c == "rate_of_a1":
                ex = round(subtotal * float(it.get("rate", 0)), 2)
            elif c == "rate_of_total":
                ex = round((subtotal + design_fee + contingency) * float(it.get("rate", 0)), 2)
            elif c == "manual":
                note = "据实/人工按招标折扣计列，本表暂列 0"
            vat_t = round(ex * tax, 2) if c in ("fixed_per_station", "rate_of_a1", "rate_of_total") and not is_design else 0.0
            t5_add = 0.0 if (is_design or c not in ("fixed_per_station", "rate_of_a1", "rate_of_total")) else round(ex + vat_t, 2)
            t5_extra = round(t5_extra + t5_add, 2)
            table5_rows.append({
                "费用名称": name,
                "计算依据及方法": basis,
                "除税价": round(ex, 2),
                "增值税": vat_t,
                "含税价": round(ex + vat_t, 2),
                "计入投资": t5_add,
                "备注": note,
            })
        t5_extra = round(t5_extra)
        total = round(total + t5_extra)

    # ---------- 6. 工期 ----------
    if params.route_type == "架空":
        days = max(3, math.ceil(cons_len_km / 1.5))
    else:
        days = max(3, math.ceil(cons_len_km))
    if params.protection:
        days += 2

    calc = {
        "route": {
            "straight_km": straight_km,
            "redundancy_ratio": params.redundancy_ratio,
            "route_km": route_km,
            "route2_km": route2_km or None,
            "route_type": params.route_type,
            "cons_len_km": cons_len_km,
        },
        "scheme": {
            "line_type": params.line_type,
            "line_type_label": LINE_TYPE_INFO[params.line_type].split("：")[0],
            "bandwidth": bw_disp,
            "cable_model": cable_model,
            "cores": cores,
            "protection": params.protection,
        },
        "materials": rows_m,
        "devices": rows_d,
        "construction": construction,
        "investment": {
            "materials": mat_total, "construction": construction, "devices": dev_total,
            "subtotal": subtotal, "design_fee": design_fee,
            "contingency": contingency,
            "table5_extra": t5_extra if params.operator else 0,
            "total": total,
        },
        "duration_days": days,
        "prices_note": prices.get("_note", ""),
        "detail_451": detail_451,
        "vat_451": vat_451,
        "operator": params.operator,
        "operator_label": operator_label,
        "detail_table5": table5_rows,
        "station_count": params.station_count if params.operator else None,
    }

    # ---------- 7. 输出文件 ----------
    files: Dict[str, Any] = {}
    calc["dxf_path"] = None
    if params.output_dxf:
        try:
            p = Path(params.output_dxf)
            if p.suffix.lower() != ".dxf":
                p = p.with_suffix(".dxf")
            p.parent.mkdir(parents=True, exist_ok=True)
            _write_route_dxf(params, calc, p)
            files["dxf"] = str(p)
            calc["dxf_path"] = str(p)
        except Exception as e:
            files["dxf_error"] = f"{type(e).__name__}: {e}"
    calc["xlsx_path"] = None
    if params.output_xlsx:
        try:
            p = Path(params.output_xlsx)
            if p.suffix.lower() != ".xlsx":
                p = p.with_suffix(".xlsx")
            p.parent.mkdir(parents=True, exist_ok=True)
            _compose_xlsx(params, calc, p)
            files["xlsx"] = str(p)
            calc["xlsx_path"] = str(p)
        except Exception as e:
            files["xlsx_error"] = f"{type(e).__name__}: {e}"
    if params.output_docx:
        try:
            p = Path(params.output_docx)
            if p.suffix.lower() != ".docx":
                p = p.with_suffix(".docx")
            p.parent.mkdir(parents=True, exist_ok=True)
            _compose_docx(params, calc, p)
            files["docx"] = str(p)
        except Exception as e:
            files["docx_error"] = f"{type(e).__name__}: {e}"

    # ---------- 8. 摘要 ----------
    inv = calc["investment"]
    r = calc["route"]
    summary = [
        f"{params.customer_name} 政企专线方案：{calc['scheme']['line_type_label']}，带宽 {bw_disp}",
        f"路由：{params.access_station} → 客户，直线 {r['straight_km']} km，"
        f"主路由 {r['route_km']} km（{r['route_type']}敷设）"
        + (f"，第二路由 {r['route2_km']} km（双路由保护）" if r["route2_km"] else ""),
        f"配置：{cable_model}（{cores} 芯）",
        f"投资估算（{estimate_mode_used} 口径）：材料 {inv['materials']:,} + 施工 {inv['construction']:,} + "
        f"设备 {inv['devices']:,} + 设计/不可预见 {design_fee + contingency:,}"
        + (f" + 表五其他费 {inv['table5_extra']:,}" if params.operator else "")
        + f" = 总投资约 {inv['total']:,} 元"
        + ("（451 表二结构，费率来自真实预算校准）" if estimate_mode_used == "std451" else "（参考单价）"),
    ]
    if params.operator and table5_rows:
        summary.append(
            f"表五其他费用（{operator_label}口径，站数 {params.station_count}）：新增计列 {inv['table5_extra']:,} 元；"
            "明细见估算表『表五-其他费用』，人工调整项（可研/审计等）已留备注")
    if files:
        summary.append("已生成：" + "、".join(
            [Path(v).name for k, v in files.items() if k in ("docx", "dxf", "xlsx")]))

    result = {
        "ok": True,
        "customer": params.customer_name,
        "access_station": params.access_station,
        "route": r,
        "scheme": calc["scheme"],
        "materials": rows_m,
        "devices": rows_d,
        "estimate_mode": estimate_mode_used,
        "detail_451": detail_451,
        "operator": params.operator,
        "operator_label": operator_label,
        "station_count": params.station_count if params.operator else None,
        "table5_extra": inv.get("table5_extra", 0),
        "detail_table5": table5_rows,
        "investment": inv,
        "duration_days": days,
        "files": files,
        "prices_note": calc["prices_note"],
        "summary": "\n".join(summary),
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


# ============================================================
# 投资估算表（Excel，三表）
# ============================================================
def _compose_xlsx(params: DedLineInput, calc: Dict[str, Any], out_path: Path) -> None:
    """生成投资估算表 Excel：估算汇总 / 材料明细 / 设备明细（表四甲·简化风格）。"""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    r, sch, inv = calc["route"], calc["scheme"], calc["investment"]

    wb = Workbook()
    thin = Side(style="thin", color="9AA4AE")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    head_fill = PatternFill("solid", fgColor="1B66C9")
    head_font = Font(name="微软雅黑", size=10.5, bold=True, color="FFFFFF")
    body_font = Font(name="微软雅黑", size=10.5)
    bold_font = Font(name="微软雅黑", size=10.5, bold=True)
    title_font = Font(name="微软雅黑", size=14, bold=True)
    note_font = Font(name="微软雅黑", size=9, color="7A8A99")
    center = Alignment(horizontal="center", vertical="center")
    right = Alignment(horizontal="right", vertical="center")
    money_fmt = "#,##0"

    # ===== Sheet1 估算汇总 =====
    ws = wb.active
    ws.title = "估算汇总"
    ws.sheet_view.showGridLines = False
    ws.merge_cells("A1:D1")
    ws["A1"] = f"{params.customer_name}政企专线工程 投资估算汇总表"
    ws["A1"].font = title_font
    ws["A1"].alignment = center
    ws.merge_cells("A2:D2")
    ws["A2"] = (f"业务类型：{sch['line_type_label']}　带宽：{sch['bandwidth']}　"
                f"主路由：{r['route_km']}km（{r['route_type']}敷设）"
                + (f"　第二路由：{r['route2_km']}km（双路由保护）" if r.get("route2_km") else "")
                + f"　接入局站：{params.access_station}")
    ws["A2"].font = note_font
    ws["A2"].alignment = center

    for col, h in enumerate(["序号", "费用科目", "金额（元）", "占比"], 1):
        c = ws.cell(row=4, column=col, value=h)
        c.font = head_font
        c.fill = head_fill
        c.border = border
        c.alignment = center

    items = [
        ("材料费", inv["materials"]),
        ("施工费", inv["construction"]),
        ("设备费", inv["devices"]),
        ("直接费小计", inv["subtotal"]),
        ("设计费", inv["design_fee"]),
        ("不可预见费", inv["contingency"]),
    ]
    if inv.get("table5_extra"):
        items.append((f"其他费用（表五·{calc.get('operator_label') or params.operator}）", inv["table5_extra"]))
    items.append(("总投资", inv["total"]))
    for i, (name, amount) in enumerate(items, 1):
        row = 4 + i
        ws.cell(row=row, column=1, value=i).alignment = center
        ws.cell(row=row, column=2, value=name)
        c = ws.cell(row=row, column=3, value=amount)
        c.number_format = money_fmt
        c.alignment = right
        pc = ws.cell(row=row, column=4, value=round(amount / inv["total"], 4))
        pc.number_format = "0.0%"
        pc.alignment = center
        for col in range(1, 5):
            cell = ws.cell(row=row, column=col)
            cell.border = border
            cell.font = bold_font if name in ("直接费小计", "总投资") else body_font
            if col == 2:
                cell.alignment = Alignment(horizontal="left", vertical="center")

    note_row = 4 + len(items) + 2
    ws.merge_cells(f"A{note_row}:D{note_row + 2}")
    ws[f"A{note_row}"] = (
        "注：1. 本表为参考单价估算，正式报审须套用 451 定额及当地工料机价格；\n"
        "2. 单价源：config/dedline_prices.json（可编辑校准，改后即生效）；\n"
        f"3. 预估工期约 {calc['duration_days']} 天。"
        + (f"表五其他费按{calc.get('operator_label') or params.operator}计费规则估算（config table5_rules），"
           "折扣类费用（可研/审计/中标折扣）需人工按合同调整；" if params.operator else "投资口径不含赔补、税费以外的其他费用。")
    )
    ws[f"A{note_row}"].font = note_font
    ws[f"A{note_row}"].alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    for col, w in zip("ABCD", (6, 16, 16, 10)):
        ws.column_dimensions[col].width = w

    # ===== 明细表（材料/设备） =====
    def detail_sheet(sheet_name: str, rows: List[Dict[str, Any]], subtitle: str) -> None:
        ws2 = wb.create_sheet(sheet_name)
        ws2.sheet_view.showGridLines = False
        ws2.merge_cells("A1:G1")
        ws2["A1"] = subtitle
        ws2["A1"].font = title_font
        ws2["A1"].alignment = center
        for col, h in enumerate(
                ["序号", "名称", "规格/型号", "单位", "数量", "单价（元）", "小计（元）"], 1):
            c = ws2.cell(row=3, column=col, value=h)
            c.font = head_font
            c.fill = head_fill
            c.border = border
            c.alignment = center
        total = 0
        for i, m in enumerate(rows, 1):
            row = 3 + i
            vals = [i, m["名称"], m["规格"], m["单位"], m["数量"], m["单价"], m["小计"]]
            for col, v in enumerate(vals, 1):
                c = ws2.cell(row=row, column=col, value=v)
                c.border = border
                c.font = body_font
                if col in (1, 4):
                    c.alignment = center
                elif col in (6, 7):
                    c.number_format = money_fmt
                    c.alignment = right
                elif col == 5:
                    c.alignment = right
            total += m["小计"]
        last = 3 + len(rows) + 1
        ws2.merge_cells(f"A{last}:E{last}")
        c = ws2.cell(row=last, column=1, value="合　计")
        c.font = bold_font
        c.alignment = center
        c2 = ws2.cell(row=last, column=6, value="—")
        c2.alignment = center
        c3 = ws2.cell(row=last, column=7, value=total)
        c3.number_format = money_fmt
        c3.alignment = right
        for col in range(1, 8):
            ws2.cell(row=last, column=col).border = border
            if ws2.cell(row=last, column=col).font is None:
                ws2.cell(row=last, column=col).font = body_font
        for col, w in zip("ABCDEFG", (6, 20, 24, 8, 10, 12, 12)):
            ws2.column_dimensions[col].width = w

    detail_sheet("材料明细", calc["materials"],
                 f"{params.customer_name}政企专线工程 材料估算明细表（表四甲·简化）")
    detail_sheet("设备明细", calc["devices"],
                 f"{params.customer_name}政企专线工程 设备估算明细表（表四甲·简化）")
    if calc.get("detail_table5"):
        ws5 = wb.create_sheet("表五-其他费用")
        ws5.sheet_view.showGridLines = False
        ws5.merge_cells("A1:G1")
        ws5["A1"] = (f"{params.customer_name}政企专线工程 工程建设其他费用预算表（表五·"
                     f"{calc.get('operator_label') or params.operator}计费规则，站数 {params.station_count}）")
        ws5["A1"].font = title_font
        ws5["A1"].alignment = center
        headers5 = ["序号", "费用名称", "计算依据及方法", "除税价", "增值税", "含税价", "备注"]
        for col, h in enumerate(headers5, 1):
            c = ws5.cell(row=3, column=col, value=h)
            c.font = head_font; c.fill = head_fill; c.border = border; c.alignment = center
        t5_total_inc = 0.0
        for i, t5 in enumerate(calc["detail_table5"], 1):
            row = 3 + i
            vals = [i, t5["费用名称"], t5["计算依据及方法"], t5["除税价"], t5["增值税"], t5["含税价"], t5["备注"]]
            for col, v in enumerate(vals, 1):
                c = ws5.cell(row=row, column=col, value=v)
                c.border = border; c.font = body_font
                if col == 1:
                    c.alignment = center
                elif col in (4, 5, 6):
                    c.number_format = "#,##0.00"; c.alignment = right
                elif col in (3, 7):
                    c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            t5_total_inc += float(t5["计入投资"])
        last5 = 3 + len(calc["detail_table5"]) + 1
        ws5.merge_cells(f"A{last5}:E{last5}")
        c = ws5.cell(row=last5, column=1, value="总计（新增计入投资，设计费已含于主汇总）")
        c.font = bold_font; c.alignment = center
        c = ws5.cell(row=last5, column=6, value=round(t5_total_inc, 2))
        c.number_format = "#,##0.00"; c.font = bold_font; c.alignment = right
        for col in range(1, 8):
            ws5.cell(row=last5, column=col).border = border
        for col, w in zip("ABCDEFG", (6, 22, 46, 12, 10, 12, 30)):
            ws5.column_dimensions[col].width = w
    if calc.get("detail_451"):
        ws451 = wb.create_sheet("451费用分解")
        ws451.sheet_view.showGridLines = False
        ws451.merge_cells("A1:C1")
        ws451["A1"] = "建筑安装工程费估算（451 表二结构口径）"
        ws451["A1"].font = title_font
        ws451["A1"].alignment = center
        for col, h in enumerate(["项目", "算法/依据", "金额（元）"], 1):
            c = ws451.cell(row=3, column=col, value=h)
            c.font = head_font; c.fill = head_fill; c.border = border; c.alignment = center
        for i, d451 in enumerate(calc["detail_451"], 1):
            vals = [i, d451["项目"], d451["算法"], d451["金额（元）"]]
            for col, v in enumerate(vals, 1):
                c = ws451.cell(row=3 + i, column=col, value=v)
                c.border = border; c.font = body_font
                if col in (1, 4):
                    c.alignment = right if col == 4 else center
                    if col == 4: c.number_format = money_fmt
        for col, w in zip("ABCD", (6, 24, 44, 14)):
            ws451.column_dimensions[col].width = w

    wb.save(str(out_path))


# ============================================================
# 方案文档（Word）
# ============================================================
def _compose_docx(params: DedLineInput, calc: Dict[str, Any], out_path: Path) -> None:
    """生成《政企专线建设方案》docx。"""
    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.left_margin = s.right_margin = Cm(2.6)
    s.top_margin = s.bottom_margin = Cm(2.8)

    r, sch, inv = calc["route"], calc["scheme"], calc["investment"]

    # 封面
    _add_heading_cn(doc, params.customer_name, 0)
    _add_heading_cn(doc, "政企专线建设方案", 0)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(
        f"\n业务类型：{sch['line_type_label']}\n接入带宽：{sch['bandwidth']}\n"
        f"接入局站：{params.access_station}\n设计单位：中国电信\n"
        f"编制日期：{date.today().isoformat()}"
    )
    _set_cn_font(run, name="仿宋", size=14)
    doc.add_page_break()

    # 一、需求概况
    _add_heading_cn(doc, "一、需求概况", 1)
    _add_body(doc, f"客户名称：{params.customer_name}"
             + (f"（{params.customer_addr}）" if params.customer_addr else "") + "。")
    _add_body(doc, f"本期建设 {sch['line_type_label']}，接入带宽 {sch['bandwidth']}，"
             + ("采用双路由保护。" if params.protection else "采用单路由接入。"))
    _add_body(doc, f"接入局站：{params.access_station}"
             + (f"（{params.access_addr}）" if params.access_addr else "")
             + "，客户端至局站侧按本期新建接入光缆考虑。")
    _add_body(doc, LINE_TYPE_INFO[params.line_type] + "。")

    # 二、路由方案
    _add_heading_cn(doc, "二、路由方案", 1)
    _add_body(doc, f"客户端至接入局站直线距离约 {r['straight_km']} km，按绕曲系数 "
             f"{r['redundancy_ratio']} 计算，主路由长度约 {r['route_km']} km，"
             f"采用{r['route_type']}方式敷设。")
    if r.get("route2_km"):
        _add_body(doc, f"本期采用双路由保护，第二路由长度约 {r['route2_km']} km，"
                 "两条路由物理分离、互为备份。")
    else:
        _add_body(doc, "本期为单路由接入；如客户对可用性要求较高，"
                 "可二期增设第二路由实现双路由保护。")

    # 三、技术方案
    _add_heading_cn(doc, "三、技术方案", 1)
    _add_body(doc, f"接入光缆选用 {sch['cable_model']}（{sch['cores']} 芯），"
             f"主路由敷设长度约 {_ceil_to(r['route_km'] * 1.03)} km（含 3% 盘留余量）。")
    if calc["devices"]:
        _add_body(doc, "设备配置如下：")
        for d in calc["devices"]:
            _add_body(doc, f"· {d['名称']}（{d['规格']}）× {d['数量']}{d['单位']}", indent=False)
    else:
        _add_body(doc, "裸光纤租用模式：两端不配置光模块与客户端设备，客户自备传输设备。")
    _add_body(doc, "局站侧利用现有 ODF 机架成端；客户端设备安装于客户机房壁挂机柜/机架。")

    # 四、投资估算
    _add_heading_cn(doc, "四、投资估算", 1)
    _add_body(doc, "主要材料与设备清单：", indent=False)
    rows = [[m["名称"], m["规格"], m["单位"], f"{m['数量']:g}",
             f"{m['单价']:,}", f"{m['小计']:,}"] for m in calc["materials"]]
    rows += [[d["名称"], d["规格"], d["单位"], f"{d['数量']:g}",
              f"{d['单价']:,}", f"{d['小计']:,}"] for d in calc["devices"]]
    _add_body(doc, "主要材料与设备清单：", indent=False)
    _add_table(doc, ["名称", "规格/型号", "单位", "数量", "单价(元)", "小计(元)"], rows)
    if calc.get("detail_451"):
        _add_body(doc, "按 451 表二结构分解（费率经真实预算校准）：", indent=False)
        _add_table(doc, ["项目", "算法/依据", "金额(元)"],
                   [[d451["项目"], d451["算法"], f"{d451['金额（元）']:,}"] for d451 in calc["detail_451"]])
    _add_body(doc, f"施工费（{r['route_type']}敷设，合计 {r['cons_len_km']} km）："
             f"{inv['construction']:,} 元。")
    _add_table(doc, ["费用项目", "金额(元)"], [
        ["材料费", f"{inv['materials']:,}"],
        ["施工费", f"{inv['construction']:,}"],
        ["设备费", f"{inv['devices']:,}"],
        ["小计", f"{inv['subtotal']:,}"],
        ["设计费", f"{inv['design_fee']:,}"],
        ["不可预见费", f"{inv['contingency']:,}"],
    ] + ([[f"其他费用（表五·{calc.get('operator_label')}）", f"{inv['table5_extra']:,}"]]
         if inv.get("table5_extra") else [])
      + [["总投资（元）", f"{inv['total']:,}"]])
    if calc.get("detail_table5"):
        _add_body(doc, f"工程建设其他费用（表五，按{calc.get('operator_label')}计费规则，"
                  f"站数 {params.station_count}）：", indent=False)
        _add_table(doc, ["序号", "费用名称", "计算依据及方法", "含税价(元)", "计入投资(元)"],
                   [[i, t5["费用名称"], t5["计算依据及方法"],
                     f"{t5['含税价']:,.2f}", (f"{t5['计入投资']:,.2f}" if t5["计入投资"] else "—")]
                    for i, t5 in enumerate(calc["detail_table5"], 1)])
        _add_body(doc, "注：折扣类费用（可研费/审计费/中标折扣等）按规则备注人工调整；"
                  "正式报审以合同及招标框架为准。", indent=False)
    _add_body(doc, "注：" + calc.get("prices_note", "")
             + f" 预估工期约 {calc['duration_days']} 天。")
    if calc.get("xlsx_path"):
        _add_body(doc, "投资估算明细表（Excel：估算汇总/材料明细/设备明细）另附："
                 + calc["xlsx_path"])

    # 五、实施要点
    _add_heading_cn(doc, "五、实施要点", 1)
    for i, t in enumerate([
        "管孔/杆路资源核查：敷设前核查沿途管孔占用与杆路情况（本期未接入资源系统，需人工确认）。",
        "光缆敷设与成端：按设计路由敷设，两端 ODF 成端并做好标识，接头盒位置现场确定。",
        "测试验收：竣工后进行 OTDR 双向测试与插损测试，指标满足工程验收规范要求。",
        "业务开通：安装客户端设备并与局站侧联调，光模块协商正常后交付客户试用。",
        "资料归档：竣工资料（路由图、测试记录、材料清单）随验收移交。",
    ], 1):
        _add_body(doc, f"{i}. {t}")

    # 六、编制依据
    if params.citations:
        _add_heading_cn(doc, "六、编制依据", 1)
        for i, c in enumerate(params.citations, 1):
            line = f"{i}. 《{c.title or '（标准）'}》{c.code}"
            if c.number:
                line += f" 第 {c.number} 条"
            _add_body(doc, line)
        _add_body(doc, f"{len(params.citations) + 1}. 工程现场勘察资料及建设单位提供的相关技术资料。")

    # 七、图纸
    if calc.get("dxf_path"):
        _add_heading_cn(doc, "七、图纸", 1)
        _add_body(doc, f"路由示意图：{calc['dxf_path']}（DXF，R12 兼容，示意不按比例）。")

    doc.save(str(out_path))


# ============================================================
# 路由示意图（最小 DXF 写出器）
# ============================================================
class _MiniDxf:
    """极简 R12 DXF 写出器（LINE/LWPOLYLINE/TEXT + LAYER/STYLE 表）。"""

    LAYERS = [("图框", 7), ("路由", 5), ("站点", 4), ("标注", 2), ("文字", 7)]

    def __init__(self) -> None:
        self.parts: List[str] = []

    @staticmethod
    def _r(v) -> str:
        return f"{float(v):g}"

    def line(self, x1, y1, x2, y2, layer="路由") -> None:
        self.parts.append(
            "0\nLINE\n8\n%s\n10\n%s\n20\n%s\n30\n0\n11\n%s\n21\n%s\n31\n0\n"
            % (layer, self._r(x1), self._r(y1), self._r(x2), self._r(y2))
        )

    def poly(self, pts, layer="路由", closed=False) -> None:
        s = "0\nLWPOLYLINE\n8\n%s\n90\n%d\n70\n%d\n" % (layer, len(pts), 1 if closed else 0)
        for p in pts:
            s += "10\n%s\n20\n%s\n" % (self._r(p[0]), self._r(p[1]))
        self.parts.append(s)

    def rect(self, x, y, w, h, layer="图框") -> None:
        self.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], layer, True)

    def text(self, x, y, s, h=3.5, layer="文字") -> None:
        s = str(s).replace("\r", " ").replace("\n", " ")
        self.parts.append(
            "0\nTEXT\n8\n%s\n10\n%s\n20\n%s\n30\n0\n40\n%s\n1\n%s\n"
            % (layer, self._r(x), self._r(y), self._r(h), s)
        )

    def build(self) -> str:
        out = [
            "0", "SECTION", "2", "HEADER",
            "9", "$ACADVER", "1", "AC1009",
            "9", "$INSUNITS", "70", "4",
            "0", "ENDSEC",
            "0", "SECTION", "2", "TABLES",
            "0", "TABLE", "2", "LAYER", "70", str(len(self.LAYERS)),
        ]
        for name, aci in self.LAYERS:
            out += ["0", "LAYER", "2", name, "70", "0", "62", str(aci), "6", "CONTINUOUS"]
        out += [
            "0", "ENDTAB",
            "0", "TABLE", "2", "STYLE", "70", "1",
            "0", "STYLE", "2", "Standard", "70", "0", "40", "0", "41", "1.0",
            "50", "0", "71", "0", "42", "0.2", "3", "SimHei", "4", "",
            "0", "ENDTAB",
            "0", "ENDSEC",
            "0", "SECTION", "2", "ENTITIES",
            "".join(self.parts),
            "0", "ENDSEC",
            "0", "EOF",
        ]
        return "\n".join(out)


def _write_route_dxf(params: DedLineInput, calc: Dict[str, Any], out_path: Path) -> None:
    """生成专线路由示意图 DXF（A3 横放示意，不按比例）。"""
    d = _MiniDxf()
    r, sch, inv = calc["route"], calc["scheme"], calc["investment"]

    d.rect(10, 10, 400, 277)   # A3 横放外框
    d.rect(16, 16, 388, 265)   # 内框

    # 标题
    d.text(105, 262, "政企专线接入路由示意图", 7)
    d.text(150, 252, "（示意 · 不按比例 · 单位 mm）", 3.5, "标注")

    # 关键信息（左上）
    info = [
        f"客户：{params.customer_name}",
        f"局站：{params.access_station}",
        f"业务：{sch['line_type_label']}  {sch['bandwidth']}",
        f"直线距离：{r['straight_km']} km    绕曲系数：{r['redundancy_ratio']}",
        f"主路由：{r['route_km']} km（{r['route_type']}敷设）",
        f"光缆：{sch['cable_model']}（{sch['cores']} 芯）",
        f"预估总投资：{inv['total']:,} 元    工期：约 {calc['duration_days']} 天",
    ]
    for i, t in enumerate(info):
        d.text(25, 242 - i * 8, t, 3.8)

    # 局站（左）
    d.rect(45, 150, 70, 40, "站点")
    d.text(52, 178, "接入局站", 5)
    d.text(52, 168, params.access_station[:12], 4)
    d.text(52, 158, "（机房 / ODF）", 3.2)

    # 客户（右）
    d.rect(275, 150, 70, 40, "站点")
    d.text(282, 178, "客户端", 5)
    d.text(282, 168, params.customer_name[:12], 4)
    d.text(282, 158, "（客户端设备）", 3.2)

    # 主路由
    d.line(115, 170, 275, 170, "路由")
    d.text(140, 176, f"主路由 ≈ {r['route_km']} km · {r['route_type']}敷设", 4, "标注")
    d.text(140, 160, f"光缆 {sch['cable_model']} · {sch['cores']} 芯", 3.5, "标注")

    # 第二路由
    if r.get("route2_km"):
        d.poly([(115, 152), (165, 122), (225, 122), (275, 152)], "路由")
        d.text(140, 128, f"第二路由 ≈ {r['route2_km']} km（双路由保护）", 4, "标注")

    # 标题栏（右下）
    d.rect(240, 20, 164, 40, "图框")
    d.line(240, 40, 404, 40, "图框")
    d.line(330, 20, 330, 60, "图框")
    d.text(246, 52, "客户：" + params.customer_name[:10], 3.5)
    d.text(246, 42, "图号：ZXLT-0001", 3.5)
    d.text(246, 28, f"日期：{date.today().isoformat()}", 3.5)
    d.text(336, 52, "比例：示意", 3.5)
    d.text(336, 42, "单位：mm", 3.5)
    d.text(336, 28, "制图：电信智能体", 3.5)

    # 说明（左下）
    notes = [
        "说明：",
        "1. 本图为接入路由示意，实际以现场勘察为准；",
        "2. 投资为参考单价估算，正式报审须套用 451 定额；",
        "3. 局站侧资源（端口/管孔）需人工核查确认。",
    ]
    for i, t in enumerate(notes):
        d.text(25, 52 - i * 7, t, 3.2, "标注")

    out_path.write_text(d.build(), encoding="utf-8")
