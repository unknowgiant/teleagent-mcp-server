/* ============================================================
 * draw-core.js — 绘图引擎 v2.0（二期）
 * 图元流设计：所有绘制通过 Paper 方法完成，同时记录世界坐标
 * 图元（米），供 Canvas 渲染与 DXF 渲染共用。
 * 新增：设备安装明细表 / 俯视图(方位角) / 尺寸标注 / 右侧信息区
 * ============================================================ */
(function () {
  "use strict";

  /* 图纸逻辑尺寸（二期加宽：右侧为信息区） */
  var PW = 1500, PH = 1520;
  var GROUND_Y = 1260;          // 地面线 y
  var CX = 460;                 // 塔中心 x
  var TOP_LIMIT = 150;          // 绘图上界（标题栏下方）
  var AVAIL_H = GROUND_Y - TOP_LIMIT;
  var AVAIL_W = 900;            // 塔区可用宽度
  var INFO_X = 1050;            // 右侧信息区起点
  var INFO_W = PW - 28 - INFO_X; // 右侧区宽

  /* 天线视觉常量（米） */
  var ANT_W = 0.45, ANT_H = 2.1, ANT_GAP = 0.16;
  var POLE_H = 2.7, POLE_T = 0.12;
  var BAR_T = 0.24;

  var C = {
    ink: "#2b3440", gray: "#8a94a0", light: "#d7dde4",
    steel: "#9aa4ae", steelFill: "#e3e8ee",
    home: "#1b66c9", homeDark: "#114e94",
    other: "#eef1f4", otherEdge: "#8a94a0",
    dim: "#6b7684", panel: "#f7f9fb", panelLine: "#cdd6e0"
  };

  /* ============ Paper：坐标映射 + 基础绘制 + 世界记录 ============ */
  function Paper(ctx, S, st, opts) {
    this.ctx = ctx; this.S = S; this.st = st; this.opts = opts || {};
    this.rec = [];            // 世界图元（米），供 DXF 立面
    this.sheetRec = [];       // 图签/信息区图元（Canvas 专用，不进 DXF）
    this.furnMode = false;    // true：记录进 sheetRec（图框/标题/俯视/明细表/图例）
  }
  Paper.prototype._rec = function (e) {
    (this.furnMode ? this.sheetRec : this.rec).push(e);
  };
  Paper.prototype.px = function (x) { return CX + x * this.S; };
  Paper.prototype.py = function (e) { return GROUND_Y - e * this.S; };
  Paper.prototype.m = function (v) { return v * this.S; };
  Paper.prototype.wx = function (px) { return (px - CX) / this.S; };
  Paper.prototype.wy = function (py) { return (GROUND_Y - py) / this.S; };

  Paper.prototype.line = function (x1, y1, x2, y2, color, w, dash) {
    this._rec({ t: "line", x1: this.wx(x1), y1: this.wy(y1), x2: this.wx(x2), y2: this.wy(y2), color: color, w: w, dash: dash });
    var c = this.ctx; if (!c) return;
    c.save();
    c.strokeStyle = color || C.ink; c.lineWidth = w || 1;
    if (dash) c.setLineDash(dash);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.restore();
  };
  Paper.prototype.poly = function (pts, fill, stroke, w, close) {
    var self = this;
    this._rec({ t: "poly", pts: pts.map(function (p) { return [self.wx(p[0]), self.wy(p[1])]; }), fill: fill, stroke: stroke, w: w, closed: close !== false });
    var c = this.ctx; if (!c) return;
    c.save();
    c.beginPath();
    pts.forEach(function (p, i) { i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
    if (close !== false) c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = w || 1; c.stroke(); }
    c.restore();
  };
  Paper.prototype.rect = function (x, y, w, h, fill, stroke, lw, dash) {
    this._rec({ t: "rect", x: this.wx(x), y: this.wy(y + h), w: w / this.S, h: h / this.S, fill: fill, stroke: stroke, lw: lw, dash: dash });
    var c = this.ctx; if (!c) return;
    c.save();
    if (dash) c.setLineDash(dash);
    c.beginPath(); c.rect(x, y, w, h);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
    c.restore();
  };
  Paper.prototype.roundRect = function (x, y, w, h, r, fill, stroke, lw) {
    this._rec({ t: "rrect", x: this.wx(x), y: this.wy(y + h), w: w / this.S, h: h / this.S, r: r / this.S, fill: fill, stroke: stroke, w: lw });
    var c = this.ctx; if (!c) return;
    c.save();
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
    c.restore();
  };
  Paper.prototype.circle = function (x, y, r, fill, stroke, lw) {
    this._rec({ t: "circle", x: this.wx(x), y: this.wy(y), r: r / this.S, fill: fill, stroke: stroke, w: lw });
    var c = this.ctx; if (!c) return;
    c.save();
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
    c.restore();
  };
  Paper.prototype.text = function (str, x, y, o) {
    o = o || {};
    var h = (o.size || 12) / this.S;
    this._rec({ t: "text", x: this.wx(x), y: this.wy(y), str: str, h: h, align: o.align || "left", color: o.color || C.ink, bold: !!o.bold });
    var c = this.ctx; if (!c) return 0;
    c.save();
    c.font = (o.bold ? "bold " : "") + (o.size || 12) + "px 'Microsoft YaHei',sans-serif";
    c.textAlign = o.align || "left";
    c.textBaseline = o.base || "alphabetic";
    if (o.bg) {
      var w = c.measureText(str).width;
      var bx = o.align === "center" ? x - w / 2 : (o.align === "right" ? x - w : x);
      c.fillStyle = o.bg;
      c.fillRect(bx - 3, y - (o.size || 12) + 1, w + 6, (o.size || 12) + 5);
    }
    c.fillStyle = o.color || C.ink;
    c.fillText(str, x, y);
    var tw = c.measureText(str).width;
    c.restore();
    return tw;
  };
  /* 信息区图元记录（表格/俯视图等不随塔比例的内容） */
  Paper.prototype.infoText = function (str, x, y, o) {
    return this.text(str, x, y, o);
  };

  /* ============ 平台布局计算（米） ============ */
  function itemWidth(it) { return it.count * ANT_W + (it.count - 1) * ANT_GAP; }
  function layoutPlatform(pl) {
    var groups = pl.poles.map(function (pole) {
      var w = 0;
      pole.items.forEach(function (it, i) { w += itemWidth(it) + (i ? 0.32 : 0); });
      return { pole: pole, w: Math.max(w, 0.9) };
    });
    var total = 0;
    groups.forEach(function (g, i) { total += g.w + (i ? 0.85 : 0); });
    var barW = Math.max(3.2, total + 0.7);
    var cursor = -barW / 2 + (barW - total) / 2;
    groups.forEach(function (g, i) {
      g.x = cursor + g.w / 2;
      cursor += g.w + (i < groups.length - 1 ? 0.85 : 0);
    });
    return { barW: barW, groups: groups };
  }

  function ranShort(ran) {
    if (!ran) return "本网";
    return ran.replace(/NR/gi, "").replace(/\s+/g, "").replace(/5G$/i, "5G") || ran;
  }
  function opShort(op) { return op.short; }

  /* ============ 平台 + 抱杆 + 天线 + 标注 ============ */
  function drawPlatform(paper, pl, opt) {
    opt = opt || {};
    var S = paper.S, st = paper.st;
    var lay = layoutPlatform(pl);
    var y = pl.elev;
    var xL = paper.px(-lay.barW / 2), xR = paper.px(lay.barW / 2);
    var yTop = paper.py(y + BAR_T), yBot = paper.py(y);

    /* 平台梁 */
    paper.line(xL, yBot, xR, yBot, "#414b57", 2.5);
    paper.line(xL, yTop, xR, yTop, "#414b57", 2.5);
    paper.line(xL, yTop, xL, yTop - paper.m(0.45), "#6b7684", 1.4);
    paper.line(xR, yTop, xR, yTop - paper.m(0.45), "#6b7684", 1.4);
    paper.rect(xL, yTop, xR - xL, yBot - yTop, "#c9d2dc");

    /* 斜撑 */
    if (opt.brace !== false && opt.bodyEdgeAt) {
      var bHalf = Math.max(opt.bodyEdgeAt(y), 0.15);
      var by = paper.py(Math.max(y - Math.min(1.4, y * 0.4), 0.2));
      paper.line(xL, yBot, paper.px(-bHalf), by, "#6b7684", 1.2);
      paper.line(xR, yBot, paper.px(bHalf), by, "#6b7684", 1.2);
    }

    /* 左侧平台标注 */
    var label = (opt.label || "平台") + pl.no + "  " + (Math.round(pl.elev * 10) / 10) + "m";
    paper.text(label, xL - paper.m(0.35), yTop + 4, { size: 12.5, color: "#37424e", bold: true, align: "right" });
    paper.line(xL - paper.m(0.3), yTop + 8, xL - paper.m(0.05), yTop + 8, "#6b7684", 1);

    /* 抱杆 + 天线组 */
    var lineH = Math.max(paper.m(0.62), 15);
    var rects = [];
    lay.groups.forEach(function (g) {
      var gx = paper.px(g.x);
      var poleTopY = paper.py(y + BAR_T + POLE_H);
      paper.line(gx, yTop, gx, poleTopY, "#414b57", 2.2);
      var cursorM = g.x - g.w / 2;
      g.pole.items.forEach(function (it) {
        for (var k = 0; k < it.count; k++) {
          var bxm = cursorM + k * (ANT_W + ANT_GAP);
          var ax = paper.px(bxm);
          var ayTop = paper.py(y + BAR_T + POLE_T + ANT_H);
          var aw = paper.m(ANT_W), ah = paper.m(ANT_H);
          if (it.op.home) {
            paper.roundRect(ax, ayTop, aw, ah, Math.min(4, aw / 3), C.home, C.homeDark, 1.4);
            paper.line(ax + aw / 2, ayTop, ax + aw / 2, ayTop - paper.m(0.18), C.homeDark, 1);
          } else {
            paper.roundRect(ax, ayTop, aw, ah, Math.min(4, aw / 3), C.other, C.otherEdge, 1.4);
            paper.line(ax + aw / 2, ayTop, ax + aw / 2, ayTop - paper.m(0.18), C.otherEdge, 1);
          }
        }
        cursorM += itemWidth(it) + 0.32;
      });
      /* 标注（组上方，错行防重叠） */
      var lines = g.pole.items.map(function (it) {
        if (it.op.home) {
          var az = (it.azimuth !== null && it.azimuth !== undefined) ? "(" + it.azimuth + "°)" : "";
          return "电信" + ranShort(it.ran) + "×" + it.count + az;
        }
        return it.op.short;
      });
      var cctx = paper.ctx;
      if (cctx) {
        cctx.save();
        cctx.font = "12px 'Microsoft YaHei',sans-serif";
      }
      var maxW = 0;
      lines.forEach(function (ln) {
        maxW = Math.max(maxW, cctx ? cctx.measureText(ln).width : 80);
      });
      if (cctx) cctx.restore();
      var x1 = gx - maxW / 2 - 4, x2 = gx + maxW / 2 + 4;
      var hBlock = lines.length * lineH;
      var baseY = paper.py(y + BAR_T + POLE_H + 0.35);
      var off = 0, hit = true;
      while (hit) {
        hit = false;
        var top = baseY - off * lineH - 14, bottom = top + hBlock + 4;
        for (var ri = 0; ri < rects.length; ri++) {
          var r = rects[ri];
          if (!(x2 < r.x1 || x1 > r.x2 || bottom < r.top || top > r.bottom)) { off++; hit = true; break; }
        }
      }
      rects.push({ x1: x1, x2: x2, top: baseY - off * lineH - 14, bottom: baseY - off * lineH - 14 + hBlock + 4 });
      var ly = baseY - off * lineH;
      lines.forEach(function (ln) {
        paper.text(ln, gx, ly, { size: 12, color: "#1f2d3d", align: "center", bg: "rgba(255,255,255,.92)" });
        ly -= lineH;
      });
      paper.text(g.pole.id, gx, yBot + 14, { size: 10.5, color: C.dim, align: "center" });
    });
  }

  /* ============ 地面 ============ */
  function drawGround(paper, st) {
    var x1 = 92, x2 = 1030;
    paper.line(x1, GROUND_Y, x2, GROUND_Y, "#37424e", 2.2);
    for (var x = x1 + 6; x < x2; x += 15) {
      paper.line(x, GROUND_Y + 12, x + 9, GROUND_Y + 2, "#b8c0ca", 1);
    }
    paper.text("±0.00", x1 + 2, GROUND_Y + 26, { size: 10.5, color: C.dim });
  }

  /* ============ 标高标尺 ============ */
  function drawRuler(paper, topElev) {
    var rx = 84;
    var topTick = Math.ceil(topElev / 5) * 5;
    paper.line(rx, GROUND_Y, rx, paper.py(topTick), "#6b7684", 1.2);
    for (var e = 0; e <= topTick; e += 5) {
      var y = paper.py(e);
      var major = (e % 10 === 0);
      var isTop = (e === topTick);
      paper.line(rx, y, rx - (major || isTop ? 9 : 5), y, "#6b7684", 1);
      if ((major && e > 0) || isTop) paper.text(String(e), rx - 13, y + 4, { size: 10.5, color: C.dim, align: "right" });
    }
    paper.text("标高(m)", rx - 6, paper.py(topTick) - 12, { size: 10.5, color: C.dim, align: "right" });
  }

  /* ============ 尺寸标注（总高 + 塔底宽） ============ */
  function drawDim(paper, st, meta) {
    if (paper.opts.showDim === false) return;
    var S = paper.S;
    var topM = meta.totalH;
    var dx = paper.px(Math.max(meta.halfW, 8) + 4.5);
    var g = GROUND_Y;
    /* 总高 */
    paper.line(dx, g, dx, paper.py(topM), "#e0a63c", 1.3);
    paper.line(dx - 8, g, dx + 8, g, "#e0a63c", 1.3);
    paper.line(dx - 8, paper.py(topM), dx + 8, paper.py(topM), "#e0a63c", 1.3);
    var lx = dx + 14;
    paper.text("总高 " + (Math.round(topM * 100) / 100) + "m", lx, (g + paper.py(topM)) / 2, { size: 12, color: "#b8860b", align: "left" });
    /* 塔底宽 */
    var baseHalf = (meta.baseHalfW || 0.6);
    var wy = g + 34;
    paper.line(paper.px(-baseHalf), wy, paper.px(baseHalf), wy, "#e0a63c", 1.3);
    paper.line(paper.px(-baseHalf), wy - 6, paper.px(-baseHalf), wy + 6, "#e0a63c", 1.3);
    paper.line(paper.px(baseHalf), wy - 6, paper.px(baseHalf), wy + 6, "#e0a63c", 1.3);
    paper.text("塔底宽 " + (Math.round(baseHalf * 2 * 100) / 100) + "m", paper.px(baseHalf) + 8, wy + 4, { size: 11, color: "#b8860b", align: "left" });
  }

  /* ============ 标题栏 ============ */
  function drawTitle(paper, st, index) {
    paper.rect(28, 28, PW - 56, 92, null, "#37424e", 1.6);
    paper.line(660, 28, 660, 120, "#37424e", 1.2);

    paper.text(st.name, 48, 66, { size: 21, bold: true });
    var sub = [st.addr, st.siteType].filter(Boolean).join(" · ");
    if (sub) paper.text(sub, 48, 96, { size: 12, color: C.dim });
    if (st.note) paper.text("备注：" + st.note.slice(0, 32), 48, 114, { size: 10.5, color: C.dim });

    var ant = window.DataModel.antennaTotal(st);
    var l1 = "塔型：" + st.towerLabel + "    塔高：" + st.height + "m";
    var l2 = "平台：" + (st.platforms.length || st.platNum || "-") + "    天线：" + ant + "面    RAN：" + (st.ran || "-");
    var l3 = "";
    if (st.lon && st.lat) l3 = "经度：" + st.lon + "  纬度：" + st.lat;
    if ((st.towerKey === "roofpole" || st.towerKey === "roofplat") && st.supH) {
      l3 += (l3 ? "    " : "") + "支承物高度：" + st.supH + "m";
    }
    paper.text(l1, 678, 55, { size: 13, bold: true });
    paper.text(l2, 678, 80, { size: 12, color: "#37424e" });
    if (l3) paper.text(l3, 678, 102, { size: 11, color: C.dim });
    if (st.warns && st.warns.length) {
      paper.text("△ " + st.warns[0].slice(0, 24) + (st.warns.length > 1 ? "（共" + st.warns.length + "条）" : ""), 678, 118, { size: 10, color: "#d48806" });
    }
  }

  /* ============ 俯视图（方位角示意） ============ */
  function drawPlan(paper, st, box) {
    if (paper.opts.showPlan === false) return;
    var x = box.x, y = box.y, w = box.w, h = box.h;
    paper.rect(x, y, w, h, null, "#6b7684", 1.4);
    paper.text("俯视图（方位角示意，0°=正北）", x + 8, y + 20, { size: 12, bold: true });
    var cx = x + w / 2, cy = y + h / 2 - 10;
    var R = Math.min(w, h) / 2 - 46;
    /* 北箭头 */
    paper.line(cx, cy - R - 18, cx, cy - R - 8, "#414b57", 1.6);
    paper.poly([[cx - 5, cy - R - 17], [cx + 5, cy - R - 17], [cx, cy - R - 24]], "#414b57", null);
    paper.text("N", cx + 6, cy - R - 18, { size: 12, bold: true });
    /* 塔断面 */
    paper.circle(cx, cy, 5, "#9aa4ae", "#414b57", 1.2);
    /* 各平台圈 + 抱杆方位 */
    var pls = st.platforms.slice().sort(function (a, b) { return a.no - b.no; });
    var maxNo = Math.max(pls.length, 1);
    var colors = ["#1b66c9", "#5f9e63", "#b08968", "#8a5aa6"];
    pls.forEach(function (pl, pi) {
      var rr = R * (0.42 + 0.58 * (maxNo > 1 ? (pl.no - 1) / (maxNo - 1) : 0));
      var col = colors[pi % colors.length];
      paper.circle(cx, cy, rr, null, col, 1.2, [4, 3]);
      var azs = [];
      pl.poles.forEach(function (po) {
        var az0 = po.items.length ? po.items[0].azimuth : null;
        var az = (az0 !== null && az0 !== undefined) ? az0 : 0;
        azs.push({ az: az, po: po });
      });
      azs.forEach(function (o) {
        var a = o.az * Math.PI / 180;
        var px2 = cx + Math.sin(a) * rr, py2 = cy - Math.cos(a) * rr;
        paper.circle(px2, py2, 3.4, o.po.items[0].op.home ? C.home : "#fff", o.po.items[0].op.home ? C.homeDark : C.otherEdge, 1.2);
        /* 方向短线 */
        var ex = cx + Math.sin(a) * (rr + 16), ey = cy - Math.cos(a) * (rr + 16);
        paper.line(px2, py2, ex, ey, o.po.items[0].op.home ? C.home : C.otherEdge, 2);
      });
      paper.text("平台" + pl.no + " " + pl.elev + "m", cx + rr + 4, cy - rr + 12, { size: 10, color: col, align: "left" });
    });
  }

  /* ============ 设备安装明细表 ============ */
  function drawTable(paper, st, box) {
    if (paper.opts.showTable === false) return;
    var x = box.x, y = box.y, w = box.w;
    paper.rect(x, y, w, 1, null, "#6b7684", 1.4); // 标题占位
    paper.text("设备安装明细表", x + 8, y + 16, { size: 13, bold: true });
    var yTop = y + 26;
      var cols = [
      { t: "平台", w: 40 },
      { t: "标高(m)", w: 46 },
      { t: "抱杆", w: 44 },
      { t: "运营商", w: 52 },
      { t: "制式", w: 52 },
      { t: "数量", w: 30 },
      { t: "方位角", w: 44 },
      { t: "型号", w: 94 }
    ];
    var totalW = 0;
    cols.forEach(function (c) { totalW += c.w; });
    /* 行 */
    var rows = [];
    st.platforms.forEach(function (pl) {
      pl.poles.forEach(function (po) {
        po.items.forEach(function (it) {
          rows.push({
            plat: "平台" + pl.no, elev: Math.round(pl.elev * 10) / 10,
            pole: po.id, op: it.op.short, ran: it.ran || "—",
            cnt: it.count, az: (it.azimuth !== null && it.azimuth !== undefined) ? it.azimuth + "°" : "—", model: it.model || "—"
          });
        });
      });
    });
    var rowH = 22;
    var yb = yTop + rowH;
    paper.rect(x, yTop, totalW, rowH, "#e8f0fa", "#6b7684", 1.2);
    var cx2 = x;
    cols.forEach(function (c) {
      paper.rect(cx2, yTop, c.w, rowH, null, "#9aa4ae", 0.6);
      paper.text(c.t, cx2 + c.w / 2, yTop + 15, { size: 11, bold: true, align: "center" });
      cx2 += c.w;
    });
    rows.forEach(function (r, i) {
      var ry = yb + i * rowH;
      if (ry > box.y + box.h - rowH) return;
      var cx3 = x;
      var vals = [r.plat, r.elev, r.pole, r.op, r.ran, String(r.cnt), r.az, r.model];
      cols.forEach(function (c, ci) {
        paper.rect(cx3, ry, c.w, rowH, null, "#cdd6e0", 0.6);
        var txt = vals[ci] === undefined ? "" : vals[ci];
        paper.text(String(txt), cx3 + 4, ry + 15, { size: 10.5, color: "#2b3440", align: "left" });
        cx3 += c.w;
      });
    });
    /* 表框 */
    var tbh = rowH + rows.length * rowH;
    paper.rect(x, yTop, totalW, tbh, null, "#6b7684", 1.4);
  }

  /* ============ 图例 + 制表栏 ============ */
  function drawLegend(paper, st) {
    var ctx = paper.ctx;
    var y0 = 1300;
    paper.line(28, y0, PW - 28, y0, "#37424e", 1.2);
    var y = y0 + 34;
    var x = 48;
    function legendItem(draw, label) {
      draw(x, y - 11);
      var tw = paper.text(label, x + 26, y, { size: 12, color: "#37424e" });
      x += 26 + tw + 34;
    }
    legendItem(function (px, py) {
      paper.roundRect(px, py - 8, 9, 18, 2, C.home, C.homeDark, 1);
    }, "本网天线(电信)");
    legendItem(function (px, py) {
      paper.roundRect(px, py - 8, 9, 18, 2, C.other, C.otherEdge, 1);
    }, "他网天线(仅标名称)");
    legendItem(function (px, py) {
      paper.line(px, py + 4, px + 20, py + 4, "#414b57", 2.5);
      paper.line(px, py + 4, px, py - 7, "#414b57", 2);
      paper.line(px + 20, py + 4, px + 20, py - 7, "#414b57", 2);
    }, "平台/抱杆");
    legendItem(function (px, py) {
      paper.line(px + 9, py + 6, px + 9, py - 9, "#414b57", 1.6);
      paper.circle(px + 9, py - 10, 2.4, null, "#414b57", 1.4);
    }, "避雷针");
    if (st.towerKey === "guyed" || st.towerKey === "hpole") {
      legendItem(function (px, py) {
        paper.line(px, py + 6, px + 20, py - 9, "#8a94a0", 1.4, [4, 3]);
      }, "拉线");
    }
    /* 制表栏 */
    var fy = y0 + 58;
    paper.rect(28, fy, PW - 56, 46, null, "#37424e", 1.2);
    paper.line(304, fy, 304, fy + 46, "#9aa4ae", 1);
    paper.line(580, fy, 580, fy + 46, "#9aa4ae", 1);
    paper.line(856, fy, 856, fy + 46, "#9aa4ae", 1);
    var d = new Date();
    var dateStr = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    var cells = [
      ["图号", "TZST-" + String((paper.opts.index || 0) + 1).padStart(3, "0")],
      ["制图日期", dateStr],
      ["比例", "示意 · 不按比例"],
      ["制图", "基站表生图系统 v2.0"]
    ];
    var xs = [28, 304, 580, 856];
    cells.forEach(function (cell, i) {
      paper.text(cell[0], xs[i] + 16, fy + 19, { size: 10.5, color: C.dim });
      paper.text(cell[1], xs[i] + 16, fy + 37, { size: 11.5, color: "#37424e", bold: true });
    });
  }

  /* ============ 汇总渲染 ============ */
  function renderStation(st, canvas, pixelScale, opts) {
    opts = opts || {};
    pixelScale = pixelScale || 1;
    var meta = window.TowerTemplates.meta(st);
    var S = Math.min(AVAIL_H / meta.totalH, AVAIL_W / meta.visualW);
    if (!isFinite(S) || S <= 0) S = 10;

    canvas.width = Math.round(PW * pixelScale);
    canvas.height = Math.round(PH * pixelScale);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    ctx.clearRect(0, 0, PW, PH);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PW, PH);
    ctx.lineJoin = "round"; ctx.lineCap = "round";

    var paper = new Paper(ctx, S, st, opts);

    /* 外图框：仅 Canvas 记录，DXF 侧由 Dxf.build 重绘标准图框 */
    paper.furnMode = true;
    paper.rect(14, 14, PW - 28, PH - 28, null, "#2b3440", 2.4);
    paper.rect(28, 28, PW - 56, PH - 56, null, "#6b7684", 1);
    paper.furnMode = false;

    /* 世界图元：地面/塔体/标高尺/尺寸标注（进 DXF 立面） */
    drawGround(paper, st);
    window.TowerTemplates.drawTower(paper, st);
    drawRuler(paper, meta.rulerTop);
    drawDim(paper, st, meta);

    /* 图签图元：标题/俯视/明细表/图例（仅 Canvas，DXF 侧由 Dxf.build 重排） */
    paper.furnMode = true;
    drawTitle(paper, st, opts.index);
    drawPlan(paper, st, { x: INFO_X, y: 140, w: INFO_W - 14, h: 320 });
    drawTable(paper, st, { x: INFO_X, y: 480, w: INFO_W - 14, h: 800 });
    drawLegend(paper, st);
    paper.furnMode = false;
    return paper;
  }

  window.DrawCore = {
    renderStation: renderStation,
    drawPlatform: drawPlatform,
    layoutPlatform: layoutPlatform,
    Paper: Paper,
    consts: { PW: PW, PH: PH, GROUND_Y: GROUND_Y, CX: CX, INFO_X: INFO_X, INFO_W: INFO_W, ANT_W: ANT_W, ANT_H: ANT_H, ANT_GAP: ANT_GAP, POLE_H: POLE_H, BAR_T: BAR_T, C: C, AV: { AVAIL_H: AVAIL_H, AVAIL_W: AVAIL_W } }
  };
})();