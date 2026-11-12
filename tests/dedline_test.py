# -*- coding: utf-8 -*-
"""政企专线设计模块单元测试（课题10 方案3）"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.dedicated_line import (
    DedLineInput,
    _load_prices,
    design_dedicated_line,
    haversine_km,
)

passed = []


def check(name, cond, detail=""):
    passed.append(cond)
    print(f"{'✓' if cond else '✗'} {name}{' - ' + detail if detail and not cond else ''}")


print("=" * 60)
print("测试 1：基础函数")
print("=" * 60)
# 洛阳两真实站坐标（设计院图纸数据）
d = haversine_km(112.32364, 34.68807, 112.33731, 34.66903)
check("haversine 距离合理（1.5-3 km）", 1.5 < d < 3.0, f"{d:.3f}")
p = _load_prices()
check("单价表加载", "construction_per_km" in p and "管道" in p["construction_per_km"])

print()
print("=" * 60)
print("测试 2：输入校验")
print("=" * 60)
r = json.loads(design_dedicated_line(DedLineInput(customer_name="甲客户", access_station="乙局站")))
check("缺坐标且无覆盖 → 报错", r.get("ok") is False and "路由距离" in r.get("error", ""))

r_bad = json.loads(design_dedicated_line(DedLineInput(
    customer_name="甲", customer_lon="abc", customer_lat="34.68807",
    access_station="乙", access_lon="112.33", access_lat="34.66")))
check("坐标格式错误 → 报错", r_bad.get("ok") is False and "客户经度" in r_bad.get("error", ""))

print()
print("=" * 60)
print("测试 3：PON 专线 300M 管道（真实坐标）")
print("=" * 60)
r = json.loads(design_dedicated_line(DedLineInput(
    customer_name="示范客户A", customer_addr="洛阳市涧西区中州西路",
    customer_lon="112.32364", customer_lat="34.68807",
    access_station="广文路通信站", access_addr="洛阳市涧西区广文路",
    access_lon="112.33731", access_lat="34.66903",
    line_type="pon", bandwidth_mbps=300, route_type="管道")))
check("方案生成成功", r.get("ok") is True, str(r.get("error", "")))
check("路由长度 = 直线 × 1.35",
      abs(r["route"]["route_km"] - round(r["route"]["straight_km"] * 1.35, 3)) < 0.002)
check("材料清单 ≥ 6 行", len(r.get("materials", [])) >= 6, f"{len(r.get('materials', []))}")
check("PON 含 ONU 与分光器",
      any("ONU" in x["名称"] for x in r["devices"])
      and any("分光器" in x["名称"] for x in r["devices"]))
check("300M → GE 光模块 × 2", any("GE" in x["名称"] for x in r["devices"])
      and sum(x["数量"] for x in r["devices"] if "光模块" in x["名称"]) == 2)
check("管道 → 含子管", any("子管" in x["名称"] for x in r["materials"]))
check("总投资 > 1 万元", r["investment"]["total"] > 10000, f"{r['investment']['total']}")
check("含摘要与单价说明", "summary" in r and "451" in r.get("prices_note", ""))

print()
print("=" * 60)
print("测试 4：10G 以太网 + 架空 + 双路由（产出文档/图纸/估算表）")
print("=" * 60)
out_dir = Path(__file__).resolve().parent / "mcp-out"
r2 = json.loads(design_dedicated_line(DedLineInput(
    customer_name="示范客户B", customer_lon="112.32364", customer_lat="34.68807",
    access_station="广文路通信站", access_lon="112.33731", access_lat="34.66903",
    line_type="ethernet", bandwidth_mbps=10000, route_type="架空", protection=True,
    output_docx=str(out_dir / "专线方案-示范客户B.docx"),
    output_dxf=str(out_dir / "专线路由-示范客户B.dxf"),
    output_xlsx=str(out_dir / "专线估算表-示范客户B.xlsx"))))
check("双路由方案生成", r2.get("ok") is True and r2["route"]["route2_km"] is not None)
check("第二路由 = 主路由 × 0.8",
      abs(r2["route"]["route2_km"] - round(r2["route"]["route_km"] * 0.8, 3)) < 0.002)
check("10G 以太网 → 24 芯", r2["scheme"]["cores"] == 24)
check("10G → 10GE 光模块", any("10GE" in x["名称"] for x in r2["devices"]))
check("架空 → 含电杆与吊线",
      any("电杆" in x["名称"] for x in r2["materials"])
      and any("吊线" in x["名称"] for x in r2["materials"]))
docx_path = r2.get("files", {}).get("docx")
dxf_path = r2.get("files", {}).get("dxf")
check("docx 已生成", bool(docx_path) and Path(docx_path).exists())
check("dxf 已生成", bool(dxf_path) and Path(dxf_path).exists())
if docx_path and Path(docx_path).exists():
    check("docx 非空 (>8KB)", Path(docx_path).stat().st_size > 8192)
if dxf_path and Path(dxf_path).exists():
    txt = Path(dxf_path).read_text(encoding="utf-8")
    check("dxf R12 头 + EOF", "AC1009" in txt and txt.rstrip().endswith("EOF"))
    check("dxf 含路由与站点图层", "8\n路由" in txt and "8\n站点" in txt)
xlsx_path = r2.get("files", {}).get("xlsx")
check("xlsx 已生成", bool(xlsx_path) and Path(xlsx_path).exists())
if xlsx_path and Path(xlsx_path).exists():
    from openpyxl import load_workbook
    wb = load_workbook(str(xlsx_path))
    check("xlsx 含三张表", set(wb.sheetnames) == {"估算汇总", "材料明细", "设备明细"},
          str(wb.sheetnames))
    ws = wb["估算汇总"]
    # 总投资行：序号7 → 第11行，金额在 C 列
    total_row = None
    for row in ws.iter_rows(min_row=5, max_col=4):
        if row[1].value == "总投资":
            total_row = row
            break
    check("汇总表含总投资行", total_row is not None)
    if total_row is not None:
        check("xlsx 总投资与 JSON 一致", total_row[2].value == r2["investment"]["total"],
              f"xlsx={total_row[2].value} json={r2['investment']['total']}")
    ws_m = wb["材料明细"]
    mat_total = None
    for row in ws_m.iter_rows(min_row=4, max_col=7):
        if row[0].value == "合　计":
            mat_total = row[6].value
            break
    check("材料表合计与 JSON 一致", mat_total == r2["investment"]["materials"],
          f"xlsx={mat_total} json={r2['investment']['materials']}")

print()
print("=" * 60)
print("测试 5：裸光纤 + 距离覆盖")
print("=" * 60)
r3 = json.loads(design_dedicated_line(DedLineInput(
    customer_name="示范客户C", access_station="某局站",
    distance_km=3.2, line_type="darkfiber", bandwidth_mbps=10000)))
check("裸光纤无光模块/设备", r3.get("ok") is True and not r3["devices"])
check("distance_km 覆盖直线距离", abs(r3["route"]["straight_km"] - 3.2) < 0.01)
check("路由长度仍按绕曲系数计算", abs(r3["route"]["route_km"] - round(3.2 * 1.35, 3)) < 0.002)

print()
print("=" * 60)
print("测试 6：MSTP / OTN 设备选型")
print("=" * 60)
r4 = json.loads(design_dedicated_line(DedLineInput(
    customer_name="D", access_station="S", distance_km=2,
    line_type="mstp", bandwidth_mbps=155)))
check("MSTP → 协议转换器", any("协议转换器" in x["名称"] for x in r4["devices"]))
r5 = json.loads(design_dedicated_line(DedLineInput(
    customer_name="E", access_station="S", route_length_km=5,
    line_type="otn", bandwidth_mbps=10000)))
check("OTN → OTU 板卡 + 24 芯", any("OTU" in x["名称"] for x in r5["devices"])
      and r5["scheme"]["cores"] == 24)
check("route_length_km 直接采用", abs(r5["route"]["route_km"] - 5) < 0.01)

print()
print("=" * 60)
total = len(passed)
passed_n = sum(1 for c in passed if c)
print(f"结果：{passed_n}/{total} 通过")
print("=" * 60)
sys.exit(0 if passed_n == total else 1)
