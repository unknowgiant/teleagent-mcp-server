# telecom_agent_mcp — 人工智能+信息通信 MCP 服务器

**2027 年度高新研发项目备选方向 · 课题 10（人工智能+信息通信 Agent/Skill）核心交付** v1.1

把本地自研工程引擎封装为 LLM 可调用的 MCP 工具，构成两条业务链路：

**链路一（无线侧）：「规范检索 → 基站出图 → 方案成文」**

```
用户/Agent
   │
   ├─ search_telecom_std ──→ 《通信设计依据宝典》
   │      （128 标准 / 782 强条 / 489 万字全文 / 7 专业）
   │            │ citations（编制依据）
   │            ▼
   ├─ generate_station_dxf ─→ 《基站表生图系统 v3.0》引擎（Node 无头）
   │      （Excel → 10 类塔型识别 → R12 DXF，单站图 / 设计院整套 6 张图）
   │            │ files + stations 摘要
   │            ▼
   └─ compose_design_doc ──→ 《基站建设工程设计方案》.docx
          （公文风格 A4：编制依据/工程概况/建设方案/图纸清单）
```

**链路二（有线侧）：「政企专线设计」**

```
客户/局站信息（经纬度或距离）
   │
   └─ design_dedicated_line ─→ 路由估算(haversine×绕曲系数) → 光缆/设备选型
          → 材料清单与投资估算（参考单价表可编辑校准）
          → 《政企专线建设方案》.docx + 路由示意图 .dxf + 投资估算表 .xlsx
```

## 工具清单（6 个）

| 工具                      | 作用                                                             | 只读    |
| ----------------------- | -------------------------------------------------------------- | ----- |
| `search_telecom_std`    | 规范条文检索（关键词 AND / 标准号 / 专业 / 仅强条，分页）                            | ✓     |
| `list_telecom_std`      | 标准清单（按专业，含全文与强条统计）                                             | ✓     |
| `generate_station_dxf`  | Excel 勘察表 → DXF 图纸（single 单站图 / kit 设计院整套 6 张）                 | 写输出目录 |
| `compose_design_doc`    | 站点+规范引用+图纸清单 → 设计方案 Word 文档                                    | 写输出文件 |
| `telecom_suite_status`  | 引擎自检（宝典数据 / 表生图引擎 / Node / python-docx）                        | ✓     |
| `design_dedicated_line` | 政企专线设计：路由估算→选型→材料与投资→方案 docx + 路由图 dxf + 估算表 xlsx（5 类专线×3 种敷设） | 写输出文件 |

## 环境要求

- Windows（当前硬编码路径为 `E:\软件开发\...`，迁移时改 `tools/` 下常量）
- Node.js ≥ 16（出图引擎运行时；当前机器 v24）
- Python 3.10+（使用项目自带 `.venv`，依赖见 `requirements.txt`：mcp<2 / openpyxl / python-docx）

## 部署到 TeleAgent（stdio 子进程）

1. 点击 TeleAgent 左下角头像 → **工具设置**
2. MCP 配置区域 → **添加**
3. 粘贴 `teleagent-config.json` 的内容：

```json
{
  "mcpServers": {
    "telecom_agent_mcp": {
      "command": "E:\\软件开发\\teleagent-mcp-server\\.venv\\Scripts\\python.exe",
      "args": ["E:\\软件开发\\teleagent-mcp-server\\server.py"]
    }
  }
}
```

1. 保存后确认 MCP 状态为"已连接"
2. 验证：对话中说"自检一下电信智能体套件"，应调用 `telecom_suite_status` 并返回 ok=true

无需任何 API Key（全部本地引擎，数据不出本机）。

## 典型用法（对话式）

> "帮我查一下基站抗震设防的强制性条文" → `search_telecom_std`  
> "把这份勘察表出成设计院整套图纸：E:...\基站数据模板.xlsx" → `generate_station_dxf(mode=kit)`  
> "给这批基站出一份设计方案，编入刚才查到的强条和图纸清单" → `compose_design_doc`  
> "给XX医院设计一条到广文路通信站的千兆以太网专线，出方案文档和路由图" → `design_dedicated_line`

## 目录结构

```
teleagent-mcp-server/
├── server.py                 # FastMCP 主服务器（stdio，6 个工具）
├── teleagent-config.json     # TeleAgent 部署配置（直接粘贴）
├── requirements.txt
├── config/
│   └── dedline_prices.json   # 451 口径人工费/费率已按真实预算文件校准（含来源台账），敷设工日待填后启用 std451 模式
├── tools/
│   ├── baodian_search.py     # 宝典检索（数据源只读引用，模块级缓存）
│   ├── station_dxf.py        # 出图工具（subprocess 调 Node）
│   ├── document_gen.py       # 方案文档（python-docx，公文版式）
│   └── dedicated_line.py     # 政企专线设计（路由/选型/投资/文档/路由图）
├── engine/
│   └── station-dxf-js/        # 表生图引擎部署包（v3.1 文字避让版，自包含；含 VERSION.txt 同步记录）
│       ├── draw-core.js / tower-templates.js / data-model.js / dxf.js / sheet-templates.js
│       └── libs/xlsx.full.min.js
├── scripts/
│   └── station_dxf.cjs       # Node 无头出图入口（引擎解析：部署包 → 开发机原路径）
├── outputs/
│   ├── 课题10-全链路演示/    # 模板数据演示（9 单站图 + 6 整套图 + 设计方案 docx）
│   ├── 真实试点-洛阳偃师三实小/ # 真实勘察报告全链路试点（C-RAN 方案 + 前传光缆三件套）
│   ├── 专线试水/            # 重载后新工具试水（大张物流园三件套）
│   └── 课题10-申报材料/     # 技术方案初稿 + 按附件2模板填好的正式申报表
├── tests/
│   ├── e2e_test.py           # 全链路测试（14 项）
│   ├── mcp_protocol_test.py  # MCP 协议层测试（14 项）
│   ├── dedline_test.py       # 政企专线单元测试（33 项，含 xlsx 读回校验）
│   ├── evaluation.xml        # 评估问题集（11 题）
│   └── mcp-out/              # 测试产物（DXF/docx 样张）
└── .venv/                    # 独立虚拟环境（不污染全局）
```

## 技术要点

1. **零移植复用**：`scripts/station_dxf.cjs` 直接 `require()` 表生图项目的  
   draw-core / tower-templates / data-model / dxf / sheet-templates 五个 JS 模块，  
   通过 `globalThis.window = globalThis` 桩满足模块间 `window.*` 互通；  
   DXF 路径不依赖 Canvas（Paper 类自带 ctx 空值保护，图元收集与绘制天然分离），  
   仅用 Proxy 桩吸收 `renderStation` 顶部的 Canvas 调用。
2. **XLSX 全局注入**：xlsx.full.min.js 的 UMD 在 Node 下 require 返回不完整对象，  
   且 data-model.js 使用裸 `XLSX` 全局引用——require 后显式 `globalThis.XLSX = XLSX` 解决。
3. **参数传递走临时 JSON 文件**：避免命令行中文转义问题，用完即删。
4. **检索语义**：条文只按自身文本命中（关键词 AND）；标题命中仅返回标准级条目，  
   防止整本标准条文爆炸；强条模式只迭代 782 条 clauses。
5. **文档串联**：三个工具的返回结构刻意对齐（stations[] / results[] / files[]），  
   Agent 可直接把上游输出喂给下游输入。
6. **专线模块**：路由 = haversine 直线距离 × 绕曲系数（默认 1.35，可覆盖）；  
   单价外置到 config/dedline_prices.json（改文件即生效，不动代码）；  
   路由示意图由内置极简 R12 DXF 写出器生成（复用表生图同款 LWPOLYLINE/STYLE 结构）。
7. **估算 Excel 导出**：估算汇总/材料明细/设备明细三表（表四甲·简化风格）；  
   汇总表与材料表合计和 JSON 返回逐值一致（测试断言），衔接 Excel 概算工作流。
8. **451 口径估算（estimate_mode=std451）**：人工费=敷设工日×技工单价（114 元/工日），  
   措施费/规费/企管费/利润/税金按真实预算文件校准费率计取（表二结构，输出九项分解，  
   同步写入 xlsx『451费用分解』表与 docx 分解表）；定额工日（TMS1）未填时明确提示而非估算。

## 已知限制

- 宝典数据、表生图引擎按绝对路径只读引用原项目；原项目移走后 `telecom_suite_status` 会报 missing。
- **v1.2.2 起表生图引擎已随部署包自包含**：`engine/station-dxf-js/` 为同步快照（优先加载），  
  开发机原路径仅作回退；更新引擎后需重新同步该目录（同步来源与版本见目录内 VERSION.txt）。
- DXF 为 R12 兼容格式（AC1009、毫米单位、分图层），与表生图网页版输出一致。
- kit 模式每站 6 张图；站点多于 100 时建议分批（工具超时上限 300 秒）。
- compose_design_doc 的文档结构为固定公文风格，深度定制需改 `tools/document_gen.py`。
- 政企专线 v1：投资为参考单价估算（正式报审须套 451 定额）；局站侧资源核查  
  （端口/管孔占用）需人工确认，尚未接入资源系统。
- **工具热更新**：修改 server.py / tools 后，已运行的 MCP 会话不会自动加载新工具，  
  需在 TeleAgent 工具设置里重新保存 MCP 配置（或重启会话）后生效。

## 测试记录

- `tests/e2e_test.py`：14/14 通过（2026-10-28）
- `tests/mcp_protocol_test.py`：14/14 通过（2026-10-28，含 6 工具注册与专线调用）
- `tests/dedline_test.py`：33/33 通过（2026-10-28，含估算 Excel 读回与数值一致性校验）
- 451 口径专项：12/12 通过（2026-10-28，std451 分解/口径切换/未填工日提示）
- 真实模板 Excel（9 站、10 类塔型覆盖）single/kit 双模式出图验证通过
- 全链路演示产物：outputs/课题10-全链路演示/（15 张 DXF + 1 份设计方案 docx，经 docx 读回验证）
- 真实试点：基于真实勘察报告（C-RAN 拉远站）完成检索→前传光缆估算→方案成文全链路
- 申报材料：技术方案初稿 + 按附件2模板填好的正式申报表（勾选/字段读回验证）

>
