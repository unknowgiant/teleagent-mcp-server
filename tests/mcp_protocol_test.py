# -*- coding: utf-8 -*-
"""MCP stdio 协议层测试：初始化握手 → 工具列举 → 实际调用三个工具"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = str(ROOT / ".venv" / "Scripts" / "python.exe")
SERVER = str(ROOT / "server.py")

proc = subprocess.Popen(
    [PY, SERVER],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    encoding="utf-8",
)
_msg_id = 0


def send(method, params=None):
    global _msg_id
    _msg_id += 1
    msg = {"jsonrpc": "2.0", "id": _msg_id, "method": method}
    if params is not None:
        msg["params"] = params
    proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
    proc.stdin.flush()
    return _msg_id


def read_until_id(want_id, timeout_reads=200):
    for _ in range(timeout_reads):
        line = proc.stdout.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("id") == want_id:
            return obj
    return None


passed = []


def check(name, cond, detail=""):
    passed.append(cond)
    print(f"{'✓' if cond else '✗'} {name}{' - ' + detail if detail and not cond else ''}")


try:
    # 1. initialize 握手
    rid = send("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "e2e-test", "version": "1.0"},
    })
    resp = read_until_id(rid)
    check("initialize 握手", resp is not None and "result" in resp,
          str(resp.get("error") if resp else "no response"))
    if resp and "result" in resp:
        check("服务器名称 telecom_agent_mcp",
              resp["result"].get("serverInfo", {}).get("name") == "telecom_agent_mcp")

    # initialized 通知
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
    proc.stdin.flush()

    # 2. 工具列举
    rid = send("tools/list")
    resp = read_until_id(rid)
    tools = resp["result"]["tools"] if resp and "result" in resp else []
    names = [t["name"] for t in tools]
    print(f"  注册工具: {names}")
    check("工具数量 = 6", len(tools) == 6, f"实际 {len(tools)}")
    for expect in ["search_telecom_std", "list_telecom_std",
                   "generate_station_dxf", "compose_design_doc",
                   "telecom_suite_status", "design_dedicated_line"]:
        check(f"工具已注册: {expect}", expect in names)

    # 3. 调用 telecom_suite_status（自检，无参数）
    rid = send("tools/call", {"name": "telecom_suite_status", "arguments": {}})
    resp = read_until_id(rid)
    ok = False
    if resp and "result" in resp:
        content = resp["result"].get("content", [])
        if content and content[0].get("type") == "text":
            data = json.loads(content[0]["text"])
            ok = data.get("ok") is True
            print(f"  自检: ok={data.get('ok')} checks={list(data.get('checks', {}).keys())}")
    check("suite_status 自检通过", ok)

    # 4. 调用 search_telecom_std（检索）—— 单模型参数需 params 包装
    rid = send("tools/call", {"name": "search_telecom_std", "arguments": {
        "params": {"query": "抗震设防", "mandatory_only": True, "limit": 5}
    }})
    resp = read_until_id(rid)
    ok, total = False, 0
    if resp and "result" in resp:
        content = resp["result"].get("content", [])
        if content and content[0].get("type") == "text":
            data = json.loads(content[0]["text"])
            total = data.get("total", 0)
            ok = total > 0 and all(x["clause_kind"] == "强条" for x in data.get("results", []))
            print(f"  检索: total={total}, 首条 {data['results'][0]['code']} {data['results'][0]['number']}")
    check("search_telecom_std 协议调用", ok)

    # 5. 调用 generate_station_dxf（出图）
    rid = send("tools/call", {"name": "generate_station_dxf", "arguments": {
        "params": {
            "excel_path": r"E:\软件开发\基站表生图\基站数据模板.xlsx",
            "mode": "single",
            "station_name": "示范站B-滨江路",
            "output_dir": str(ROOT / "tests" / "mcp-out"),
        }
    }})
    resp = read_until_id(rid)
    ok = False
    if resp and "result" in resp:
        content = resp["result"].get("content", [])
        if content and content[0].get("type") == "text":
            data = json.loads(content[0]["text"])
            ok = data.get("ok") is True and len(data.get("files", [])) == 1
            print(f"  出图: {data.get('summary', '')[:80]}")
    check("generate_station_dxf 协议调用", ok)

    # 6. 调用 compose_design_doc（成文）
    rid = send("tools/call", {"name": "compose_design_doc", "arguments": {
        "params": {
        "output_path": str(ROOT / "tests" / "mcp-out" / "MCP链路-示范站B方案.docx"),
        "project_name": "MCP 全链路验证（示范站B）",
        "stations": [{
            "name": "示范站B-滨江路", "tower": "角钢塔", "height": 55,
            "total_height": 58, "platforms": 3, "antennas": 5,
            "addr": "XX市XX区滨江路88号", "lon": "119.135", "lat": "30.118",
            "proj_no": "2025HACT0001-002-WX-LY", "proj_name": "2025年极简站",
        }],
        "citations": [{
            "code": "YD/T 5231-2019", "title": "移动通信工程钢塔桅结构设计规范",
            "number": "", "text": "",
        }],
            "drawings": [str(ROOT / "tests" / "mcp-out" / "示范站B-滨江路-基站图.dxf")],
        }
    }})
    resp = read_until_id(rid)
    ok = False
    if resp and "result" in resp:
        content = resp["result"].get("content", [])
        if content and content[0].get("type") == "text":
            data = json.loads(content[0]["text"])
            ok = data.get("ok") is True
            print(f"  成文: {data.get('summary', '')[:80]}")
    check("compose_design_doc 协议调用", ok)

    # 7. 调用 design_dedicated_line（政企专线）
    rid = send("tools/call", {"name": "design_dedicated_line", "arguments": {
        "params": {
            "customer_name": "示范客户-大张物流园",
            "customer_addr": "洛阳市涧西区中州西路大张物流园",
            "customer_lon": "112.32364", "customer_lat": "34.68807",
            "access_station": "广文路通信站",
            "access_addr": "洛阳市涧西区广文路",
            "access_lon": "112.33731", "access_lat": "34.66903",
            "line_type": "ethernet", "bandwidth_mbps": 1000,
            "route_type": "管道", "protection": True,
            "output_docx": str(ROOT / "tests" / "mcp-out" / "示范客户-政企专线建设方案.docx"),
            "output_dxf": str(ROOT / "tests" / "mcp-out" / "示范客户-专线路由示意图.dxf"),
            "output_xlsx": str(ROOT / "tests" / "mcp-out" / "示范客户-专线投资估算表.xlsx"),
        }
    }})
    resp = read_until_id(rid)
    ok = False
    if resp and "result" in resp:
        content = resp["result"].get("content", [])
        if content and content[0].get("type") == "text":
            data = json.loads(content[0]["text"])
            ok = bool(
                data.get("ok") is True
                and data.get("investment", {}).get("total", 0) > 0
                and data.get("files", {}).get("docx")
                and data.get("files", {}).get("dxf")
                and data.get("files", {}).get("xlsx")
            )
            print(f"  专线: {data.get('summary', '')[:120]}")
    check("design_dedicated_line 协议调用", ok)

finally:
    proc.stdin.close()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()

print()
print("=" * 60)
print(f"MCP 协议层测试：{sum(passed)}/{len(passed)} 通过")
print("=" * 60)
sys.exit(0 if all(passed) else 1)
