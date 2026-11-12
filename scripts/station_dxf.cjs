#!/usr/bin/env node
/**
 * station_dxf.cjs — 基站表生图系统无头出图入口（课题10 MCP 封装）
 *
 * 复用 E:\软件开发\基站表生图\app\js 现有引擎（零移植）：
 *   draw-core.js（Paper 图元收集）→ tower-templates.js（塔型模板）
 *   → data-model.js（Excel 解析校验）→ dxf.js（R12 DXF 渲染）
 *   → sheet-templates.js（设计院整套图纸 DPaper）
 *
 * 用法：node station_dxf.cjs <参数JSON文件路径>
 * 参数：{ excelPath, stationName?, mode: "single"|"kit",
 *         options?: {showPlan,showTable,showDim}, outputDir }
 * 输出：stdout 打印 JSON 结果（UTF-8），退出码 0=成功 2=数据错误 3=参数错误
 */
"use strict";

const fs = require("fs");
const path = require("path");

/* ---------- 常量 ---------- */
/* 绘图引擎路径解析：环境变量 STATION_ENGINE_JS → 工程内 engine/station-dxf-js（部署包自包含）
   → 开发机原路径（E:\软件开发\基站表生图\app\js） */
function resolveEngineJs() {
  const env = (process.env.STATION_ENGINE_JS || "").trim();
  if (env && fs.existsSync(env)) return env;
  const bundled = path.join(__dirname, "..", "engine", "station-dxf-js");
  if (fs.existsSync(path.join(bundled, "draw-core.js"))) return bundled;
  return "E:\\软件开发\\基站表生图\\app\\js";
}
const APP_JS = resolveEngineJs();
const EXIT_OK = 0, EXIT_DATA = 2, EXIT_ARGS = 3;

/* ---------- window 桩：模块通过 window.* 互通 ---------- */
if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}

function emit(obj, code) {
  process.stdout.write(JSON.stringify(obj, null, 2));
  process.exit(code === undefined ? EXIT_OK : code);
}

/* ---------- 参数读取 ---------- */
const argFile = process.argv[2];
if (!argFile || !fs.existsSync(argFile)) {
  emit({ ok: false, error: "缺少参数文件（用法: node station_dxf.cjs <参数.json>）" }, EXIT_ARGS);
}
let args;
try {
  let raw = fs.readFileSync(argFile, "utf-8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 兼容 UTF-8 BOM
  args = JSON.parse(raw);
} catch (e) {
  emit({ ok: false, error: "参数文件不是有效 JSON：" + e.message }, EXIT_ARGS);
}

const excelPath = args.excelPath;
const outputDir = args.outputDir;
const mode = args.mode === "kit" ? "kit" : "single";
const stationName = args.stationName || null;
const dispOpts = Object.assign(
  { showPlan: true, showTable: true, showDim: true },
  args.options || {}
);

if (!excelPath || !fs.existsSync(excelPath)) {
  emit({ ok: false, error: "Excel 文件不存在：" + excelPath }, EXIT_ARGS);
}
if (!outputDir) {
  emit({ ok: false, error: "缺少输出目录 outputDir" }, EXIT_ARGS);
}

/* ---------- 加载表生图引擎（顺序即依赖顺序） ---------- */
let DataModel, DrawCore, TowerTemplates, Dxf, SheetKit, XLSX;
try {
  require(path.join(APP_JS, "draw-core.js"));
  require(path.join(APP_JS, "tower-templates.js"));
  require(path.join(APP_JS, "data-model.js"));
  require(path.join(APP_JS, "dxf.js"));
  require(path.join(APP_JS, "sheet-templates.js"));
  XLSX = require(path.join(APP_JS, "libs", "xlsx.full.min.js"));
  globalThis.XLSX = XLSX; // data-model.js 使用裸全局 XLSX 引用
  DataModel = globalThis.window.DataModel;
  DrawCore = globalThis.window.DrawCore;
  TowerTemplates = globalThis.window.TowerTemplates;
  Dxf = globalThis.window.Dxf;
  SheetKit = globalThis.window.SheetKit;
} catch (e) {
  emit({ ok: false, error: "表生图引擎加载失败：" + e.message }, EXIT_DATA);
}

/* ---------- Canvas 桩：DXF 路径只读 paper.rec，不真正绘制 ---------- */
function makeStubCanvas() {
  const noopResult = { width: 0 };
  const ctx = new Proxy(function () { return noopResult; }, {
    get(target, prop) {
      if (prop === "measureText") return () => ({ width: 0 });
      if (typeof prop === "symbol") return undefined;
      return target; // 任意方法调用都返回 no-op 函数
    },
    set() { return true; } // fillStyle 等赋值直接吞掉
  });
  return {
    width: 0,
    height: 0,
    getContext: () => ctx
  };
}

/* ---------- 文件名安全化（与 app.js safeName 语义一致） ---------- */
function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 60);
}

/* ---------- 解析 Excel ---------- */
let wb, parsed;
try {
  const buf = fs.readFileSync(excelPath);
  wb = XLSX.read(buf, { type: "buffer" });
  parsed = DataModel.parseWorkbook(wb);
} catch (e) {
  emit({ ok: false, error: "Excel 解析失败：" + e.message }, EXIT_DATA);
}

if (parsed.errors && parsed.errors.length) {
  emit({ ok: false, error: "数据校验未通过", errors: parsed.errors, warnings: parsed.warnings || [] }, EXIT_DATA);
}
if (!parsed.stations || !parsed.stations.length) {
  emit({ ok: false, error: "未解析到任何基站，请检查《基站主表》" }, EXIT_DATA);
}

/* ---------- 站点过滤 ---------- */
let stations = parsed.stations;
if (stationName) {
  const hit = stations.filter(function (s) { return s.name === stationName; });
  if (!hit.length) {
    emit({
      ok: false,
      error: "未找到基站「" + stationName + "」",
      available: stations.map(function (s) { return s.name; })
    }, EXIT_DATA);
  }
  stations = hit;
}

/* ---------- 输出目录 ---------- */
try {
  fs.mkdirSync(outputDir, { recursive: true });
} catch (e) {
  emit({ ok: false, error: "输出目录创建失败：" + e.message }, EXIT_ARGS);
}

/* ---------- 生成 DXF ---------- */
const files = [];
const stationSummary = [];
let globalIndex = parsed.stations.indexOf(stations[0]); // kit 图号按全表序号
if (globalIndex < 0) globalIndex = 0;

try {
  stations.forEach(function (st) {
    const i = parsed.stations.indexOf(st);
    if (mode === "kit") {
      /* 设计院整套图纸：SheetKit.buildAll → [{name, seq, dxf}] */
      const sheets = SheetKit.buildAll(st, i, parsed.kit);
      sheets.forEach(function (s) {
        const fn = safeName(st.name) + "-整套-" + String(s.seq).padStart(2, "0") + "-" + safeName(s.name) + ".dxf";
        const fp = path.join(outputDir, fn);
        fs.writeFileSync(fp, s.dxf, "utf-8");
        files.push(fp);
      });
    } else {
      /* 单站基站图：与 app.js buildDxf 同一调用链 */
      const stubCanvas = makeStubCanvas();
      const opts = Object.assign({ index: i }, dispOpts);
      const paper = DrawCore.renderStation(st, stubCanvas, 1, opts);
      const dxf = Dxf.build(paper, st, opts);
      const fn = safeName(st.name) + "-基站图.dxf";
      const fp = path.join(outputDir, fn);
      fs.writeFileSync(fp, dxf, "utf-8");
      files.push(fp);
    }

    /* 站点摘要（供 Agent 写方案文档引用） */
    const meta = TowerTemplates.meta(st);
    const antennas = (st.platforms || []).reduce(function (n, p) {
      return n + (p.poles || []).reduce(function (m, pole) { return m + (pole.count || 1); }, 0);
    }, 0);
    stationSummary.push({
      name: st.name,
      tower: st.towerLabel || st.towerRaw,
      towerKey: st.towerKey,
      height: st.height,
      totalHeight: meta && meta.totalH ? Math.round(meta.totalH * 100) / 100 : st.height,
      platforms: (st.platforms || []).length,
      antennas: antennas,
      addr: st.addr || "",
      lon: st.lon || "",
      lat: st.lat || "",
      projNo: st.projNo || "",
      projName: st.projName || "",
      warns: st.warns || []
    });
  });
} catch (e) {
  emit({ ok: false, error: "DXF 生成失败：" + e.message, partial: files }, EXIT_DATA);
}

emit({
  ok: true,
  mode: mode,
  requested: stationName || "(全部站点)",
  stationCount: stations.length,
  totalInWorkbook: parsed.stations.length,
  files: files,
  stations: stationSummary,
  warnings: parsed.warnings || []
}, EXIT_OK);
