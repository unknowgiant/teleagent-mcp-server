/* ============================================================
 * tower-templates.js — 塔型绘制模板
 * 单管塔 / 角钢塔 / 三管塔 / 拉线塔 / H杆 / 楼顶抱杆 /
 * 楼顶平台(增高架) / 美化塔(树形) / 美化塔(路灯)
 * ============================================================ */
(function () {
  "use strict";

  var DC = window.DrawCore.consts;
  var C = DC.C;

  function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
  function maxBarW(st) {
    var w = 3.2;
    st.platforms.forEach(function (pl) {
      w = Math.max(w, window.DrawCore.layoutPlatform(pl).barW);
    });
    return w;
  }
  function maxElev(st) {
    var e = 0;
    st.platforms.forEach(function (pl) { e = Math.max(e, pl.elev); });
    return e;
  }
  /* 标高超过塔体的安全余量（天线+标注高度） */
  var LABEL_PAD = 4.8;

  /* ---------- 通用：避雷针 ---------- */
  function drawRod(paper, xM, fromE, len) {
    var x = paper.px(xM);
    paper.line(x, paper.py(fromE), x, paper.py(fromE + len), "#414b57", 1.6);
    paper.circle(x, paper.py(fromE + len) - 2, 2.6, null, "#414b57", 1.5);
  }

  /* ---------- 通用：基座 ---------- */
  function drawFooting(paper, xM, wM) {
    var x = paper.px(xM);
    var w = paper.m(wM);
    paper.rect(x - w / 2, DC.GROUND_Y, w, paper.m(0.5), "#c9d2dc", "#6b7684", 1.2);
  }

  var T = {};

  /* ============ 单管塔 ============ */
  T.monopole = {
    draw: function (paper, st) {
      var H = st.height, hb = 0.58, ht = 0.28;
      var edge = function (e) { return lerp(hb, ht, e / H); };
      paper.poly([
        [paper.px(-hb), paper.py(0)], [paper.px(-ht), paper.py(H)],
        [paper.px(ht), paper.py(H)], [paper.px(hb), paper.py(0)]
      ], C.steelFill, C.steel, 2);
      /* 法兰节段 */
      for (var e = 6; e < H - 1; e += 6) {
        var w = edge(e) + 0.07;
        paper.line(paper.px(-w), paper.py(e), paper.px(w), paper.py(e), "#8a94a0", 1.2);
      }
      /* 塔门 */
      paper.roundRect(paper.px(0.06), paper.py(2.6), paper.m(0.4), paper.m(1.9), 3, "#dfe5ec", "#8a94a0", 1.2);
      /* 爬梯 */
      if (paper.S >= 9) {
        var lx1 = paper.px(hb + 0.32), lx2 = paper.px(ht + 0.32);
        paper.line(lx1, paper.py(1.2), lx2, paper.py(H - 1.5), "#6b7684", 1.2);
        for (var e2 = 1.6; e2 < H - 1.5; e2 += 1.4) {
          var t = e2 / H;
          var bx = paper.px(lerp(hb, ht, t));
          var lxx = lerp(lx1, lx2, t);
          paper.line(lxx, paper.py(e2), bx, paper.py(e2), "#9aa4ae", 1);
        }
      }
      drawFooting(paper, 0, 2.2);
      drawRod(paper, 0, H, 3);
      st.platforms.forEach(function (pl) {
        window.DrawCore.drawPlatform(paper, pl, { bodyEdgeAt: edge });
      });
    },
    meta: function (st) {
      var totalH = Math.max(st.height + 3, maxElev(st) + LABEL_PAD);
      return { totalH: totalH, visualW: Math.max(maxBarW(st), 5) + 2.5, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5) };
    }
  };

  /* ============ 角钢塔（格构） ============ */
  function drawLatticeBody(paper, st, baseHalf, topHalf, legW, xBrace) {
    var H = st.height;
    var edge = function (e) { return lerp(baseHalf, topHalf, e / H); };
    /* 塔腿 */
    paper.line(paper.px(-baseHalf), paper.py(0), paper.px(-topHalf), paper.py(H), "#414b57", legW);
    paper.line(paper.px(baseHalf), paper.py(0), paper.px(topHalf), paper.py(H), "#414b57", legW);
    /* 横隔 + 腹杆 */
    var step = 5, marks = [0];
    for (var e = step; e < H - 0.5; e += step) marks.push(e);
    marks.push(H);
    for (var i = 0; i < marks.length - 1; i++) {
      var e1 = marks[i], e2 = marks[i + 1];
      var w1 = edge(e1), w2 = edge(e2);
      paper.line(paper.px(-w2), paper.py(e2), paper.px(w2), paper.py(e2), "#6b7684", 1.4);
      if (xBrace) {
        paper.line(paper.px(-w1), paper.py(e1), paper.px(w2), paper.py(e2), "#9aa4ae", 1.1);
        paper.line(paper.px(w1), paper.py(e1), paper.px(-w2), paper.py(e2), "#9aa4ae", 1.1);
      } else {
        if (i % 2 === 0) paper.line(paper.px(-w1), paper.py(e1), paper.px(w2), paper.py(e2), "#9aa4ae", 1.1);
        else paper.line(paper.px(w1), paper.py(e1), paper.px(-w2), paper.py(e2), "#9aa4ae", 1.1);
      }
    }
    paper.line(paper.px(-topHalf), paper.py(H), paper.px(topHalf), paper.py(H), "#414b57", 2);
    return edge;
  }

  T.lattice = {
    draw: function (paper, st) {
      var H = st.height;
      var baseHalf = Math.min(4, Math.max(1.6, H / 16));
      var edge = drawLatticeBody(paper, st, baseHalf, 0.8, 3.2, true);
      drawFooting(paper, -baseHalf, 1.4);
      drawFooting(paper, baseHalf, 1.4);
      drawRod(paper, 0, H, 3);
      st.platforms.forEach(function (pl) {
        window.DrawCore.drawPlatform(paper, pl, { bodyEdgeAt: edge });
      });
    },
    meta: function (st) {
      var baseHalf = Math.min(4, Math.max(1.6, st.height / 16));
      var totalH = Math.max(st.height + 3, maxElev(st) + LABEL_PAD);
      return { totalH: totalH, visualW: Math.max(baseHalf * 2, maxBarW(st)) + 3.5, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5) };
    }
  };

  /* ============ 三管塔 ============ */
  T.tripod = {
    draw: function (paper, st) {
      var H = st.height;
      var baseHalf = Math.min(2.2, Math.max(1.0, H / 24));
      var edge = drawLatticeBody(paper, st, baseHalf, 0.55, 2.6, false);
      drawFooting(paper, -baseHalf, 1.1);
      drawFooting(paper, baseHalf, 1.1);
      drawRod(paper, 0, H, 3);
      st.platforms.forEach(function (pl) {
        window.DrawCore.drawPlatform(paper, pl, { bodyEdgeAt: edge });
      });
    },
    meta: function (st) {
      var baseHalf = Math.min(2.2, Math.max(1.0, st.height / 24));
      var totalH = Math.max(st.height + 3, maxElev(st) + LABEL_PAD);
      return { totalH: totalH, visualW: Math.max(baseHalf * 2, maxBarW(st)) + 3, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5) };
    }
  };

  /* ============ 拉线塔 ============ */
  T.guyed = {
    draw: function (paper, st) {
      var H = st.height, half = 0.22;
      paper.poly([
        [paper.px(-half), paper.py(0)], [paper.px(-half), paper.py(H)],
        [paper.px(half), paper.py(H)], [paper.px(half), paper.py(0)]
      ], C.steelFill, C.steel, 1.8);
      for (var e = 5; e < H - 1; e += 5) {
        paper.line(paper.px(-half), paper.py(e), paper.px(half), paper.py(e), "#9aa4ae", 1);
      }
      /* 拉线 */
      var atts = H >= 35 ? [H * 0.55, H * 0.85] : [H * 0.7];
      atts.forEach(function (ae) {
        var ad = Math.min(0.75 * ae, 9);
        [-1, 1].forEach(function (s) {
          paper.line(paper.px(s * half), paper.py(ae), paper.px(s * ad), paper.py(0), "#8a94a0", 1.3);
          /* 锚块 */
          var ax = paper.px(s * ad);
          paper.poly([
            [ax - paper.m(0.4), DC.GROUND_Y], [ax + paper.m(0.4), DC.GROUND_Y], [ax, DC.GROUND_Y - paper.m(0.6)]
          ], "#c9d2dc", "#6b7684", 1.2);
        });
      });
      drawFooting(paper, 0, 1.6);
      drawRod(paper, 0, H, 2.5);
      st.platforms.forEach(function (pl) {
        window.DrawCore.drawPlatform(paper, pl, { brace: false });
      });
    },
    meta: function (st) {
      var H = st.height;
      var atts = H >= 35 ? [H * 0.55, H * 0.85] : [H * 0.7];
      var ad = Math.min(0.75 * atts[atts.length - 1], 9);
      var totalH = Math.max(H + 2.5, maxElev(st) + LABEL_PAD);
      return { totalH: totalH, visualW: Math.max(ad * 2, maxBarW(st)) + 3, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5) };
    }
  };

  /* ============ H杆 ============ */
  T.hpole = {
    draw: function (paper, st) {
      var H = st.height, sp = 1.1, ph = 0.19;
      [-1, 1].forEach(function (s) {
        paper.rect(paper.px(s * sp - ph), paper.py(H), paper.m(ph * 2), paper.m(H), C.steelFill, C.steel, 1.8);
        drawFooting(paper, s * sp, 1.0);
      });
      /* 杆间横撑 + 交叉撑 */
      var lowBeam = st.platforms.length ? Math.min.apply(null, st.platforms.map(function (p) { return p.elev; })) : H * 0.85;
      paper.line(paper.px(-sp), paper.py(H * 0.45), paper.px(sp), paper.py(H * 0.45), "#6b7684", 1.6);
      paper.line(paper.px(-sp), paper.py(lowBeam * 0.45), paper.px(sp), paper.py(lowBeam * 0.85), "#9aa4ae", 1.1);
      paper.line(paper.px(sp), paper.py(lowBeam * 0.45), paper.px(-sp), paper.py(lowBeam * 0.85), "#9aa4ae", 1.1);
      /* 拉线（挂最高平台/塔顶） */
      var att = st.platforms.length ? Math.max.apply(null, st.platforms.map(function (p) { return p.elev; })) : H * 0.92;
      var ad = Math.min(0.7 * att, 5.5);
      [-1, 1].forEach(function (s) {
        paper.line(paper.px(s * sp), paper.py(att), paper.px(s * ad), paper.py(0), "#8a94a0", 1.3);
        var ax = paper.px(s * ad);
        paper.poly([
          [ax - paper.m(0.35), DC.GROUND_Y], [ax + paper.m(0.35), DC.GROUND_Y], [ax, DC.GROUND_Y - paper.m(0.55)]
        ], "#c9d2dc", "#6b7684", 1.2);
      });
      drawRod(paper, sp, H, 2);
      st.platforms.forEach(function (pl) {
        window.DrawCore.drawPlatform(paper, pl, { brace: false });
      });
    },
    meta: function (st) {
      var H = st.height;
      var att = st.platforms.length ? Math.max.apply(null, st.platforms.map(function (p) { return p.elev; })) : H * 0.92;
      var ad = Math.min(0.7 * att, 5.5);
      var totalH = Math.max(H + 2, maxElev(st) + LABEL_PAD);
      return { totalH: totalH, visualW: (Math.max(ad, maxBarW(st) / 2) + 1.6) * 2, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5) };
    }
  };

  /* ============ 楼顶站通用：建筑物 ============ */
  function drawBuilding(paper, st) {
    var Bh = st.supH || 20, Bw = 15;
    var x0 = paper.px(-Bw / 2), yRoof = paper.py(Bh);
    paper.rect(x0, yRoof, paper.m(Bw), paper.m(Bh), "#eef2f6", "#6b7684", 1.8);
    /* 楼层线 + 窗 */
    var floors = Math.max(2, Math.round(Bh / 3));
    for (var f = 1; f < floors; f++) {
      var fy = paper.py(Bh * f / floors);
      paper.line(x0 + 4, fy, x0 + paper.m(Bw) - 4, fy, "#cdd6e0", 1);
    }
    if (paper.S >= 7) {
      for (var f2 = 0; f2 < floors; f2++) {
        for (var w = 0; w < 4; w++) {
          var wx = x0 + paper.m(Bw) * (0.12 + w * 0.22);
          var wy = paper.py(Bh * (f2 + 0.72) / floors);
          paper.rect(wx, wy, paper.m(1.5), paper.m(1.1), "#dfe7ef", "#b6c2ce", 1);
        }
      }
    }
    /* 女儿墙 */
    paper.line(x0, yRoof, x0 + paper.m(Bw), yRoof, "#414b57", 2.6);
    paper.line(x0, yRoof, x0, yRoof - paper.m(0.35), "#414b57", 1.6);
    paper.line(x0 + paper.m(Bw), yRoof, x0 + paper.m(Bw), yRoof - paper.m(0.35), "#414b57", 1.6);
    paper.text("建筑物 " + Bh + "m", x0 - 8, paper.py(Bh / 2), { size: 11, color: C.dim, align: "right" });
  }

  /* 楼顶抱杆：逐杆绘制（平台=单根抱杆） */
  T.roofpole = {
    draw: function (paper, st) {
      drawBuilding(paper, st);
      var Bh = st.supH || 20;
      var n = Math.max(st.platforms.length, 1);
      var spread = Math.min(10, 3.2 * n);
      st.platforms.forEach(function (pl, i) {
        var xm = n === 1 ? 0 : -spread / 2 + spread * i / (n - 1);
        var topE = Math.max(pl.elev, Bh + 1.2);
        var x = paper.px(xm);
        /* 抱杆 */
        paper.line(x, paper.py(Bh), x, paper.py(topE), "#414b57", 2.6);
        paper.line(x - paper.m(0.55), paper.py(Bh), x, paper.py(Bh + 0.9), "#9aa4ae", 1.1); // 斜撑
        paper.line(x + paper.m(0.55), paper.py(Bh), x, paper.py(Bh + 0.9), "#9aa4ae", 1.1);
        /* 天线块（挂杆顶） */
        var lay = window.DrawCore.layoutPlatform(pl);
        lay.groups.forEach(function (g) {
          var gx = paper.px(xm + g.x);
          var cursorM = xm + g.x - g.w / 2;
          g.pole.items.forEach(function (it) {
            for (var k = 0; k < it.count; k++) {
              var ax = paper.px(cursorM + k * (DC.ANT_W + DC.ANT_GAP));
              var ayTop = paper.py(topE - 0.12 - DC.ANT_H);
              var aw = paper.m(DC.ANT_W), ah = paper.m(DC.ANT_H);
              if (it.op.home) paper.roundRect(ax, ayTop, aw, ah, Math.min(4, aw / 3), C.home, C.homeDark, 1.4);
              else paper.roundRect(ax, ayTop, aw, ah, Math.min(4, aw / 3), C.other, C.otherEdge, 1.4);
            }
            cursorM += (it.count * DC.ANT_W + (it.count - 1) * DC.ANT_GAP) + 0.32;
          });
          /* 标注 */
          var lines = g.pole.items.map(function (it) {
            if (it.op.home) {
              var az = (it.azimuth !== null && it.azimuth !== undefined) ? "(" + it.azimuth + "°)" : "";
              return "电信" + (it.ran ? it.ran.replace(/NR/gi, "").replace(/\s+/g, "") : "本网") + "×" + it.count + az;
            }
            return it.op.short;
          });
          var ly = paper.py(topE + 0.45);
          lines.forEach(function (ln) {
            paper.text(ln, gx, ly, { size: 12, color: "#1f2d3d", align: "center", bg: "rgba(255,255,255,.92)" });
            ly -= Math.max(paper.m(0.62), 15);
          });
        });
        /* 抱杆标注 */
        paper.text("抱杆" + pl.no + " " + (Math.round(pl.elev * 10) / 10) + "m",
          x + paper.m(0.7), paper.py(Bh) - 10, { size: 11, color: "#37424e", bold: true });
      });
    },
    meta: function (st) {
      var top = (st.supH || 20) + st.height;
      var me = maxElev(st);
      var totalH = Math.max(top, me + 2.2) + 0.8;
      return { totalH: totalH, visualW: 17, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5) };
    }
  };

  /* ============ 楼顶平台（增高架） ============ */
  T.roofplat = {
    draw: function (paper, st) {
      drawBuilding(paper, st);
      var Bh = st.supH || 20, H = st.height;
      var baseHalf = 1.35, topHalf = 0.7;
      var edge = function (e) { return lerp(baseHalf, topHalf, (e - Bh) / H); };
      paper.line(paper.px(-baseHalf), paper.py(Bh), paper.px(-topHalf), paper.py(Bh + H), "#414b57", 2.4);
      paper.line(paper.px(baseHalf), paper.py(Bh), paper.px(topHalf), paper.py(Bh + H), "#414b57", 2.4);
      var step = 2.5, marks = [0];
      for (var e = step; e < H - 0.4; e += step) marks.push(e);
      marks.push(H);
      for (var i = 0; i < marks.length - 1; i++) {
        var e1 = Bh + marks[i], e2 = Bh + marks[i + 1];
        var w1 = edge(e1), w2 = edge(e2);
        paper.line(paper.px(-w1), paper.py(e1), paper.px(w2), paper.py(e2), "#9aa4ae", 1.1);
        paper.line(paper.px(w1), paper.py(e1), paper.px(-w2), paper.py(e2), "#9aa4ae", 1.1);
      }
      paper.line(paper.px(-baseHalf), paper.py(Bh), paper.px(baseHalf), paper.py(Bh), "#6b7684", 1.6);
      drawRod(paper, 0, Bh + H, 2.5);
      st.platforms.forEach(function (pl) {
        window.DrawCore.drawPlatform(paper, pl, { brace: false });
      });
    },
    meta: function (st) {
      var top = (st.supH || 20) + st.height + 2.5;
      var totalH = Math.max(top, maxElev(st) + LABEL_PAD);
      return { totalH: totalH, visualW: 17, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5) };
    }
  };

  /* ============ 美化塔(树形) v2 精细化 ============ */
  T.tree = {
    draw: function (paper, st) {
      var H = st.height, hb = 0.5, ht = 0.24;
      /* 树干（带节环） */
      paper.poly([
        [paper.px(-hb), paper.py(0)], [paper.px(-ht), paper.py(H - 3.6)],
        [paper.px(ht), paper.py(H - 3.6)], [paper.px(hb), paper.py(0)]
      ], "#a8846a", "#7c5f48", 2);
      for (var e = 3.5; e < H - 3.5; e += 3.5) {
        var w = lerp(hb, ht, e / (H - 3.6));
        paper.line(paper.px(-w), paper.py(e), paper.px(w), paper.py(e), "#7c5f48", 1.4);
      }
      /* 根部土堆 */
      paper.poly([
        [paper.px(-1.9), paper.py(0)], [paper.px(1.9), paper.py(0)], [paper.px(1.2), paper.py(1.1)], [paper.px(-1.2), paper.py(1.1)]
      ], "#b8a888", "#8c7a5c", 1.2);
      /* 树冠（三层圆簇） */
      var cy = H - 2.6;
      var blobs = [
        [0, 0, 3.0], [-2.4, 1.3, 2.0], [2.4, 1.3, 2.0],
        [-1.6, -1.7, 1.9], [1.6, -1.7, 1.9], [0, 2.2, 1.8],
        [-3.2, 0.3, 1.4], [3.2, 0.3, 1.4], [0, -2.6, 1.4]
      ];
      blobs.forEach(function (b, i) {
        paper.circle(paper.px(b[0]), paper.py(cy + b[1]), paper.m(b[2]),
          i % 3 === 0 ? "#5f9e63" : (i % 3 === 1 ? "#6fae73" : "#4f8c57"), "#3f6f46", 1.3);
      });
      /* 平台与天线绘制在树冠之上 */
      st.platforms.forEach(function (pl) {
        window.DrawCore.drawPlatform(paper, pl, { brace: false });
      });
      drawRod(paper, 0, cy + 4.0, 1.5);
    },
    meta: function (st) {
      var totalH = Math.max(st.height + 2.5, maxElev(st) + LABEL_PAD);
      return { totalH: totalH, visualW: Math.max(maxBarW(st), 9) + 2, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5), halfW: 6, baseHalfW: 1.9 };
    }
  };

  /* ============ 美化塔(路灯) v2 精细化 ============ */
  T.lamp = {
    draw: function (paper, st) {
      var H = st.height, hb = 0.34, ht = 0.12;
      /* 灯杆（微弧） */
      var segs = 6;
      var pts = [];
      for (var i = 0; i <= segs; i++) {
        var t = i / segs;
        var e = t * (H - 0.6);
        var w = lerp(hb, ht, Math.pow(t, 0.8));
        var off = Math.sin(t * Math.PI) * 0.12; // 微弯
        pts.push([paper.px(-w + off), paper.py(e)]);
        pts.push([paper.px(w + off), paper.py(e)]);
      }
      paper.poly(pts, "#aab3bd", "#7d8792", 1.8);
      /* 节段线 */
      for (var e2 = 4; e2 < H - 1; e2 += 4) {
        var w2 = lerp(hb, ht, Math.pow(e2 / (H - 0.6), 0.8));
        paper.line(paper.px(-w2), paper.py(e2), paper.px(w2), paper.py(e2), "#9aa4ae", 1);
      }
      /* 双灯臂 + 双灯具 */
      [-1, 1].forEach(function (s) {
        paper.line(paper.px(ht * s), paper.py(H - 0.6), paper.px(1.6 * s), paper.py(H + 0.5), "#7d8792", 2.2);
        var hx = paper.px(1.6 * s);
        paper.roundRect(hx - paper.m(0.42), paper.py(H + 0.5), paper.m(1.0), paper.m(0.4), 3, "#dfe5ec", "#7d8792", 1.3);
        paper.circle(paper.px(0.1 * s + 1.6 * s), paper.py(H + 0.5), paper.m(0.09), "#ffd76e");
      });
      paper.circle(paper.px(0), paper.py(H - 0.6), paper.m(0.17), "#7d8792");
      /* 底座 */
      paper.poly([
        [paper.px(-0.62), paper.py(0)], [paper.px(0.62), paper.py(0)],
        [paper.px(0.44), paper.py(0.55)], [paper.px(-0.44), paper.py(0.55)]
      ], "#c9d2dc", "#7d8792", 1.3);
      st.platforms.forEach(function (pl) {
        window.DrawCore.drawPlatform(paper, pl, { brace: false });
      });
    },
    meta: function (st) {
      var totalH = Math.max(st.height + 1.4, maxElev(st) + LABEL_PAD);
      return { totalH: totalH, visualW: Math.max(maxBarW(st), 5.5) + 2, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5), halfW: 3.2, baseHalfW: 0.62 };
    }
  };

  /* ============ 美化塔(水塔形) ============ */
  T.water = {
    draw: function (paper, st) {
      var H = st.height;
      var topR = 1.75, botR = 2.3, cylH = Math.min(H * 0.52, 14);
      var legH = H - cylH;
      /* 支腿（两柱 + 横撑） */
      [-1, 1].forEach(function (s) {
        paper.line(paper.px(s * 1.7), paper.py(0), paper.px(s * 1.7), paper.py(legH + 0.2), "#8a94a0", 2.2);
        drawFooting(paper, s * 1.7, 1.0);
      });
      var cross = [0.35, 0.6, 0.85];
      cross.forEach(function (t) {
        var y = legH * t;
        paper.line(paper.px(-1.7), paper.py(y), paper.px(1.7), paper.py(y), "#8a94a0", 1.5);
        paper.line(paper.px(-1.7), paper.py(y), paper.px(1.7), paper.py(y - 1.6), "#b6c2ce", 1);
        paper.line(paper.px(1.7), paper.py(y), paper.px(-1.7), paper.py(y - 1.6), "#b6c2ce", 1);
      });
      /* 水柜主体（上小下大的锥台） */
      paper.poly([
        [paper.px(-botR), paper.py(legH)], [paper.px(-topR), paper.py(H - 0.5)],
        [paper.px(topR), paper.py(H - 0.5)], [paper.px(botR), paper.py(legH)]
      ], "#d9dfe6", "#6b7684", 1.8);
      for (var e = legH + 1.5; e < H - 1; e += 1.5) {
        var t2 = (e - legH) / cylH;
        var w = lerp(botR, topR, t2);
        paper.line(paper.px(-w), paper.py(e), paper.px(w), paper.py(e), "#b6c2ca", 1);
      }
      /* 顶盖 */
      paper.poly([
        [paper.px(-topR), paper.py(H - 0.5)], [paper.px(topR), paper.py(H - 0.5)],
        [paper.px(topR * 0.6), paper.py(H + 0.4)], [paper.px(-topR * 0.6), paper.py(H + 0.4)]
      ], "#c9d2dc", "#6b7684", 1.5);
      drawRod(paper, 0, H + 0.4, 1.6);
      /* 平台（挂在水柜下部） */
      st.platforms.forEach(function (pl) {
        window.DrawCore.drawPlatform(paper, pl, { brace: false });
      });
    },
    meta: function (st) {
      var totalH = Math.max(st.height + 2, maxElev(st) + LABEL_PAD);
      return { totalH: totalH, visualW: Math.max(maxBarW(st), 7) + 2, rulerTop: Math.max(5, Math.floor(totalH / 5) * 5), halfW: 4, baseHalfW: 1.7 };
    }
  };

  /* 统一分发入口 */
  T.meta = function (st) {
    var tpl = T[st.towerKey] || T.monopole;
    var m = tpl.meta(st);
    if (m.halfW === undefined) m.halfW = m.visualW / 2 + 0.4;
    if (m.baseHalfW === undefined) m.baseHalfW = 0.6;
    return m;
  };
  T.drawTower = function (paper, st) {
    var tpl = T[st.towerKey] || T.monopole;
    tpl.draw(paper, st);
  };

  window.TowerTemplates = T;
})();
