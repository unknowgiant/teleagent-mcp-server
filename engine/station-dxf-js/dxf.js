/* ============================================================
 * dxf.js — DXF 渲染器 v3.1（A1/A3 标准图幅 + 文字避让引擎）
 * 单站图：A1 横排 841×594（mm），出图比例自动选择（1:100~1:1000），
 *   分区：左立面区 / 右上俯视区 / 右中明细表 / 右下图签 / 左下图例。
 * 整套图：buildMM 直出毫米图元（sheet-templates DPaper）。
 * v3.1 核心新增（压字治理，参照设计院图纸习惯）：
 *   - 结构化实体收集（Ents.items），支持几何运算
 *   - dodgeTexts 文字避让引擎：文字与线条碰撞时自动平移到
 *     空白区（水平优先、垂直兜底），并生成引出线保持对应关系
 *   - 参考规范：阿勒泰H5H设计院图纸（A3 420×297、字高2mm、
 *     塔上标注引出到塔体两侧空白带）
 * 兼容性：R12 合规 POLYLINE/VERTEX/SEQEND；TEXT 补 11/21 对齐点；
 *   中文转 \U+XXXX 转义；图层名 ASCII 化。
 * ============================================================ */
(function () {
  "use strict";

  /* ---------- 图层定义 ---------- */
  var LAYERS = [
    { name: "图框",   aci: 7 },
    { name: "图签",   aci: 7 },
    { name: "塔体结构", aci: 8 },
    { name: "平台",   aci: 4 },
    { name: "本网天线", aci: 5 },
    { name: "他网天线", aci: 9 },
    { name: "美化绿化", aci: 3 },
    { name: "尺寸标注", aci: 30 },
    { name: "文字",   aci: 7 },
    { name: "表格",   aci: 7 },
    { name: "俯视图", aci: 3 },
    { name: "地面",   aci: 8 }
  ];
  function layerOf(color) {
    color = String(color || "");
    var c = color.toLowerCase();
    if (c === "#1b66c9" || c === "#114e94" || c === "#1f2d3d") return "本网天线";
    if (c === "#eef1f4" || c === "#8a94a0" || c === "#9aa4ae" || c === "#aab3bd" || c === "#7d8792" || c === "#dfe5ec" || c === "#eef2f6" || c === "#6b7684") return c === "#6b7684" ? "尺寸标注" : "塔体结构";
    if (c === "#5f9e63" || c === "#6fae73" || c === "#4f8c57" || c === "#3f6f46" || c === "#4a8452") return "美化绿化";
    if (c === "#e0a63c" || c === "#b8860b") return "尺寸标注";
    if (c === "#414b57" || c === "#37424e" || c === "#b6c2ce" || c === "#cdd6e0" || c === "#c9d2dc" || c === "#d9dfe6") return "塔体结构";
    if (c === "#b8a888" || c === "#8c7a5c" || c === "#a8846a" || c === "#7c5f48") return "塔体结构";
    return "塔体结构";
  }

  /* ---------- DXF 工具 ---------- */
  function esc(s) {
    return String(s).replace(/[\u0000-\u001f]/g, "");
  }
  /* 非 ASCII 字符 → DXF \U+XXXX 转义（R12 无编码声明，避免乱码） */
  function uni(s) {
    s = String(s);
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if ((c > 126 && c < 0xd800) || c >= 0xe000) {
        var h = c.toString(16).toUpperCase();
        while (h.length < 4) h = "0" + h;
        out += "\\U+" + h;
      } else {
        out += s.charAt(i);
      }
    }
    return out;
  }
  function num(v) { return Math.round(v * 1000) / 1000; }
  /* 文本宽度估算（基于原始串，转义前）：中文=字高，ASCII=0.62 字高（黑体实测） */
  function estW(s, h) {
    s = String(s); var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? h : h * 0.62;
    return w;
  }
  /* 截断至最大宽度（超出加省略号） */
  function fit(s, h, maxW) {
    s = String(s);
    if (estW(s, h) <= maxW) return s;
    while (s.length > 0 && estW(s + "…", h) > maxW) s = s.slice(0, -1);
    return s + "…";
  }
  /* 虚线 → 线型名 */
  function ltOf(dash) {
    if (!dash || !dash.length) return null;
    return dash.length >= 3 ? "DASHDOT" : "DASHED";
  }
  /* 图层名 ASCII 化（R12 无编码声明） */
  var LAYER_EN = {
    "图框": "FRAME", "图签": "TBLOCK", "塔体结构": "STRUCT", "平台": "PLATFORM",
    "本网天线": "ANT-HOME", "他网天线": "ANT-OTHER", "美化绿化": "GREENERY",
    "尺寸标注": "DIM", "文字": "TEXT", "表格": "TABLE", "俯视图": "PLAN-VIEW",
    "地面": "GROUND", "结构": "STRUCT", "新增设备": "EQ-NEW", "原有设备": "EQ-OLD",
    "拆除设备": "EQ-RMV", "其他运营商": "EQ-OTHER", "电源线": "CABLE-PWR",
    "地线": "CABLE-GND", "光缆": "CABLE-FIBER", "标注": "ANNO", "辅助": "AUX"
  };
  function LN(n) { return LAYER_EN[n] || n; }

  /* ============================================================
   * 结构化实体收集器（支持几何运算 → 文字避让）
   * ============================================================ */
  function Ents() { this.items = []; }
  var EP = Ents.prototype;
  EP.line = function (x1, y1, x2, y2, layer, lt) {
    this.items.push({ k: "line", x1: x1, y1: y1, x2: x2, y2: y2, layer: LN(layer), lt: lt || null });
  };
  EP.circle = function (x, y, r, layer, lt) {
    this.items.push({ k: "circle", x: x, y: y, r: Math.max(r, 0.05), layer: LN(layer), lt: lt || null });
  };
  EP.poly = function (pts, layer, closed, lt) {
    if (!pts || pts.length < 2) return;
    var P = [];
    for (var i = 0; i < pts.length; i++) P.push([+pts[i][0], +pts[i][1]]);
    this.items.push({ k: "poly", pts: P, closed: !!closed, layer: LN(layer), lt: lt || null });
  };
  EP.text = function (x, y, str, h, layer, halign, dodge) {
    var a = halign === "center" ? 1 : (halign === "right" ? 2 : 0);
    this.items.push({ k: "text", x: x, y: y, str: String(str), h: h, layer: LN(layer), ha: a, dodge: !!dodge });
  };
  EP.rect = function (x, y, w, h, layer, lt) {
    this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], layer, true, lt);
  };

  /* ============================================================
   * 文字避让引擎（压字治理核心）
   * 文字包围盒与障碍线段碰撞 → 水平滑动到空白区（优先背离图面
   * 中心方向）→ 加引出线；水平无处可放时垂直兜底。
   * ============================================================ */
  /* 文字包围盒 [x0,y0,x1,y1]（y 向上，基线下探 0.25h 上探 0.95h） */
  function textBox(it) {
    var w = estW(it.str, it.h);
    var x0, x1;
    if (it.ha === 1) { x0 = it.x - w / 2; x1 = it.x + w / 2; }
    else if (it.ha === 2) { x0 = it.x - w; x1 = it.x; }
    else { x0 = it.x; x1 = it.x + w; }
    return [x0, it.y - 0.25 * it.h, x1, it.y + 0.95 * it.h];
  }
  /* 线段-矩形相交（Liang-Barsky） */
  function segHitsBox(s, bx0, by0, bx1, by1) {
    var x1 = s[0], y1 = s[1], x2 = s[2], y2 = s[3];
    if (Math.max(x1, x2) < bx0 || Math.min(x1, x2) > bx1 ||
        Math.max(y1, y2) < by0 || Math.min(y1, y2) > by1) return false;
    var dx = x2 - x1, dy = y2 - y1, t0 = 0, t1 = 1;
    var E = [[-dx, x1 - bx0], [dx, bx1 - x1], [-dy, y1 - by0], [dy, by1 - y1]];
    for (var i = 0; i < 4; i++) {
      var p = E[i][0], q = E[i][1];
      if (p === 0) { if (q < 0) return false; continue; }
      var r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
  }
  /* 盒子是否无碰撞（对障碍线段 + 已放置文字盒） */
  function boxFree(bx0, by0, bx1, by1, segs, boxObs) {
    var i;
    for (i = 0; i < segs.length; i++) {
      if (segHitsBox(segs[i], bx0, by0, bx1, by1)) return false;
    }
    for (i = 0; i < boxObs.length; i++) {
      var o = boxObs[i];
      if (!(bx1 < o[0] || bx0 > o[2] || by1 < o[1] || by0 > o[3])) return false;
    }
    return true;
  }
  /* 收集障碍线段（非文字实体；忽略指定层如图框） */
  function collectObstacles(items, ignoreLayers) {
    var segs = [];
    var ign = {};
    (ignoreLayers || []).forEach(function (l) { ign[LN(l)] = 1; });
    items.forEach(function (it) {
      if (it.k === "text" || ign[it.layer]) return;
      if (it.k === "line") {
        segs.push([it.x1, it.y1, it.x2, it.y2]);
      } else if (it.k === "circle") {
        segs.push([it.x - it.r, it.y - it.r, it.x + it.r, it.y - it.r]);
        segs.push([it.x + it.r, it.y - it.r, it.x + it.r, it.y + it.r]);
        segs.push([it.x + it.r, it.y + it.r, it.x - it.r, it.y + it.r]);
        segs.push([it.x - it.r, it.y + it.r, it.x - it.r, it.y - it.r]);
      } else if (it.k === "poly") {
        var n = it.pts.length;
        for (var i = 0; i < n; i++) {
          if (i === n - 1 && !it.closed) break;
          var a = it.pts[i], b = it.pts[(i + 1) % n];
          segs.push([a[0], a[1], b[0], b[1]]);
        }
      }
    });
    return segs;
  }
  /* 避让主函数：zone = 允许放置区域 {x0,y0,x1,y1} */
  function dodgeTexts(ents, zone, ignoreLayers) {
    var segs = collectObstacles(ents.items, ignoreLayers);
    var texts = ents.items.filter(function (it) { return it.k === "text" && it.dodge; });
    var zw = zone.x1 - zone.x0;
    var step = Math.max(zw / 60, 0.4);
    var zcx = (zone.x0 + zone.x1) / 2;
    var boxObs = [];
    texts.forEach(function (it) {
      var b = textBox(it);
      var ox = it.x, oy = it.y;   /* 原锚点（引出线起点） */
      var need = !boxFree(b[0], b[1], b[2], b[3], segs, boxObs);
      if (need) {
        var placed = false;
        /* 水平滑动：文字中心偏图面右半 → 先试右；反之先左 */
        var rightFirst = (b[0] + b[2]) / 2 >= zcx;
        var dirs = rightFirst ? [1, -1] : [-1, 1];
        for (var d = 0; d < 2 && !placed; d++) {
          var sgn = dirs[d];
          for (var dx = step; dx <= zw + (b[2] - b[0]); dx += step) {
            var nb = sgn > 0 ? [b[0] + dx, b[1], b[2] + dx, b[3]] : [b[0] - dx, b[1], b[2] - dx, b[3]];
            if (nb[0] < zone.x0 || nb[2] > zone.x1) break;
            if (nb[1] < zone.y0 || nb[3] > zone.y1) continue;
            /* 引出线预检：不得穿过已放置文字 */
            var endX2 = sgn > 0 ? nb[0] - 3 * it.h : nb[2] + 3 * it.h;
            var leadOK = true;
            for (var bi = 0; bi < boxObs.length; bi++) {
              if (segHitsBox([ox, oy, endX2, oy], boxObs[bi][0], boxObs[bi][1], boxObs[bi][2], boxObs[bi][3])) { leadOK = false; break; }
            }
            if (!leadOK) continue;
            if (boxFree(nb[0], nb[1], nb[2], nb[3], segs, boxObs)) {
              it.x += sgn * dx;
              /* 引出线：从原锚点水平引到新文字近端（3h 间隙防贴字） */
              var lead = { k: "line", x1: ox, y1: oy, x2: endX2, y2: oy, layer: LN("尺寸标注"), lt: null };
              ents.items.push(lead);
              /* 引出线同步入障碍，防后续文字被引出线穿过 */
              segs.push([lead.x1, lead.y1, lead.x2, lead.y2]);
              placed = true;
              break;
            }
          }
        }
        /* 垂直兜底（找到即停，防多轮累加） */
        if (!placed) {
          var done = false;
          for (var dy = 1.6 * it.h; !done && dy <= zone.y1 - zone.y0; dy += 1.6 * it.h) {
            var cands = [[b[0], b[1] + dy, b[2], b[3] + dy], [b[0], b[1] - dy, b[2], b[3] - dy]];
            for (var ci = 0; ci < cands.length && !done; ci++) {
              var nb2 = cands[ci];
              if (nb2[1] >= zone.y0 && nb2[3] <= zone.y1 && boxFree(nb2[0], nb2[1], nb2[2], nb2[3], segs, boxObs)) {
                it.y += (nb2[1] - b[1]);
                done = true;
              }
            }
          }
        }
      }
      boxObs.push(textBox(it));
    });
  }

  /* ============================================================
   * 单站图：A1 横排分区布局
   * ============================================================ */
  var A1 = { W: 841, H: 594 };
  var Z = {
    inner: { x0: 25, y0: 5, x1: 836, y1: 589 },        // 内图框（左装订边 25）
    elev:  { x0: 32, x1: 497, yTop: 570, yBot: 62 },   // 立面区
    plan:  { x0: 505, x1: 836, yTop: 584, yBot: 320 }, // 俯视区
    tbl:   { x0: 505, x1: 836, top: 310, bottom: 68 }, // 明细表区
    tb:    { x0: 651, y0: 5, w: 185, h: 56 },          // 图签（右下）
    legendY: 18                                        // 图例基线
  };
  var SCALES = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000];

  function pickScale(needH, needW) {
    var fitH = Z.elev.yTop - Z.elev.yBot - 14;
    var fitW = Z.elev.x1 - Z.elev.x0 - 20;
    for (var i = 0; i < SCALES.length; i++) {
      var s = SCALES[i];
      if (needH / s <= fitH && needW / s <= fitW) return s;
    }
    return SCALES[SCALES.length - 1];
  }

  function buildDxf(paper, st, opts) {
    opts = opts || {};
    var rec = (paper && paper.rec) || [];   // 世界图元（米，仅立面内容）
    var ents = new Ents();

    /* ---- 0. 世界包围盒（米） ---- */
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    function acc(x1, y1, x2, y2) {
      minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
      minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
    }
    rec.forEach(function (e) {
      if (e.t === "line") acc(e.x1, e.y1, e.x2, e.y2);
      else if (e.t === "circle") acc(e.x - e.r, e.y - e.r, e.x + e.r, e.y + e.r);
      else if (e.t === "rect" || e.t === "rrect") acc(e.x, e.y, e.x + e.w, e.y + e.h);
      else if (e.t === "poly") e.pts.forEach(function (p) { acc(p[0], p[1], p[0], p[1]); });
      else if (e.t === "text") acc(e.x, e.y, e.x, e.y);
    });
    if (!isFinite(minX)) { minX = -5; maxX = 5; minY = -2; maxY = 10; }

    /* ---- 1. 比例选择与坐标映射 ---- */
    var N = pickScale((maxY - minY) * 1000, (maxX - minX) * 1000);
    var k = 1000 / N;                       // 米 → 图面 mm
    var cx0 = (Z.elev.x0 + Z.elev.x1) / 2;
    var gy = ((Z.elev.yBot - minY * k) + (Z.elev.yTop - maxY * k)) / 2;
    function SX(wx) { return cx0 + wx * k; }
    function SY(wy) { return gy + wy * k; }

    /* ---- 2. 图框（GB 边距：左 25 装订边，其余 5） ---- */
    ents.rect(0, 0, A1.W, A1.H, "图框");
    ents.rect(Z.inner.x0, Z.inner.y0, Z.inner.x1 - Z.inner.x0, Z.inner.y1 - Z.inner.y0, "图框");

    /* ---- 3. 顶部图名 ---- */
    var bigTitle = fit(st.name + "  无线基站安装示意图", 5, 620);
    ents.text(A1.W / 2, Z.inner.y1 - 8, bigTitle, 5, "文字", "center");

    /* ---- 4. 立面（世界图元 → 图面；文字参与避让） ---- */
    rec.forEach(function (e) {
      var lt = ltOf(e.dash);
      if (e.t === "line") {
        ents.line(SX(e.x1), SY(e.y1), SX(e.x2), SY(e.y2), layerOf(e.color), lt);
      } else if (e.t === "circle") {
        ents.circle(SX(e.x), SY(e.y), Math.max(e.r * k, 0.3), layerOf(e.color), lt);
      } else if (e.t === "rect" || e.t === "rrect") {
        ents.rect(SX(e.x), SY(e.y), e.w * k, e.h * k, layerOf(e.color), lt);
      } else if (e.t === "poly") {
        ents.poly(e.pts.map(function (p) { return [SX(p[0]), SY(p[1])]; }), layerOf(e.color), e.closed !== false, lt);
      } else if (e.t === "text") {
        ents.text(SX(e.x), SY(e.y), esc(String(e.str)), Math.min(Math.max(e.h * k, 2.0), 4.6), "文字", e.align, true);
      }
    });

    /* ---- 5. 俯视图（右上区，文字参与避让） ---- */
    drawPlanDxf(ents, st);

    /* ---- 6. 设备安装明细表（右中区） ---- */
    drawTableDxf(ents, st, opts);

    /* ---- 7. 图签（右下） ---- */
    drawTitleBlockDxf(ents, st, opts, N);

    /* ---- 8. 图例（左下条带） ---- */
    drawLegendDxf(ents, st);

    /* ---- 9. 文字避让（立面区 + 俯视区分别处理） ---- */
    dodgeTexts(ents, { x0: Z.elev.x0, y0: Z.elev.yBot, x1: Z.elev.x1, y1: Z.elev.yTop }, ["图框"]);
    dodgeTexts(ents, { x0: Z.plan.x0, y0: Z.plan.yBot, x1: Z.plan.x1, y1: Z.plan.yTop }, ["图框"]);

    return buildDxfText(ents);
  }

  /* ---------- 俯视图 ---------- */
  function drawPlanDxf(ents, st) {
    var b = Z.plan;
    var bw = b.x1 - b.x0, bh = b.yTop - b.yBot;
    ents.rect(b.x0, b.yBot, bw, bh, "俯视图");
    ents.text(b.x0 + bw / 2, b.yTop - 8, "天馈安装俯视图（0°=正北）", 3.6, "文字", "center");
    var pcx = b.x0 + bw / 2;
    var bandTop = b.yTop - 24;
    var pcy = (bandTop + b.yBot) / 2 + 2;
    var R = Math.min((bandTop - b.yBot) / 2 - 12, bw / 2 - 42);
    /* 北箭头 */
    ents.line(pcx, pcy + R + 3, pcx, pcy + R + 11, "俯视图");
    ents.poly([[pcx - 2.2, pcy + R + 10.5], [pcx + 2.2, pcy + R + 10.5], [pcx, pcy + R + 16]], "俯视图", true);
    ents.text(pcx + 3.4, pcy + R + 12.5, "N", 3.2, "文字");
    ents.circle(pcx, pcy, 2, "俯视图");
    /* 各平台圈 + 抱杆方位 */
    var pls = (st.platforms || []).slice().sort(function (a, b2) { return a.no - b2.no; });
    var cols = ["#1b66c9", "#5f9e63", "#b08968", "#8a5aa6"];
    var maxNo = Math.max(pls.length, 1);
    pls.forEach(function (pl, pi) {
      var rr = R * (0.42 + 0.58 * (maxNo > 1 ? (pl.no - 1) / (maxNo - 1) : 0));
      var col = cols[pi % cols.length];
      ents.circle(pcx, pcy, rr, layerOf(col), "DASHED");
      pl.poles.forEach(function (po) {
        var it0 = po.items[0] || {};
        var az = (it0.azimuth !== null && it0.azimuth !== undefined) ? it0.azimuth : 0;
        var a = az * Math.PI / 180;
        var px2 = pcx + Math.sin(a) * rr, py2 = pcy + Math.cos(a) * rr;
        var lyr = it0.op && it0.op.home ? "本网天线" : "他网天线";
        ents.circle(px2, py2, 1.5, lyr);
        ents.line(px2, py2, pcx + Math.sin(a) * (rr + 9), pcy + Math.cos(a) * (rr + 9), lyr);
      });
      ents.text(pcx + rr * 0.71 + 2, pcy + rr * 0.71 + 2, "平台" + pl.no + " " + (Math.round(pl.elev * 10) / 10) + "m", 2.8, "文字", "left", true);
    });
  }

  /* ---------- 设备安装明细表 ---------- */
  function drawTableDxf(ents, st, opts) {
    var x0 = Z.tbl.x0, x1 = Z.tbl.x1, top = Z.tbl.top, bottomLimit = Z.tbl.bottom;
    var w = x1 - x0;
    ents.text(x0 + 2, top + 4, "设备安装明细表", 4, "文字");
    var cols = [
      { t: "平台", w: 26 }, { t: "标高(m)", w: 28 }, { t: "抱杆", w: 24 },
      { t: "运营商", w: 32 }, { t: "制式", w: 32 }, { t: "数量", w: 16 },
      { t: "方位角", w: 26 }, { t: "型号", w: 147 }
    ];
    var rows = [];
    (st.platforms || []).forEach(function (pl) {
      (pl.poles || []).forEach(function (po) {
        (po.items || []).forEach(function (it) {
          rows.push([
            "平台" + pl.no,
            String(Math.round(pl.elev * 10) / 10),
            po.id || "",
            it.op.short || "",
            it.ran || "—",
            String(it.count),
            (it.azimuth !== null && it.azimuth !== undefined) ? it.azimuth + "°" : "—",
            it.model || "—"
          ]);
        });
      });
    });
    var hdrH = 9, rowHmax = 7, fs = 2.5;
    var maxRows = Math.floor((top - hdrH - bottomLimit - 8) / rowHmax);
    var truncated = rows.length > maxRows;
    var shown = rows.slice(0, maxRows);
    var rowH = shown.length ? Math.min(rowHmax, (top - hdrH - bottomLimit) / shown.length) : rowHmax;
    var tblH = hdrH + shown.length * rowH;
    ents.rect(x0, top - tblH, w, tblH, "表格");
    var cx = x0;
    cols.forEach(function (c) {
      ents.rect(cx, top - hdrH, c.w, hdrH, "表格");
      ents.text(cx + c.w / 2, top - hdrH / 2 - 1, c.t, 2.8, "文字", "center");
      cx += c.w;
    });
    shown.forEach(function (r, i) {
      var ry = top - hdrH - (i + 1) * rowH;
      var cx2 = x0;
      cols.forEach(function (c, ci) {
        ents.line(cx2, ry, cx2 + c.w, ry, "表格");
        var v = fit(r[ci], fs, c.w - 2.4);
        if (ci === cols.length - 1) ents.text(cx2 + 1.5, ry + rowH / 2 - 0.9, v, fs, "文字");
        else ents.text(cx2 + c.w / 2, ry + rowH / 2 - 0.9, v, fs, "文字", "center");
        cx2 += c.w;
      });
    });
    if (truncated) {
      ents.text(x0 + 2, bottomLimit + 2, "注：其余 " + (rows.length - shown.length) + " 行明细略，详见安装明细表。", 2.5, "文字");
    } else if (!shown.length) {
      ents.text(x0 + 2, top - hdrH - 10, "（无安装明细）", 2.8, "文字");
    }
  }

  /* ---------- 图签（通用样式，可整体替换为用户单位标准图签） ---------- */
  function drawTitleBlockDxf(ents, st, opts, N) {
    var x0 = Z.tb.x0, y0 = Z.tb.y0, w = Z.tb.w, h = Z.tb.h;
    var x1 = x0 + w, y1 = y0 + h;
    var xc = x0 + w / 2;
    ents.rect(x0, y0, w, h, "图签");
    ents.line(x0, y1 - 12, x1, y1 - 12, "图签");
    ents.text(xc, y1 - 8.2, fit(opts.designUnit || "中国移动通信集团设计院有限公司", 3.4, w - 6), 3.4, "文字", "center");
    ents.line(x0, y1 - 24, x1, y1 - 24, "图签");
    ents.text(xc, y1 - 19.8, fit("工程名称：" + (st.projName || "—"), 3, w - 6), 3, "文字", "center");
    ents.line(x0, y1 - 38, x1, y1 - 38, "图签");
    ents.text(xc, y1 - 33.6, "无线基站安装示意图", 4.2, "文字", "center");
    ents.line(x0, y0 + 12, x1, y0 + 12, "图签");
    ents.line(x0, y0 + 6, x1, y0 + 6, "图签");
    ents.line(xc, y0, xc, y0 + 18, "图签");
    var ant = 0;
    (st.platforms || []).forEach(function (pl) {
      (pl.poles || []).forEach(function (po) {
        (po.items || []).forEach(function (it) { ant += it.count || 1; });
      });
    });
    var d = new Date();
    var dateStr = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    var cells = [
      ["站名 " + (st.name || "—"), "塔高/平台 " + st.height + "m/" + ((st.platforms || []).length)],
      ["塔型 " + (st.towerLabel || "—"), "比例 1:" + N],
      ["图号 TZST-" + String((opts.index || 0) + 1).padStart(3, "0"), "日期 " + dateStr]
    ];
    var rowY = [y0 + 12, y0 + 6, y0];
    cells.forEach(function (pair, ri) {
      ents.text(x0 + 2, rowY[ri] + 1.9, fit(pair[0], 2.6, w / 2 - 5), 2.6, "文字");
      ents.text(xc + 2, rowY[ri] + 1.9, fit(pair[1], 2.6, w / 2 - 5), 2.6, "文字");
    });
  }

  /* ---------- 图例（左下条带） ---------- */
  function drawLegendDxf(ents, st) {
    var y0 = Z.legendY;
    var x = Z.elev.x0 + 4;
    function item(icon, label) {
      icon(x, y0);
      ents.text(x + 13, y0 + 0.4, label, 2.8, "文字");
      x += 13 + estW(label, 2.8) + 10;
    }
    item(function (ix, iy) {
      ents.rect(ix, iy - 1, 2.4, 6.4, "本网天线");
      ents.line(ix + 1.2, iy - 1, ix + 1.2, iy - 2.4, "本网天线");
    }, "本网天线（电信）");
    item(function (ix, iy) {
      ents.rect(ix, iy - 1, 2.4, 6.4, "他网天线");
    }, "他网天线（仅标名称）");
    item(function (ix, iy) {
      ents.line(ix, iy + 2.4, ix + 11, iy + 2.4, "平台");
      ents.line(ix, iy + 2.4, ix, iy - 1.8, "平台");
      ents.line(ix + 11, iy + 2.4, ix + 11, iy - 1.8, "平台");
    }, "平台/抱杆");
    item(function (ix, iy) {
      ents.line(ix + 3, iy - 1.6, ix + 3, iy + 5.6, "塔体结构");
      ents.circle(ix + 3, iy + 6.8, 0.9, "塔体结构");
    }, "避雷针");
    if (st.towerKey === "guyed" || st.towerKey === "hpole") {
      item(function (ix, iy) {
        ents.line(ix, iy - 1.6, ix + 11, iy + 4.4, "塔体结构", "DASHED");
      }, "拉线");
    }
  }

  /* ============================================================
   * 三期：毫米制图元直出（SheetKit.DPaper.rec → 整套图）
   * ============================================================ */
  var LAYERS3 = [
    { name: "图框",       aci: 7 },
    { name: "文字",       aci: 7 },
    { name: "表格",       aci: 7 },
    { name: "结构",       aci: 8 },
    { name: "新增设备",   aci: 1 },
    { name: "原有设备",   aci: 8 },
    { name: "拆除设备",   aci: 2 },
    { name: "其他运营商", aci: 9 },
    { name: "电源线",     aci: 1 },
    { name: "地线",       aci: 3 },
    { name: "光缆",       aci: 4 },
    { name: "标注",       aci: 30 },
    { name: "辅助",       aci: 9 }
  ];
  function layerOfMM(color) {
    var c = String(color || "").toLowerCase();
    if (c === "#c0392b") return "新增设备";
    if (c === "#2b3440") return "结构";
    if (c === "#6b7684" || c === "#9aa4ae") return "标注";
    if (c === "#1e8449") return "地线";
    if (c === "#0e7490") return "光缆";
    if (c === "#b8860b") return "标注";
    if (c === "#1b66c9") return "原有设备";
    if (c === "#8a5aa6") return "辅助";
    return "结构";
  }
  function buildDxfMM(rec) {
    var ents = new Ents();
    rec.forEach(function (e) {
      var lay = null, lt = ltOf(e.dash);
      if (e.t === "text") {
        ents.text(e.x, e.y, String(e.str), Math.max(e.h, 100), "文字", e.align, !!e.dodge);
        return;
      }
      if (e.color === "#2b3440" && e.t === "rect" && (e.lw || 0) >= 10) lay = "图框";
      if ((e.color === "#6b7684" || e.color === "#9aa4ae") && e.t === "line" && (e.w || 0) <= 8) lay = lay || "表格";
      if ((e.color === "#6b7684" || e.color === "#9aa4ae") && e.t === "rect" && (e.lw || 0) <= 8) lay = lay || "表格";
      if (!lay && e.t === "line" && String(e.color || "").toLowerCase() === "#c0392b") lay = "电源线";
      lay = lay || layerOfMM(e.color);
      if (e.t === "line") ents.line(e.x1, e.y1, e.x2, e.y2, lay, lt);
      else if (e.t === "circle") ents.circle(e.x, e.y, e.r, lay, lt);
      else if (e.t === "rect") ents.rect(e.x, e.y, e.w, e.h, lay, lt);
      else if (e.t === "poly") ents.poly(e.pts, lay, e.closed !== false, lt);
    });
    /* 文字避让：A3 内框全区 */
    dodgeTexts(ents, { x0: 2500, y0: 500, x1: 20500, y1: 14350 }, ["图框"]);
    return buildDxfText(ents, LAYERS3);
  }

  /* ============ 组装 DXF 文本（R12/AC1009） ============ */
  function buildDxfText(ents, layerTable) {
    var layers = layerTable || LAYERS;
    var s = [];
    s.push("0", "SECTION", "2", "HEADER");
    s.push("9", "$ACADVER", "1", "AC1009");
    s.push("9", "$INSUNITS", "70", "4");      // 毫米
    s.push("9", "$LTSCALE", "40", "1.0");
    s.push("0", "ENDSEC");
    s.push("0", "SECTION", "2", "TABLES");
    s.push("0", "TABLE", "2", "LTYPE", "70", "3");
    s.push("0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0");
    s.push("0", "LTYPE", "2", "DASHED", "70", "0", "3", "_ _ _ _", "72", "65", "73", "2", "40", "9.0", "49", "6.0", "49", "-3.0");
    s.push("0", "LTYPE", "2", "DASHDOT", "70", "0", "3", "_ . _ .", "72", "65", "73", "4", "40", "20.0", "49", "12.0", "49", "-3.0", "49", "0.0", "49", "-3.0");
    s.push("0", "ENDTAB");
    s.push("0", "TABLE", "2", "LAYER", "70", String(layers.length));
    layers.forEach(function (L) {
      s.push("0", "LAYER", "2", LN(L.name), "70", "0", "62", String(L.aci), "6", "CONTINUOUS");
    });
    s.push("0", "ENDTAB");
    s.push("0", "TABLE", "2", "STYLE", "70", "1");
    s.push("0", "STYLE", "2", "Standard", "70", "0", "40", "0", "41", "1.0", "50", "0", "71", "0", "42", "0.2", "3", "simhei.ttf", "4", "");
    s.push("0", "ENDTAB");
    s.push("0", "ENDSEC");
    /* 实体 */
    s.push("0", "SECTION", "2", "ENTITIES");
    var entStr = "";
    ents.items.forEach(function (it) {
      if (it.k === "line") {
        entStr += "0\nLINE\n8\n" + it.layer + (it.lt ? "\n6\n" + it.lt : "") +
          "\n10\n" + num(it.x1) + "\n20\n" + num(it.y1) + "\n30\n0\n11\n" + num(it.x2) + "\n21\n" + num(it.y2) + "\n31\n0\n";
      } else if (it.k === "circle") {
        entStr += "0\nCIRCLE\n8\n" + it.layer + (it.lt ? "\n6\n" + it.lt : "") +
          "\n10\n" + num(it.x) + "\n20\n" + num(it.y) + "\n30\n0\n40\n" + num(it.r) + "\n";
      } else if (it.k === "poly") {
        var ps = "0\nPOLYLINE\n8\n" + it.layer + (it.lt ? "\n6\n" + it.lt : "") +
          "\n66\n1\n70\n" + (it.closed ? 1 : 0) + "\n10\n0.0\n20\n0.0\n30\n0.0\n";
        for (var i = 0; i < it.pts.length; i++) {
          ps += "0\nVERTEX\n8\n" + it.layer + "\n10\n" + num(it.pts[i][0]) + "\n20\n" + num(it.pts[i][1]) + "\n30\n0.0\n";
        }
        ps += "0\nSEQEND\n8\n" + it.layer + "\n";
        entStr += ps;
      } else if (it.k === "text") {
        var str = uni(esc(it.str).replace(/[\r\n]+/g, ""));
        var ts = "0\nTEXT\n8\n" + it.layer + "\n10\n" + num(it.x) + "\n20\n" + num(it.y) + "\n30\n0\n40\n" + num(it.h) + "\n";
        if (it.ha) ts += "72\n" + it.ha + "\n11\n" + num(it.x) + "\n21\n" + num(it.y) + "\n31\n0\n";
        ts += "1\n" + str + "\n";
        entStr += ts;
      }
    });
    s.push(entStr.replace(/\n+$/, ""));
    s.push("0", "ENDSEC");
    s.push("0", "EOF");
    return s.join("\n");
  }

  window.Dxf = { build: buildDxf, buildMM: buildDxfMM, buildDxfText: buildDxfText, LAYERS: LAYERS, LAYERS3: LAYERS3 };
})();
