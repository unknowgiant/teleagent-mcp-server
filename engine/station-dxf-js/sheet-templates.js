/* ============================================================
 * sheet-templates.js — 设计院模板图型库（三期）
 * 对齐中国移动设计院"极简站"成套图纸：
 *   01 机房布置平面图 / 02 综合柜立面图 / 03 机房导线路由布置示意图
 *   04 天馈线系统安装示意图 / 05~06 工艺要求及施工安全措施说明图（一）（二）
 * 世界坐标：毫米（mm），Y 向上，A3 横向图幅 21000×14850（1:50）
 * DPaper 图元流同时供 Canvas 预览与 DXF（Dxf.buildMM）输出。
 * ============================================================ */
(function () {
  "use strict";

  /* ---------- 图幅常量 ---------- */
  var SW = 21000, SH = 14850;                 // 外框
  var FX0 = 2500, FX1 = 20500, FY0 = 500, FY1 = 14350; // 内框

  var INK = "#2b3440", GRAY = "#6b7684", LGRAY = "#9aa4ae";
  var RED = "#c0392b", GREEN = "#1e8449", BLUE = "#1b66c9", YEL = "#b8860b";
  var CABLE_PWR = "#c0392b", CABLE_GND = "#1e8449", CABLE_OPT = "#0e7490";

  /* 天线三态样式 */
  var ST3 = {
    "新增": { color: RED,   w: 14,  dash: null },
    "原有": { color: INK,   w: 6,   dash: null },
    "拆除": { color: RED,   w: 8,   dash: [900, 500] },
    "替换": { color: GREEN, w: 10,  dash: null }
  };

  /* ---------- 文本宽度估算（中文字宽=字高，ASCII=0.55字高） ---------- */
  function tw(s, h) {
    s = String(s); h = h || 175;
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? h : h * 0.55;
    return w;
  }
  function wrap(str, h, maxW) {
    str = String(str); h = h || 175;
    var out = [];
    String(str).split("\n").forEach(function (seg) {
      var cur = "";
      for (var i = 0; i < seg.length; i++) {
        var test = cur + seg[i];
        if (tw(test, h) > maxW && cur) { out.push(cur); cur = seg[i]; }
        else cur = test;
      }
      out.push(cur);
    });
    return out;
  }

  /* ============================================================
   * DPaper：毫米制图元流（Y 向上）
   ============================================================ */
  function DPaper() { this.rec = []; }
  var PP = DPaper.prototype;
  PP.line = function (x1, y1, x2, y2, o) {
    o = o || {};
    this.rec.push({ t: "line", x1: x1, y1: y1, x2: x2, y2: y2, color: o.color || INK, w: o.w || 6, dash: o.dash || null });
  };
  PP.rect = function (x, y, w, h, o) { /* x,y=左下角 */
    o = o || {};
    /* 注意：线宽存入 lw，避免与几何宽度 w 重名覆盖（原 bug 导致矩形塌缩成细条） */
    this.rec.push({ t: "rect", x: x, y: y, w: w, h: h, fill: o.fill || null, color: o.color || INK, lw: o.w || 6, dash: o.dash || null });
  };
  PP.circle = function (x, y, r, o) {
    o = o || {};
    this.rec.push({ t: "circle", x: x, y: y, r: r, fill: o.fill || null, color: o.color || INK, w: o.w || 6, dash: o.dash || null });
  };
  PP.poly = function (pts, o) {
    o = o || {};
    this.rec.push({ t: "poly", pts: pts, fill: o.fill || null, color: o.color || INK, w: o.w || 6, dash: o.dash || null, closed: o.closed !== false });
  };
  PP.text = function (str, x, y, o) { /* y=基线；o.dodge=true 时出图阶段参与文字避让 */
    o = o || {};
    var h = o.h || 175;
    this.rec.push({ t: "text", x: x, y: y, str: String(str), h: h, align: o.align || "left", color: o.color || INK, bold: !!o.bold, dodge: !!o.dodge });
    return tw(str, h);
  };
  /* 多行文字，返回实际占用高度 */
  PP.textW = function (str, x, y, maxW, o) {
    o = o || {};
    var h = o.h || 175, lh = (o.lh || 1.45) * h;
    var lines = wrap(str, h, maxW);
    for (var i = 0; i < lines.length; i++) this.text(lines[i], x, y - i * lh, o);
    return lines.length * lh;
  };
  /* 表格：x 左边缘，yTop 顶边，cols=[{t,w}]，rows=[[..]] */
  PP.table = function (x, yTop, cols, rows, o) {
    o = o || {};
    var hdrH = o.hdrH || 550, rowH = o.rowH || 450, fs = o.fs || 180;
    var totalW = 0;
    cols.forEach(function (c) { totalW += c.w; });
    /* 表头 */
    this.rect(x, yTop - hdrH, totalW, hdrH, { color: GRAY, w: 8 });
    var cx = x;
    cols.forEach(function (c) {
      this.rect(cx, yTop - hdrH, c.w, hdrH, { color: LGRAY, w: 3 });
      this.text(c.t, cx + c.w / 2, yTop - hdrH / 2 + fs * 0.36, { h: fs, align: "center", bold: true });
      cx += c.w;
    }, this);
    /* 行 */
    rows.forEach(function (r, ri) {
      var ry = yTop - hdrH - (ri + 1) * rowH;
      this.line(x, ry, x + totalW, ry, { color: LGRAY, w: 3 });
      var cx2 = x;
      cols.forEach(function (c, ci) {
        this.line(cx2, ry, cx2, ry + rowH, { color: LGRAY, w: 3 });
        var v = r[ci] === undefined || r[ci] === null ? "" : String(r[ci]);
        var lines = wrap(v, fs, c.w - 120);
        var lh = fs * 1.2;
        var y0 = ry + rowH / 2 + (lines.length - 1) * lh / 2 + fs * 0.36;
        for (var li = 0; li < lines.length; li++) {
          this.text(lines[li], c.w < 900 ? cx2 + c.w / 2 : cx2 + 60, y0 - li * lh, { h: fs, align: c.w < 900 ? "center" : "left" });
        }
        cx2 += c.w;
      }, this);
    }, this);
    var bottom = yTop - hdrH - rows.length * rowH;
    this.rect(x, bottom, totalW, yTop - bottom, { color: GRAY, w: 8 });
    return bottom;
  };

  /* ============================================================
   * 图框 + 设计院标题栏
   ============================================================ */
  function frame(p, o) {
    o = o || {};
    var st = o.st || {};
    /* 双图框 */
    p.rect(0, 0, SW, SH, { color: INK, w: 16 });
    p.rect(FX0, FY0, FX1 - FX0, FY1 - FY0, { color: INK, w: 10 });
    /* 图框内顶部大标题 */
    var title = (st.name || "") + (o.sheetName || "");
    p.text(title, SW / 2, FY1 - 700, { h: 420, align: "center", bold: true, color: INK });
    p.line(FX0 + 200, FY1 - 1100, FX1 - 200, FY1 - 1100, { color: GRAY, w: 6 });

    /* 注：站址/经纬度并入下方标题栏左列（不再占用左上绘图区，避免与图内容重叠） */

    /* ---- 标题栏（右下 6000×3800，y: FY0 ~ FY0+3800） ---- */
    var tx = 14500, ty = FY0, twd = FX1 - tx, thd = 3800;
    p.rect(tx, ty, twd, thd, { color: INK, w: 12 });
    /* 上格：设计院（y 3100~4300） */
    p.line(tx, ty + 3100, tx + twd, ty + 3100, { color: INK, w: 8 });
    p.text("中国移动通信集团设计院有限公司", tx + twd / 2, ty + 3720, { h: 280, align: "center", bold: true });
    /* 中格：项目 + 图名（y 2100~3100） */
    p.line(tx, ty + 2100, tx + twd, ty + 2100, { color: INK, w: 8 });
    p.text(st.projName || "", tx + twd / 2, ty + 2850, { h: 200, align: "center", color: GRAY });
    var sheetLines = wrap(o.sheetName || "", 290, twd - 400);
    var sy = ty + 2480;
    sheetLines.slice(0, 2).forEach(function (sl) { p.text(sl, tx + twd / 2, sy, { h: 280, align: "center", bold: true }); sy -= 330; });
    /* 下格（y 500~2100，高1600）：左列站址/图号/日期，右列签署 */
    p.line(tx + 2500, ty, tx + 2500, ty + 2100, { color: INK, w: 8 });
    var lx = tx + 130;
    var iy2 = ty + 1930;
    wrap("站址：" + (st.addr || "—"), 160, 2270).slice(0, 2).forEach(function (ln) {
      p.text(ln, lx, iy2, { h: 160, color: GRAY }); iy2 -= 240;
    });
    if (st.lon && st.lat) {
      p.text("经度" + st.lon + "°  纬度" + st.lat + "°", lx, iy2, { h: 150, color: GRAY }); iy2 -= 220;
    }
    var dnoLines = wrap(String(o.drawingNo || "—"), 150, 2270).slice(0, 2);
    dnoLines.forEach(function (ln) { p.text(ln, lx, iy2, { h: 150, bold: true }); iy2 -= 230; });
    p.text((o.date || "") + "  比例" + (o.scale || "1:50") + "  单位mm", lx, ty + 300, { h: 155 });
    /* 签署栏：3 行 2 列 */
    var rx = tx + 2500;
    p.line(rx, ty + 1430, tx + twd, ty + 1430, { color: INK, w: 6 });
    p.line(rx, ty + 760, tx + twd, ty + 760, { color: INK, w: 6 });
    p.line(rx + 1750, ty, rx + 1750, ty + 2100, { color: INK, w: 6 });
    p.line(rx + 1750, ty + 1430, rx + 1750, ty + 2100, { color: GRAY, w: 4 });
    p.line(rx + 1750, ty + 760, rx + 1750, ty + 1430, { color: GRAY, w: 4 });
    function sign(x, y, label, val) {
      p.text(label, x, y + 260, { h: 170, color: GRAY });
      p.text(val || "", x + 620, y + 260, { h: 195 });
    }
    sign(rx + 100, ty + 1430, "项目总负责人", (o.sign && o.sign.chief) || "");
    sign(rx + 1850, ty + 1430, "专业负责人", (o.sign && o.sign.major) || "");
    sign(rx + 100, ty + 760, "设  计  人", (o.sign && o.sign.designer) || st.survey || "");
    sign(rx + 1850, ty + 760, "校  审  人", (o.sign && o.sign.checker) || "");
    sign(rx + 100, ty + 90, "专业审核人", (o.sign && o.sign.reviewer) || "");
    return p;
  }

  /* ---------- 图名编号 ---------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ============================================================
   * 图型 04：天馈线系统安装示意图
   ============================================================ */
  function antSheet(st, kit, seq) {
    var p = new DPaper();
    frame(p, { st: st, sheetName: "无线基站天馈线系统安装示意图", drawingNo: st.projNo + "-" + pad2(seq), date: st.date || todayStr(), scale: "1:50" });

    var meta = window.TowerTemplates.meta(st);
    var isRoof = (st.towerKey === "roofpole" || st.towerKey === "roofplat");
    var totalM = meta.totalH;                    // 米
    var cx = 7200, gy = 4800;                    // 立面塔中心/地面
    var k = 6600 / (totalM * 1000);              // 米→图面mm 系数（塔顶+避雷针不进图名区）

    /* ---- 挂高标尺（左侧，真实标高值） ---- */
    var rx = 3600;
    var topPx = gy + totalM * 1000 * k;
    p.line(rx, gy, rx, topPx, { color: GRAY, w: 5 });
    var stepM = totalM > 30 ? 10 : (totalM > 15 ? 5 : 2);
    for (var e = 0; e <= totalM + 0.01; e += stepM) {
      var yy = gy + e * 1000 * k;
      p.line(rx, yy, rx - 350, yy, { color: GRAY, w: 3 });
      p.text(String(Math.round(e * 1000)), rx - 430, yy + 80, { h: 150, align: "right", color: GRAY });
    }
    p.text("标高(mm)", rx, topPx + 280, { h: 160, color: GRAY });

    /* ---- 楼顶站：建筑物 ---- */
    if (isRoof && st.supH) {
      var bw = 7000, bh = st.supH * 1000 * k;
      p.rect(cx - bw / 2, gy, bw, bh, { color: INK, w: 8 });
      var floors = Math.max(1, Math.round(st.supH / 3));
      for (var f = 1; f < floors; f++) {
        var fy = gy + bh * f / floors;
        p.line(cx - bw / 2, fy, cx + bw / 2, fy, { color: LGRAY, w: 3, dash: [500, 350] });
        p.text("第" + f + "层", cx + bw / 2 + 250, fy + 80, { h: 170, color: GRAY, dodge: true });
      }
      p.text((st.roomLoc ? "机房：" + st.roomLoc + "    " : "") + "支承物高度 " + st.supH + "m", cx, gy + bh + 350, { h: 200, align: "center", color: GRAY, dodge: true });
    }

    /* ---- 塔桅（简化示意） ---- */
    var baseHalf = (meta.baseHalfW || 0.8) * 1000 * k;
    var towerTop = gy + totalM * 1000 * k;
    var key = st.towerKey;
    if (key === "monopole" || key === "tripod" || key === "tree" || key === "lamp" || key === "water") {
      p.poly([[cx - baseHalf, gy], [cx - 130, towerTop], [cx + 130, towerTop], [cx + baseHalf, gy]], { color: INK, w: 20, closed: false });
      for (var s = 1; s <= 3; s++) {
        var sy2 = gy + (towerTop - gy) * s / 4;
        var w2 = baseHalf * (1 - s / 4) + 130;
        p.line(cx - w2, sy2, cx + w2, sy2, { color: GRAY, w: 8 });
      }
    } else if (key === "lattice" || key === "roofplat") {
      p.poly([[cx - baseHalf, gy], [cx - 260, towerTop]], { color: INK, w: 16, closed: false });
      p.poly([[cx + baseHalf, gy], [cx + 260, towerTop]], { color: INK, w: 16, closed: false });
      for (var s3 = 0; s3 < 5; s3++) {
        var y1 = gy + (towerTop - gy) * s3 / 5, y2 = gy + (towerTop - gy) * (s3 + 1) / 5;
        var w1 = baseHalf * (1 - s3 / 5) + 260, w3 = baseHalf * (1 - (s3 + 1) / 5) + 260;
        if (s3 % 2 === 0) { p.line(cx - w1, y1, cx + w3, y2, { color: GRAY, w: 7 }); p.line(cx + w1, y1, cx - w3, y2, { color: GRAY, w: 7 }); }
        p.line(cx - w1, y1, cx + w1, y1, { color: GRAY, w: 7 });
      }
    } else if (key === "guyed") {
      p.rect(cx - 90, gy, 180, towerTop - gy, { color: INK, w: 12 });
      [0.35, 0.6, 0.85].forEach(function (r) {
        var ay = gy + (towerTop - gy) * r;
        p.line(cx - 90, ay, cx - 4600, gy + (towerTop - gy) * r * 0.12, { color: GRAY, w: 6, dash: [500, 350] });
        p.line(cx + 90, ay, cx + 4600, gy + (towerTop - gy) * r * 0.12, { color: GRAY, w: 6, dash: [500, 350] });
      });
    } else if (key === "hpole") {
      [-420, 420].forEach(function (dx) {
        p.rect(cx + dx - 60, gy, 120, towerTop - gy, { color: INK, w: 12 });
      });
      p.line(cx - 700, towerTop, cx + 700, towerTop, { color: INK, w: 16 });
    } else { /* roofpole */
      p.rect(cx - 90, gy + 900, 180, towerTop - gy - 900, { color: INK, w: 12 });
      p.poly([[cx - 900, gy], [cx - 90, gy + 900]], { color: INK, w: 12, closed: false });
      p.poly([[cx + 900, gy], [cx + 90, gy + 900]], { color: INK, w: 12, closed: false });
    }
    /* 塔底标注 */
    p.text("塔型：" + st.towerLabel + "    塔高 " + st.height + "m" + (isRoof && st.supH ? "（不含支承物）" : ""), cx, gy - 450, { h: 210, align: "center", dodge: true });

    /* ---- 避雷针 + GNSS ---- */
    p.line(cx, towerTop, cx, towerTop + 1400, { color: INK, w: 7 });
    p.circle(cx, towerTop + 1500, 70, { color: INK, w: 5 });
    p.text("避雷针", cx + 250, towerTop + 1250, { h: 180, color: GRAY, dodge: true });

    /* ---- 平台 + 天线（三态） ---- */
    var antW = 450 * k * 1.6, antH = 2100 * k * 1.6;  // 视觉放大1.6倍保证可读
    (st.platforms || []).slice().sort(function (a, b) { return a.no - b.no; }).forEach(function (pl) {
      var py = gy + pl.elev * 1000 * k;
      var barW = Math.max(1800, (pl.poles.length * 1400 + 600));
      /* 平台梁 */
      p.line(cx - barW / 2, py, cx + barW / 2, py, { color: INK, w: 18 });
      /* 平台标注（右侧） */
      p.text("第" + pl.no + "平台  标高" + Math.round(pl.elev * 1000), cx + barW / 2 + 300, py + 130, { h: 190, color: GRAY, dodge: true });
      /* 抱杆 + 天线 */
      var n = 0;
      pl.poles.forEach(function (po) {
        var px = cx - barW / 2 + 700 + n * 1400;
        p.line(px, py, px, py + antH + 350, { color: INK, w: 10 });
        var cur = px - (po.items.length * (antW + 120)) / 2;
        po.items.forEach(function (it) {
          var style = it.op.home ? (ST3[it.status] || ST3["新增"]) : { color: LGRAY, w: 9, dash: null };
          for (var ai = 0; ai < it.count; ai++) {
            p.rect(cur, py + 350, antW, antH, { color: style.color, w: Math.max(style.w, 12), dash: style.dash });
            cur += antW + 120;
          }
          /* 标注 */
          var label;
          if (it.op.home) {
            label = (it.status === "新增" ? "" : it.status) + (it.ran || "5G") + "×" + it.count;
            if (it.azimuth !== null && it.azimuth !== undefined) label += " R" + it.azimuth + "°";
          } else {
            label = it.op.short;
          }
          p.text(label, px, py + antH + 550, { h: 175, align: "center", color: style.color, dodge: true });
          n++;
        });
      });
    });
    /* GNSS 天线（塔顶下 0.5m） */
    var gnsY = towerTop - 500;
    p.line(cx + 420, gnsY, cx + 420, gnsY + 380, { color: RED, w: 8 });
    p.circle(cx + 420, gnsY + 460, 120, { color: RED, w: 9 });
    p.text("新增GNSS天线", cx + 680, gnsY + 480, { h: 175, color: RED, dodge: true });

    /* ---- I-I 剖切符号（钉制在图框内） ---- */
    var sxs = [Math.max(cx - 5300, FX0 + 400), Math.min(cx + 5300, FX1 - 400)];
    sxs.forEach(function (sx) {
      p.line(sx, gy + 200, sx, gy + 1000, { color: INK, w: 26 });
      p.text("I", sx, gy + 1350, { h: 300, align: "center", bold: true });
    });

    /* ---- 俯视图（右上） ---- */
    var px0 = 13200, py0 = 9800, pw = 6800, ph = 3800;
    p.rect(px0, py0, pw, ph, { color: GRAY, w: 7 });
    p.text("天馈安装俯视图（0°=正北）", px0 + pw / 2, py0 + ph - 250, { h: 230, align: "center", bold: true });
    var pcx = px0 + pw / 2, pcy = py0 + ph / 2 - 200, pR = 1250;
    p.line(pcx, pcy + pR + 150, pcx, pcy + pR + 420, { color: INK, w: 6 });
    p.poly([[pcx - 130, pcy + pR + 380], [pcx + 130, pcy + pR + 380], [pcx, pcy + pR + 600]], { color: INK, closed: true });
    p.text("N", pcx + 220, pcy + pR + 480, { h: 210, bold: true });
    p.circle(pcx, pcy, 160, { color: INK, w: 6 });
    var colors = [BLUE, GREEN, YEL, "#8a5aa6"];
    (st.platforms || []).slice().sort(function (a, b) { return a.no - b.no; }).forEach(function (pl, pi) {
      var rr = pR * (0.4 + 0.6 * ((st.platforms.length > 1 ? pl.no - 1 : 0) / Math.max(1, st.platforms.length - 1)));
      p.circle(pcx, pcy, rr, { color: colors[pi % colors.length], w: 4, dash: [500, 350] });
      pl.poles.forEach(function (po) {
        var it0 = po.items[0] || {};
        var az = (it0.azimuth !== null && it0.azimuth !== undefined) ? it0.azimuth : 0;
        var a = az * Math.PI / 180;
        var ex = pcx + Math.sin(a) * rr, ey = pcy + Math.cos(a) * rr;
        var sty = it0.op && it0.op.home ? (ST3[it0.status] || ST3["新增"]) : { color: LGRAY, w: 5 };
        p.circle(ex, ey, 100, { color: sty.color, w: sty.w });
        p.line(ex, ey, pcx + Math.sin(a) * (rr + 380), pcy + Math.cos(a) * (rr + 380), { color: sty.color, w: sty.w });
      });
      p.text("平台" + pl.no, pcx + rr * 0.72 + 60, pcy + rr * 0.72 + 60, { h: 175, color: colors[pi % colors.length], dodge: true });
    });

    /* ---- 天馈材料表（右中，动态行高：底不低于 4500 避开标题栏） ---- */
    var mx = 13200;
    p.text("5G天馈线系统安装加固材料表", mx, 9700, { h: 250, bold: true });
    var mats = (kit && kit.materials) ? kit.materials : (window.DataModel.defaultMaterials ? window.DataModel.defaultMaterials(st) : []);
    var cols = [{ t: "序号", w: 500 }, { t: "名称", w: 2100 }, { t: "规格", w: 1600 }, { t: "单位", w: 600 }, { t: "新增", w: 1000 }, { t: "拆除", w: 1000 }];
    var rows = mats.map(function (m, i) { return [i + 1, m.name, m.spec || "", m.unit || "", m.add || "", m.rmv || ""]; });
    var mtN = Math.max(Math.min(rows.length, 24), 1);
    var mtRowH = Math.max(190, Math.min(238, Math.floor((9420 - 420 - 4500) / mtN)));
    p.table(mx, 9420, cols, rows.slice(0, mtN), { hdrH: 420, rowH: mtRowH, fs: mtRowH < 205 ? 128 : 150 });
    if (rows.length > mtN) {
      p.text("注：其余 " + (rows.length - mtN) + " 项材料略。", mx, 9500, { h: 150, color: GRAY });
    }

    /* ---- 说明（左下） ---- */
    var ny = 4150;
    p.text("说明：", 3200, ny, { h: 230, bold: true });
    var notes = [
      "1. 本基站为" + (st.nature || "改造") + "基站" + (st.note ? "。" + st.note : "。"),
      "2. 天馈线和天线支撑杆应做好防雷接地，所有天线应在避雷针45°角保护范围内，防雷接地电阻不大于10Ω。",
      "3. 各类线缆接地应顺着馈线下行方向，接地线弯曲角度大于90°、曲率半径大于130mm，各小区接地点分开接地。",
      "4. 拆除的线缆两端应做好绝缘防护和标记，按规格、型号、长度分类依次盘好，整齐摆放到指定地点。",
      "5. 基站地址为：" + (st.addr || "") + "。",
      "6. 涉及高处作业、塔上作业、拆除作业，安全注意事项详见工艺要求及施工安全措施说明图。"
    ];
    var nyy = ny - 420;
    notes.forEach(function (t) { nyy -= p.textW(t, 3200, nyy, 9300, { h: 190, lh: 1.32 }) + 110; });
    return p;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "." + ("0" + (d.getMonth() + 1)).slice(-2);
  }

  /* ============================================================
   * 图型 03：机房导线路由布置示意图
   ============================================================ */
  function routeSheet(st, kit, seq) {
    var p = new DPaper();
    frame(p, { st: st, sheetName: "无线基站机房导线路由布置示意图", drawingNo: st.projNo + "-" + pad2(seq), date: st.date || todayStr(), scale: "1:50" });

    /* ---- 设备框 ---- */
    function box(x, y, w, h, label, o) {
      o = o || {};
      p.rect(x, y, w, h, { color: INK, w: o.w || 9 });
      var lines = wrap(label, o.fs || 200, w - 200);
      var lh = (o.fs || 200) * 1.25;
      var y0 = y + h / 2 + (lines.length - 1) * lh / 2 + (o.fs || 200) * 0.36;
      lines.forEach(function (ln) { p.text(ln, x + w / 2, y0, { h: o.fs || 200, align: "center", dodge: !!o.dodge }); y0 -= lh; });
    }
    /* 综合柜（含子格）：标签参与避让（电缆走线穿设备区的治理） */
    box(3500, 3000, 3000, 3600, "", {});
    box(3650, 5300, 2700, 1100, "直流分配单元", { fs: 190, dodge: true });
    box(3650, 3200, 2700, 1800, "BBU 设备", { fs: 220, dodge: true });
    p.text("综合柜", 5000, 6660, { h: 210, align: "center", dodge: true });
    box(3500, 6900, 3000, 500, "综合柜地排", { fs: 180, dodge: true });
    box(7600, 5300, 3000, 1100, "高频开关组合电源", { fs: 190, dodge: true });
    box(7600, 7600, 3000, 600, "室内地排", { fs: 190, dodge: true });
    box(7600, 9600, 3000, 600, "ODF", { fs: 210, dodge: true });
    box(7600, 11600, 3000, 600, "传输设备", { fs: 210, dodge: true });
    box(3500, 11300, 3000, 600, "GNSS 天线", { fs: 200, color: RED, dodge: true });
    box(3500, 12700, 3000, 600, "AAU（塔上）", { fs: 200, dodge: true });
    p.text("▲ 塔侧设备", 5000, 13650, { h: 190, align: "center", color: GRAY, dodge: true });

    /* ---- 锚点匹配 ---- */
    var ANCHORS = [
      [/AAU/, [5000, 12700]],
      [/GNSS|GPS/, [5000, 11900]],
      [/室内地排/, [9100, 7600]],
      [/综合柜地排/, [5000, 7300]],
      [/直流分配/, [5000, 6400]],
      [/BBU\s*设备外壳/, [4300, 3000]],
      [/BBU/, [5000, 5000]],
      [/高频开关|组合电源|开关电源/, [9100, 6400]],
      [/传输/, [9100, 12200]],
      [/ODF/, [9100, 10200]],
      [/综合柜/, [3500, 4800]],
      [/./, [5000, 5300]]
    ];
    function anchor(t) {
      t = String(t || "");
      for (var i = 0; i < ANCHORS.length; i++) if (ANCHORS[i][0].test(t)) return ANCHORS[i][1];
      return [5000, 5300];
    }
    function cableType(spec, from, to) {
      var s = String(spec || "") + from + to;
      if (/地排|接地/.test(s)) return "GND";
      if (/跳纤|跳线|光缆|馈线/.test(s)) return "OPT";
      return "PWR";
    }
    var CTYPE = {
      PWR: { color: CABLE_PWR, w: 8, dash: null, label: "电源线" },
      GND: { color: CABLE_GND, w: 6, dash: [700, 350], label: "地线" },
      OPT: { color: CABLE_OPT, w: 6, dash: [200, 250, 500, 250], label: "光缆" }
    };
    var cables = (kit && kit.cables) || [];
    cables.forEach(function (cb) {
      var a = anchor(cb.from), b = anchor(cb.to);
      var ty = cableType(cb.spec, cb.from, cb.to);
      var st2 = CTYPE[ty];
      var midX = (a[0] + b[0]) / 2;
      p.line(a[0], a[1], midX, a[1], st2);
      p.line(midX, a[1], midX, b[1], st2);
      p.line(midX, b[1], b[0], b[1], st2);
      /* 导线编号圆标 */
      var mx2 = midX, my2 = (a[1] + b[1]) / 2;
      p.circle(mx2, my2, 330, { color: INK, w: 6, fill: "#ffffff" });
      p.text(cb.no || "", mx2, my2 - 70, { h: 240, align: "center", bold: true });
    });

    /* ---- 底部图例 + 说明 ---- */
    var ly = 2400;
    p.text("图例：", 3200, ly, { h: 220, bold: true });
    var lx = 4200;
    Object.keys(CTYPE).forEach(function (k) {
      var c2 = CTYPE[k];
      p.line(lx, ly - 70, lx + 1300, ly - 70, c2);
      p.text(c2.label, lx + 1450, ly, { h: 200 });
      lx += 2900;
    });
    p.text("注：1.线缆布放须符合施工图设计要求，交直流馈电电缆分开布放。", 3200, ly - 550, { h: 195 });
    p.text("2.电源线两端铜鼻子焊接（压接）牢固，两端明确标识。", 3200, ly - 880, { h: 195 });
    p.text("3.带编号的电力电缆长度及型号详见电力电缆明细表。", 3200, ly - 1210, { h: 195 });

    /* ---- 右区：电缆明细表 ---- */
    var mx = 12700, mw = 7300;
    p.text("5G电力电缆明细表", mx, 14050, { h: 260, bold: true });
    var cols = [
      { t: "导线\n编号", w: 550 }, { t: "由", w: 1250 }, { t: "到", w: 1200 }, { t: "敷设\n方式", w: 750 },
      { t: "导线规格", w: 1550 }, { t: "条数", w: 500 }, { t: "长度\n(米/条)", w: 800 }, { t: "外皮颜色", w: 700 }
    ];
    var rows = cables.map(function (cb) { return [cb.no, cb.from, cb.to, cb.way, cb.spec, cb.n, cb.len, cb.color]; });
    /* 动态行高：表格底不低于 6900，避免与右下汇总表标题叠加 */
    var cbN = Math.max(rows.length, 1);
    var cbRowH = Math.max(420, Math.min(700, Math.floor(6150 / cbN)));
    var tblBottom = p.table(mx, 13750, cols, rows, { hdrH: 700, rowH: cbRowH, fs: cbRowH < 560 ? 150 : 170 });

    /* ---- 安装量 / 拆除量汇总（右区下部） ---- */
    var sumTop = 6400;
    p.text("电力电缆安装量 / 拆除量汇总", mx, sumTop + 200, { h: 220, bold: true });
    var totalN = 0, totalLen = 0;
    cables.forEach(function (cb) {
      totalN += parseFloat(cb.n) || 0;
      var l = parseFloat(cb.len) || 0;
      if (l) totalLen += l * (parseFloat(cb.n) || 0);
    });
    var cols2 = [{ t: "类别", w: 1300 }, { t: "条数合计", w: 1500 }, { t: "长度合计(米)", w: 2100 }, { t: "备注", w: 2400 }];
    var rows2 = [
      ["安装量", totalN || "", totalLen ? Math.round(totalLen * 10) / 10 : "详见天馈图", "按明细表汇总"],
      ["拆除量", "", "", "本站无拆除量时留空"]
    ];
    p.table(mx, sumTop, cols2, rows2, { hdrH: 460, rowH: 520, fs: 180 });
    return p;
  }

  /* ============================================================
   * 图型 01：机房布置平面图（含安装工作量表）
   ============================================================ */
  function planSheet(st, kit, seq) {
    var p = new DPaper();
    frame(p, { st: st, sheetName: "无线基站机房布置平面图", drawingNo: st.projNo + "-" + pad2(seq), date: st.date || todayStr(), scale: "1:50" });

    /* ---- 机房平面 ---- */
    var rx0 = 3800, ry0 = 5000, rw = 7400, rh = 5000;
    p.rect(rx0, ry0, rw, rh, { color: INK, w: 18 });
    /* 门（下边右侧） */
    var doorW = 1100, dx = rx0 + rw - doorW - 500;
    p.line(dx, ry0, dx + doorW, ry0, { color: "#ffffff", w: 22 });
    p.line(dx, ry0, dx, ry0 - 1100, { color: GRAY, w: 5 });
    p.circle(dx, ry0 - 1100, 1100, { color: GRAY, w: 4, dash: [400, 300] });
    p.text("门", dx + 550, ry0 - 1400, { h: 190, align: "center", color: GRAY });
    /* 设备块 3 行 4 列 */
    var devices = (kit && kit.devices) || [];
    var shown = devices.filter(function (d, i) { return i < 12; });
    shown.forEach(function (d, i) {
      var col = i % 4, row = Math.floor(i / 4);
      var bx = rx0 + 350 + col * 1780, by = ry0 + rh - 1500 - row * 1400;
      p.rect(bx, by, 1500, 850, { color: INK, w: 7 });
      p.circle(bx + 250, by + 850, 190, { color: INK, w: 5 });
      p.text(String(i + 1), bx + 250, by + 850 - 70, { h: 210, align: "center", bold: true });
      var lines = wrap(d.name, 160, 1400);
      var y0 = by + 380 + (lines.length - 1) * 110;
      lines.slice(0, 2).forEach(function (ln) { p.text(ln, bx + 750, y0, { h: 160, align: "center" }); y0 -= 220; });
    });
    /* 走线架（顶部横线 + 中部竖线，不穿设备行） */
    p.line(rx0, ry0 + rh - 550, rx0 + rw, ry0 + rh - 550, { color: YEL, w: 6, dash: [600, 350] });
    p.line(rx0 + rw / 2, ry0, rx0 + rw / 2, ry0 + rh, { color: YEL, w: 6, dash: [600, 350] });
    p.text("走线架（宽500）", rx0 + rw / 2 + 200, ry0 + rh - 400, { h: 180, color: YEL });
    /* 馈线洞 */
    p.rect(rx0 + rw - 100, ry0 + rh / 2 + 400, 260, 500, { color: GRAY, w: 6 });
    p.text("馈线洞500×400", rx0 + rw + 350, ry0 + rh / 2 + 900, { h: 180, color: GRAY });
    p.text("下沿距地2100", rx0 + rw + 350, ry0 + rh / 2 + 600, { h: 180, color: GRAY });
    /* 指北针 */
    var nx = rx0 + rw - 350, ny = ry0 + rh + 700;
    p.line(nx, ny - 300, nx, ny + 300, { color: INK, w: 7 });
    p.poly([[nx - 130, ny + 260], [nx + 130, ny + 260], [nx, ny + 520]], { color: INK, closed: true });
    p.text("N", nx + 240, ny + 400, { h: 220, bold: true });
    /* 尺寸线 */
    p.line(rx0, ry0 - 500, rx0 + rw, ry0 - 500, { color: GRAY, w: 4 });
    p.text("机房轴线总长（现场实测）", rx0 + rw / 2, ry0 - 620, { h: 180, align: "center", color: GRAY });
    p.text("注：设备编号对应右侧「安装工作量表」序号。", 3800, 4100, { h: 195, color: GRAY });

    /* ---- 右区：安装工作量表（17 行内自适应，左缘避开馈线洞标注） ---- */
    var mx = 13300;
    p.text("安装工作量表", mx, 14100, { h: 250, bold: true });
    var cols = [
      { t: "序号", w: 450 }, { t: "名称", w: 1800 }, { t: "型号", w: 700 }, { t: "规格\n(宽×深×高)", w: 1000 },
      { t: "单位", w: 450 }, { t: "原有\n数量", w: 500 }, { t: "新增\n数量", w: 500 }, { t: "拆除\n数量", w: 500 }, { t: "备注", w: 800 }
    ];
    var rows = devices.map(function (d, i) { return [i + 1, d.name, d.model || "", d.spec || "", d.unit || "", d.old || "", d.add || "", d.rmv || "", d.note || ""]; });
    var wkN = Math.max(Math.min(rows.length, 17), 1);
    var wkRowH = Math.max(300, Math.min(440, Math.floor((13850 - 700 - 4500) / wkN)));
    p.table(mx, 13850, cols, rows.slice(0, wkN), { hdrH: 700, rowH: wkRowH, fs: wkRowH < 380 ? 150 : 165 });

    /* ---- 走线架小表（左下，避开标题栏） ---- */
    var wy = 3350;
    p.text("走线架安装量表", 3800, wy + 200, { h: 220, bold: true });
    var cols2 = [{ t: "序号", w: 500 }, { t: "设备名称及规格", w: 3300 }, { t: "单位", w: 600 }, { t: "新增数量", w: 1000 }];
    var rows2 = [["1", "水平走线架，宽500mm", "米", ""], ["2", "垂直走线架，宽500mm", "米", ""]];
    p.table(3800, wy, cols2, rows2, { hdrH: 450, rowH: 430, fs: 175 });

    /* ---- 说明（左下底部） ---- */
    p.text("说明：", 3800, 1780, { h: 210, bold: true });
    p.textW("1. 本图施工涉及涉电作业、设备搬运作业，施工注意事项详见工艺要求及施工安全措施说明图。", 3800, 1500, 9200, { h: 185 });
    p.textW("2. 机房设备布置为示意图，设备编号对应右侧「安装工作量表」序号，实施时按现场条件调整。", 3800, 1160, 9200, { h: 185 });
    p.textW("3. 新增、拆除数量以红色标注。", 3800, 820, { h: 185 });
    return p;
  }

  /* ============================================================
   * 图型 02：综合柜立面图
   ============================================================ */
  function cabSheet(st, kit, seq) {
    var p = new DPaper();
    frame(p, { st: st, sheetName: "无线基站综合柜立面图", drawingNo: st.projNo + "-" + pad2(seq), date: st.date || todayStr(), scale: "1:10" });

    /* ---- 柜体（600×2000 实物 ×5 放大） ---- */
    var bx = 6400, by = 2500, bw = 3000, bh = 10000;
    p.rect(bx - 100, by - 200, bw + 200, 200, { color: INK, w: 9 });      // 底座
    p.rect(bx, by, bw, bh, { color: INK, w: 16 });                        // 柜体
    p.line(bx + bw / 2, by, bx + bw / 2, by + bh, { color: LGRAY, w: 3, dash: [300, 300] }); // 双开门缝
    /* U 刻度（左侧，44U） */
    var uH = bh / 44;
    for (var u = 0; u <= 44; u += 4) {
      var uy = by + u * uH;
      p.line(bx - 200, uy, bx, uy, { color: GRAY, w: 3 });
      p.text(String(u), bx - 320, uy + 80, { h: 160, align: "right", color: GRAY });
    }
    p.text("U位", bx - 320, by + bh + 200, { h: 180, align: "right", color: GRAY });

    /* 设备块（从下往上：u0 起） */
    function dev(u0, u1, label, style, sub) {
      var y0 = by + u0 * uH, h2 = (u1 - u0) * uH;
      p.rect(bx + 60, y0, bw - 120, h2, { color: style.color, w: style.w, dash: style.dash });
      if (sub) {
        /* 面板分格（从下往上）：分格线用灰色，字高压至格内 */
        var n = sub.length, sh = h2 / n;
        sub.forEach(function (s, i) {
          p.line(bx + 60, y0 + (i + 1) * sh, bx + bw - 60, y0 + (i + 1) * sh, { color: GRAY, w: 3 });
          p.text(s, bx + bw / 2, y0 + i * sh + sh / 2 - 25, { h: 115, align: "center" });
        });
      } else {
        p.text(label, bx + bw / 2, y0 + h2 / 2 - 60, { h: 190, align: "center" });
      }
      /* 左侧引出标注 */
      var ly = y0 + h2 / 2;
      p.line(bx - 60, ly, bx - 1000, ly, { color: GRAY, w: 3 });
      p.text(label + (style.tag ? "（" + style.tag + "）" : ""), bx - 1100, ly + 60, { h: 185, align: "right", color: style.color });
    }
    var S_NEW = { color: RED, w: 16, tag: "新增" };
    var S_OLD = { color: GRAY, w: 6, tag: "原有" };
    var S_RMV = { color: RED, w: 9, dash: [900, 500], tag: "拆除" };
    var S_RES = { color: LGRAY, w: 4, dash: [250, 250], tag: "预留" };
    dev(0, 1.5, "直流分配单元", S_NEW);
    dev(2, 5, "BBU", S_RMV, ["FANf", "UMPTg", "UBBP", "UPEUe"]);
    dev(6, 8.5, "原有DCDU", S_OLD);
    dev(9, 10.5, "6波无源波分", S_NEW);
    dev(12, 20, "预留机位", S_RES);
    /* 柜体底部标注 */
    p.text("综合柜 " + (st.cabSize || "600X600X2000") + "mm（宽×深×高）", bx + bw / 2, by - 700, { h: 210, align: "center" });
    p.text("1U = 44.45mm    安装螺栓 M6×4", bx + bw / 2, by - 1050, { h: 190, align: "center", color: GRAY });

    /* ---- 右区：说明 + 风险表 ---- */
    var mx = 12200;
    p.text("说明：", mx, 13600, { h: 230, bold: true });
    var notes = [
      "1. 本机架外尺寸：" + (st.cabSize || "600X600X2000") + "mm（宽×深×高），图中设备粗线表示本期新增，需占用1U的位置。",
      "2. 安装设备时，需满足直流分配单元上方净高≥1U（1U=44.45mm），满足散热。",
      "3. 图中BBU、直流分配单元、无源波分设备面板图加粗部分表示本期新增。",
      "4. 图中设备在综合柜中安装使用的螺栓规格为M6，数量各4个。",
      "5. 本图施工涉及涉电作业、设备搬运作业，施工注意事项详见工艺要求及施工安全措施说明图。"
    ];
    var ny = 13250;
    notes.forEach(function (t) { ny -= p.textW(t, mx, ny, 7700, { h: 195, lh: 1.35 }) + 150; });

    /* 风险因素及处置措施 */
    var ry = Math.min(ny - 600, 10300);
    p.text("风险因素及处置措施：", mx, ry + 160, { h: 230, bold: true });
    var cols = [{ t: "编号", w: 500 }, { t: "风险因素", w: 2600 }, { t: "处置方案", w: 3800 }];
    var rows = [
      ["1", "带电更换电器附件", "施工人员需做好绝缘措施，同时施工现场需有人守护。"],
      ["2", "机械不当操作", "严格按照机电工具的操作规程进行施工，避免不当及野蛮施工。"],
      ["3", "电源负荷超载", "施工中设备加电前应检查极性及相位，并记录在案。"],
      ["4", "不检查电源极性及相位", "核对直流电源极性，交流电源核对A、B、C相位。"]
    ];
    p.table(mx, ry, cols, rows, { hdrH: 500, rowH: 900, fs: 185 });

    /* 图例（左下，避开标题栏） */
    var gy2 = 1750;
    p.text("图例：", 2600, gy2 + 350, { h: 210, bold: true });
    var items = [
      ["新增设备", S_NEW], ["原有设备", S_OLD], ["拆除设备", S_RMV], ["预留设备", S_RES]
    ];
    items.forEach(function (it, i) {
      var gx = 2600 + (i % 2) * 1500, gyy = gy2 - Math.floor(i / 2) * 620;
      p.rect(gx, gyy, 700, 300, { color: it[1].color, w: it[1].w, dash: it[1].dash });
      p.text(it[0], gx + 850, gyy + 230, { h: 185 });
    });
    return p;
  }

  /* ============================================================
   * 图型 05/06：工艺要求及施工安全措施说明图（一）（二）
   * 内容为设计院通用模板（要点化），仅站点信息段取变量。
   ============================================================ */
  var STD_LIST = [
    "GB/T 51369-2019《通信设备安装工程抗震设计标准》",
    "GB 51194-2016《通信电源设备安装工程设计规范》",
    "GB 50689-2011《通信局（站）防雷与接地工程设计规范》",
    "GB/T 51391-2019《通信工程建设环境保护技术标准》",
    "GB 50016-2014《建筑设计防火规范》",
    "GB 50201-2014《防洪标准》",
    "YD 5201-2014《通信建设工程安全生产操作规范》",
    "YD/T 5054-2019《通信建筑抗震设防分类标准》",
    "YD/T 5060-2019《通信设备安装抗震设计图集》",
    "YD/T 5230-2016《移动通信基站工程技术规范》",
    "YD 5003-2014《通信建筑工程设计规范》",
    "YD/T 5264-2021《数字蜂窝移动通信网5G无线网工程技术规范》"
  ];
  var SEC_P1 = [
    ["一、安全生产要求", [
      "1、建设单位应按《安全生产法》规定设置安全生产管理机构或配备专（兼）职安全管理人员，工程监理实施安全监督。",
      "2、施工企业应按建筑施工安全标准购置防护用具、落实安全措施，对施工人员进行安全教育和培训。"
    ]],
    ["二、一般规定", [
      "1、设备开箱注意包装标志，不得倒置；雨雪潮湿天气不得室外开箱。",
      "2、施工人员进入机房必须换穿工作鞋。",
      "3、机房内搬移设备不得损坏地板和其他设备。",
      "4、划定作业区域并做好标识；钻孔开凿采取防尘措施。",
      "5、不得触碰在运设备，严禁擅自关断电源开关和消防设施。",
      "6、严禁将交流电源线挂在通信设备上。",
      "7、施工工器具严禁使用机架内电源，使用前核实电源容量。",
      "8、铁架、机架、人字梯上不得放置工具器材。",
      "9、高处作业使用绝缘梯，严禁脚踩铁架机架走道。",
      "10、涉电作业用绝缘工具并由专业人员操作，防止金属落入设备引起短路。",
      "11、开剖线缆用力适度，剖刀刀口向下向外。"
    ]],
    ["三、设备机架安装和线缆布放", [
      "1、机架用膨胀螺栓对地加固，顶部与走线架上梁加固，抗震地区按要求加固。",
      "2、已运行设备旁安装机架防止碰撞原有设备。",
      "3、布放线缆不强拉硬拽，做好标识，电源线端头绝缘处理。",
      "4、铜鼻子规格符合要求，压接焊接可靠。",
      "5、连接电源线端头使用绝缘工具。",
      "6、光纤布放入槽或波纹管保护，做好标识，防止拔断在用光纤。",
      "7、拆除综合柜线缆跳线须经批准，报告维护部门监控。"
    ]]
  ];
  var SEC_P1B = [
    ["四、设备安装", [
      "1、按安装手册要求对设备安装加固。",
      "2、机架内设备与加固立柱加固，较大设备加托板支撑；加固件优先原厂配套。",
      "3、设备间距、托板不影响散热，架内留足散热空间。",
      "4、分路空开供电，电源直接接入空气开关；提供保护地线排。",
      "5、严禁多功能电源插座，禁止跨机架取电。",
      "6、插拔机盘佩戴防静电手环；歪针严禁螺丝刀矫正。"
    ]],
    ["五、设备加电测试", [
      "1、熔断器及空开容量符合设计要求，插拔熔断器用专用工具。",
      "2、加电前检查：无金属碎屑、正负极不接反短路、地线引接良好、熔丝规格符合要求。",
      "3、按用电管理流程申请批准后加电，沿电流方向逐级加电逐级测量。",
      "4、下电经批准，配电柜侧由电源维护人员操作或监督。",
      "5、插拔机盘戴防静电手环；仪表接地，测量不过载。",
      "6、光系统测试避免激光器正对人眼；线路测试先断开外缆连接。"
    ]]
  ];
  var SEC_P2 = [
    ["六、防雷接地要求", [
      "1、防雷器须经国家认可第三方检测合格。",
      "2、接地采用联合接地，地网工频接地电阻不大于10Ω。",
      "3、室外严禁架空线路，各类线缆宜埋地引入。",
      "4、配电设备正常不带电部分均应接地，严禁接零保护。",
      "5、保护地线单独从总接地汇流排引入，布放短直，严禁盘绕。",
      "6、接地线连接加装铜接线端子压（焊）牢固；接地线中严禁加装开关或熔断器。",
      "7、走线架及金属构件必须接地，各段电气连通。",
      "8、接地排及接地线用标签注明名称及连接设备；宜用黄绿双色电缆。",
      "9、缆线严禁系挂在避雷网避雷带上。",
      "10、直流拉远电源线用屏蔽电缆，屏蔽层两端接地；长度大于60m中部增加接地。"
    ]],
    ["七、抗震加固要求", [
      "1、架式设备底部与地面加固、顶部与列架上梁加固；8度及以上与楼板可靠联结。",
      "2、台式设备6～7度设防宜组合机架安装；8度及以上装抗震组合柜。",
      "3、自立式设备6～9度设防底部与地面加固，螺栓超M12时顶部加联结支撑。",
      "4、挂墙设备不得装于空心砌块墙或轻质隔墙；≤10kg且中心距墙≤150mm时可用4个不小于M10锚栓。",
      "5、锚栓按YD 5059-2005公式计算。本站7度设防，直流分配单元用4个M6锚栓与综合柜固定。"
    ]]
  ];
  var SEC_P2B = [
    ["八、消防安全", [
      "1、配置防火告警系统及灭火设备；机房改造不作装饰性装修，用不燃阻燃材料。",
      "2、施工完毕进线孔洞用防火材料封堵；易燃物随用随清运。",
      "3、装修用非燃烧材料，孔洞缝隙非燃烧材料密封。",
      "4、机房内严禁饮水吸烟，不得使用明火；严禁堆放易燃易爆物品。",
      "5、在运机房作业划定区域，不触碰在运设备、不关断电源开关。"
    ]],
    ["九、防洪要求", [
      "1、基站选地势较高、不受洪水影响、地形平坦土质稳定地点。",
      "2、机房基础做散水坡并涂抹防水材料，适当加高基础高度。"
    ]],
    ["十、环境保护", [
      "1、不得砍伐危害国家重点保护野生植物；严禁使用持久性有机污染物杀虫剂。",
      "2、保持噪声防治设施正常使用；及时清运固体废弃物并按规定处置。",
      "3、严禁向江河湖泊渠道水库倾倒堆放固体废弃物。",
      "4、电磁辐射超标区设栅栏警告标志控制进入；定期检查无线设施。"
    ]]
  ];
  var RISKS1 = [
    ["机房设备安装", "设备超重", "施工前做好承重核实，不符要求通知监理确定加固方案"],
    ["机房设备安装", "板卡拔插错误", "插拔电路板应戴防静电手腕"],
    ["机房设备安装", "不查电源极性相位", "送电前核实电源，通知、挂牌、看护"],
    ["机房设备安装", "插座插头漏电", "检查用电设备工具，更换老化设备"],
    ["机房设备安装", "墙块滑落", "核实墙面强度，钻孔防尘，完工清洁现场"],
    ["机房设备安装", "易燃易爆违规堆放", "分类放置远离火源，配备灭火器材"],
    ["搬运设备材料", "设备搬运碰撞", "搬运做好防护，电池电极向上严禁倒置"],
    ["施工全程", "安装操作失误", "误操作致故障立即还原原系统配置"],
    ["抗震加固", "未按规范抗震加固", "按抗震规范加固，经抗震性能检测合格"],
    ["设备加电", "加电不规范", "逐级加电、逐级测量"],
    ["机房设备安装", "梯子使用不规范", "高处施工用绝缘梯，严禁脚踩机架走道"],
    ["机房设备拆除", "拆除设备防护", "按拆除安全规定制定方案，包装保护运存"],
    ["布放各类线缆", "线缆施工不规范", "防缆盘滚落；电源线中间严禁接头；地线严禁加开关熔断器"]
  ];
  var RISKS2 = [
    ["天馈线系统安装", "高空安装设备", "持证上岗，安全帽安全带，气候不符严禁上塔"],
    ["天馈线系统安装", "高空物件掉落", "防护隔离，设警戒区，佩戴劳保用品"],
    ["天馈线系统安装", "天馈设备吊装", "专人指挥，系尾绳控制轨迹，与塔保持安全距离"],
    ["天馈线系统安装", "电源操作失误", "学习安全规范，按电源操作规范施工"],
    ["天馈线系统安装", "不查电源极性相位", "送电前核实电源，通知、挂牌、看护"],
    ["天馈线系统安装", "插座插头漏电", "检查用电设备工具，更换老化设备"],
    ["天馈线系统安装", "高压线附近建站", "核实高压安全距离，做好安全防范"],
    ["天馈线系统安装", "高温酒后作业", "不超负荷不疲劳不酒后作业"],
    ["天馈线系统安装", "恶劣天气", "雷雨强风大雾停止户外作业"],
    ["天馈线系统安装", "破坏已有天面设备", "不踩踏走线架馈线，做好防护"],
    ["天馈线系统安装", "杆塔安装不规范", "固定于实体天面，安装后做好防水"],
    ["设备搬运", "设备搬运碰撞", "搬运防护，电池电极向上"],
    ["天馈线系统安装", "未抗震加固", "天线与支撑杆连结不少于两处，AAU螺栓≥M8"],
    ["天馈线系统安装", "防雷接地不规范", "按规范做好天馈系统防雷接地"],
    ["天馈线系统安装", "有限空间作业", "先通风再检测后作业，严禁无防护监护作业"],
    ["天馈线系统安装", "易燃易爆有毒气体", "撤离报告，设警示围栏，修复后复工"],
    ["天馈线系统安装", "邻近道路施工", "设置施工围栏、安全标志牌"],
    ["天馈线系统拆除", "拆除设备防护", "制定拆除方案，人身防护，包装保护"],
    ["天馈线系统施工", "野外作业防护", "防暑防寒防滑，恶劣天气停止室外作业"],
    ["临时用电", "用电不规范", "按批准方案用绝缘护套导线，禁止乱拉乱接"]
  ];

  /* 节文字渲染：返回剩余 y（fs/gap 压缩以保证底部风险表空间） */
  function renderSections(p, x, y, width, sections) {
    var fs = 150, lh = 1.22, gap = 60, headGap = 200;
    sections.forEach(function (sec) {
      p.text(sec[0], x, y, { h: 210, bold: true });
      y -= 210 + headGap * 0.6;
      sec[1].forEach(function (item) {
        var used = p.textW(item, x, y, width, { h: fs, lh: lh });
        y -= used + gap;
      });
      y -= 120;
    });
    return y;
  }

  function safetySheet(st, kit, seq, part) {
    var p = new DPaper();
    var partName = part === 1 ? "（一）" : "（二）";
    frame(p, { st: st, sheetName: "工艺要求及施工安全措施说明图" + partName, drawingNo: st.projNo + "-施工安全措施说明" + partName, date: st.date || todayStr(), scale: "1:50" });

    if (part === 1) {
      /* 左栏：一~三节 */
      var leftBottom = renderSections(p, 3200, 13600, 3900, SEC_P1);
      /* 中栏：四~五节 */
      var midBottom = renderSections(p, 7600, 13600, 3900, SEC_P1B);
      /* 右栏上：强制性标准 */
      var mx = 12000;
      p.text("一. 本基站主要涉及的强制性标准及规范，需严格执行。", mx, 13900, { h: 215, bold: true });
      var cols = [{ t: "序号", w: 550 }, { t: "标准名称", w: 6950 }];
      var rows = STD_LIST.map(function (s, i) { return [i + 1, s]; });
      p.table(mx, 13500, cols, rows, { hdrH: 450, rowH: 480, fs: 175 });
      /* 底部横排：设备安装风险表（跨左/中栏下方，钉制避开右下标题栏区） */
      var stripTop = Math.min(leftBottom, midBottom) - 250;
      var rkN = RISKS1.length;
      var rkTop = stripTop - 340;
      var rkRowH = Math.max(240, Math.min(350, Math.floor((rkTop - 480 - 550) / rkN)));
      p.text("二. 本基站设备安装安全风险因素及保障措施", 3200, stripTop - 60, { h: 215, bold: true });
      var cols2 = [{ t: "序号", w: 450 }, { t: "作业环节", w: 1500 }, { t: "风险因素", w: 1900 }, { t: "处置方案及安全施工说明", w: 4450 }];
      var rows2 = RISKS1.map(function (r, i) { return [i + 1, r[0], r[1], r[2]]; });
      p.table(3200, rkTop, cols2, rows2, { hdrH: 480, rowH: rkRowH, fs: rkRowH < 300 ? 145 : 155 });
    } else {
      /* 左栏：六~七节 */
      renderSections(p, 3200, 13600, 3900, SEC_P2);
      /* 中栏：八~十节 + 站点说明 */
      var midBottom = renderSections(p, 7600, 13600, 3900, SEC_P2B);
      var sy2 = Math.min(midBottom - 300, 4300);
      p.text("二. 本基站安全生产一般规定", 7600, sy2, { h: 210, bold: true });
      var info = "本基站" + (st.nature || "改造") + "，站址：" + (st.addr || "");
      if (st.lon && st.lat) info += "（经度" + st.lon + "°，纬度" + st.lat + "°）";
      info += "。" + (st.note ? st.note : "");
      var sy3 = sy2 - 380;
      sy3 -= p.textW(info, 7600, sy3, 3900, { h: 180, lh: 1.3 }) + 180;
      sy3 -= p.textW("本站涉及高处作业、塔上作业、拆除作业、临时用电等环节，风险处置见右表；如遇未涵盖风险，应停止作业并报告监理。", 7600, sy3, 3900, { h: 180, lh: 1.3 });
      /* 右栏上：天馈风险表 20 行 */
      var mx = 12000;
      p.text("一. 本基站天馈线安装安全风险因素及保障措施", mx, 13900, { h: 215, bold: true });
      var cols = [{ t: "序号", w: 450 }, { t: "作业环节", w: 1550 }, { t: "风险因素", w: 1900 }, { t: "处置方案及安全施工说明", w: 2600 }];
      var rows = RISKS2.map(function (r, i) { return [i + 1, r[0], r[1], r[2]]; });
      p.table(mx, 13500, cols, rows, { hdrH: 470, rowH: 352, fs: 152 });
    }
    return p;
  }
  function safetySheet1(st, kit, seq) { return safetySheet(st, kit, seq, 1); }
  function safetySheet2(st, kit, seq) { return safetySheet(st, kit, seq, 2); }

  /* ============================================================
   * 整套导出：buildAll(st, index, kit) → [{name, seq, dxf}]
   ============================================================ */
  function buildAll(st, index, kit) {
    var sheets = [
      ["机房布置平面图", planSheet],
      ["综合柜立面图", cabSheet],
      ["机房导线路由布置示意图", routeSheet],
      ["天馈线系统安装示意图", antSheet],
      ["工艺要求及施工安全措施说明图（一）", safetySheet1],
      ["工艺要求及施工安全措施说明图（二）", safetySheet2]
    ];
    return sheets.map(function (s, i) {
      var paper = s[1](st, kit, i + 1);
      return { name: s[0], seq: i + 1, dxf: window.Dxf.buildMM(paper.rec, {}) };
    });
  }
  /* 单图生成（预览用） */
  function buildSheet(st, kit, sheetIndex) {
    var fns = [planSheet, cabSheet, routeSheet, antSheet, safetySheet1, safetySheet2];
    var i = Math.max(0, Math.min(fns.length - 1, sheetIndex));
    return { paper: fns[i](st, kit, i + 1), name: ["机房布置平面图", "综合柜立面图", "机房导线路由布置示意图", "天馈线系统安装示意图", "工艺要求及施工安全措施说明图（一）", "工艺要求及施工安全措施说明图（二）"][i] };
  }

  /* ============================================================
   * Canvas 预览渲染（mm→像素，Y 翻转）
   ============================================================ */
  function renderPreview(paper, canvas, bg) {
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    var k = Math.min(W / (SW + 800), H / (SH + 800));
    var ox = (W - SW * k) / 2, oy = (H - SH * k) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg || "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, -k, ox, oy + SH * k);
    paper.rec.forEach(function (e) { drawEnt(ctx, e); });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  function drawEnt(ctx, e) {
    var col = e.color || INK;
    ctx.save();
    if (e.t === "text") {
      ctx.translate(e.x, e.y);
      ctx.scale(1, -1);
      ctx.font = (e.bold ? "bold " : "") + Math.max(8, e.h) + "px 'Microsoft YaHei',sans-serif";
      ctx.fillStyle = col;
      ctx.textAlign = e.align || "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(String(e.str), 0, 0);
      ctx.restore();
      return;
    }
    ctx.strokeStyle = col;
    ctx.fillStyle = e.fill || col;
    ctx.lineWidth = Math.max(0.6, ((e.t === "rect" ? e.lw : e.w) || 6) * 0.32);
    if (e.dash) ctx.setLineDash(e.dash.map(function (d) { return Math.max(2, d * 0.32); }));
    ctx.beginPath();
    if (e.t === "line") { ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke(); }
    else if (e.t === "rect") {
      if (e.fill) ctx.fillRect(e.x, e.y, e.w, e.h);
      if (e.color) ctx.strokeRect(e.x, e.y, e.w, e.h);
    }
    else if (e.t === "circle") { ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); if (e.fill) ctx.fill(); if (e.color) ctx.stroke(); }
    else if (e.t === "poly") {
      e.pts.forEach(function (pt, i) { i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]); });
      if (e.closed !== false) ctx.closePath();
      if (e.fill) ctx.fill();
      if (e.color) ctx.stroke();
    }
    ctx.restore();
  }

  window.SheetKit = {
    consts: { SW: SW, SH: SH, FX0: FX0, FX1: FX1, FY0: FY0, FY1: FY1, ST3: ST3 },
    DPaper: DPaper,
    tw: tw, wrap: wrap, frame: frame, pad2: pad2, todayStr: todayStr,
    CABLE: { PWR: CABLE_PWR, GND: CABLE_GND, OPT: CABLE_OPT },
    antSheet: antSheet,
    routeSheet: routeSheet,
    planSheet: planSheet,
    cabSheet: cabSheet,
    safetySheet1: safetySheet1,
    safetySheet2: safetySheet2,
    buildAll: buildAll,
    buildSheet: buildSheet,
    renderPreview: renderPreview
  };
})();
