/* ============================================================
 * data-model.js — Excel解析 / 字段映射 / 数据校验 / 塔型识别
 * ============================================================ */
(function () {
  "use strict";

  /* ---------- 塔型识别（容错匹配） ---------- */
  var TOWER_TYPES = [
    { key: "monopole",   label: "单管塔",       match: ["单管塔", "独管塔", "单管", "钢管塔", "锥形塔"] },
    { key: "lattice",    label: "角钢塔",       match: ["角钢塔", "角钢铁塔", "格构塔", "四管塔"] },
    { key: "tripod",     label: "三管塔",       match: ["三管塔", "三管"] },
    { key: "guyed",      label: "拉线塔",       match: ["拉线塔", "拉线", "桅杆", "拉线桅杆"] },
    { key: "hpole",      label: "H杆",          match: ["h杆", "h型杆", "双杆"] },
    { key: "roofpole",   label: "楼顶抱杆",     match: ["楼顶抱杆", "屋顶抱杆", "楼顶杆", "抱杆", "女儿墙抱杆"] },
    { key: "roofplat",   label: "楼顶平台",     match: ["楼顶平台", "屋顶平台", "楼顶支架", "增高架", "抱杆增高架", "楼顶塔"] },
    { key: "tree",       label: "美化塔(树形)", match: ["美化塔(树形)", "美化塔（树形）", "树形塔", "仿真树", "景观塔", "美化树"] },
    { key: "lamp",       label: "美化塔(路灯)", match: ["美化塔(路灯)", "美化塔（路灯）", "路灯塔", "灯杆塔", "美化灯杆"] },
    { key: "water",      label: "美化塔(水塔)", match: ["美化塔(水塔)", "美化塔（水塔）", "水塔", "水塔形"] }
  ];

  function recognizeTower(raw) {
    if (!raw) return null;
    var s = String(raw).trim().toLowerCase();
    for (var i = 0; i < TOWER_TYPES.length; i++) {
      var t = TOWER_TYPES[i];
      for (var j = 0; j < t.match.length; j++) {
        if (s === t.match[j].toLowerCase()) return { key: t.key, label: t.label };
        if (s.indexOf(t.match[j].toLowerCase()) >= 0) return { key: t.key, label: t.label };
      }
    }
    return null;
  }

  /* ---------- 运营商 ---------- */
  var OP_MAP = [
    { full: "中国电信", short: "电信",  home: true  },
    { full: "中国移动", short: "移动",  home: false },
    { full: "中国联通", short: "联通",  home: false },
    { full: "中国广电", short: "广电",  home: false },
    { full: "其他",     short: "其他",  home: false }
  ];
  function recognizeOperator(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    for (var i = 0; i < OP_MAP.length; i++) {
      if (s.indexOf(OP_MAP[i].full) >= 0 || s === OP_MAP[i].short) return OP_MAP[i];
    }
    if (/电信|ct/.test(s)) return OP_MAP[0];
    if (/移动|cmcc/.test(s)) return OP_MAP[1];
    if (/联通|cu/.test(s)) return OP_MAP[2];
    if (/广电|cbn/.test(s)) return OP_MAP[3];
    return { full: s, short: s.length > 3 ? s.slice(0, 3) : s, home: false };
  }

  /* ---------- 工具 ---------- */
  function pickNum(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var m = String(v).replace(/，/g, ",").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function pickStr(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  /* AIGC水印行识别（合规标识，非用户数据） */
  function isWatermark(s) {
    return /^aigc[:：]/i.test(s) || s.indexOf("生成内容标识") >= 0 || s.indexOf("AI生成") >= 0;
  }

  /* 表头别名映射 */
  var M_ALIAS = {
    name:    ["基站名称", "站点名称", "站名", "基站"],
    addr:    ["所在地址", "地址", "站址"],
    lon:     ["经度"],
    lat:     ["纬度"],
    siteType:["站型"],
    tower:   ["塔型", "塔体类型", "塔棅类型", "铁塔类型"],
    height:  ["塔高(米)", "塔高", "塔高(m)", "高度(米)", "塔体高度"],
    supH:    ["支承物高度(米)", "支承物高度", "楼高(米)", "建筑物高度", "支承物高度(m)"],
    platNum: ["平台数", "平台数量"],
    ran:     ["本网ran类型", "ran类型", "ran", "网络制式"],
    owner:   ["建设单位"],
    survey:  ["勘察人"],
    date:    ["勘察日期"],
    projNo:  ["图号前缀", "项目图号", "工程图号"],
    projName:["项目名称"],
    nature:  ["站点性质", "改造类型", "建设性质"],
    roomLoc: ["机房位置", "机房楼层"],
    cabSize: ["综合柜尺寸"],
    note:    ["备注"]
  };
  var D_ALIAS = {
    name:    ["基站名称", "站点名称", "站名", "基站"],
    platNo:  ["平台序号", "平台编号", "平台号"],
    elev:    ["平台标高(米)", "平台标高", "标高(米)", "标高", "平台高度(米)"],
    pole:    ["抱杆编号", "抱杆号", "抱杆"],
    op:      ["运营商"],
    ran:     ["ran制式", "制式", "ran", "网络制式", "系统"],
    status:  ["天线状态", "状态", "新旧状态"],
    count:   ["天线数量", "天线面数", "数量"],
    azimuth: ["方位角(°)", "方位角", "方位角(度)"],
    model:   ["天线型号", "型号"],
    note:    ["备注"]
  };

  /* 天线三态归一化（三期：新增/原有/拆除/替换） */
  function normStatus(raw) {
    var s = pickStr(raw);
    if (!s) return "新增";
    if (/拆除|删除|退服/.test(s)) return "拆除";
    if (/原有|利旧|存量|现网/.test(s)) return "原有";
    if (/替换|更换/.test(s)) return "替换";
    if (/新增|新装|本期/.test(s)) return "新增";
    return "新增";
  }
  var D_ALIAS = {
    name:    ["基站名称", "站点名称", "站名", "基站"],
    platNo:  ["平台序号", "平台编号", "平台号"],
    elev:    ["平台标高(米)", "平台标高", "标高(米)", "标高", "平台高度(米)"],
    pole:    ["抱杆编号", "抱杆号", "抱杆"],
    op:      ["运营商"],
    ran:     ["ran制式", "制式", "ran", "网络制式", "系统"],
    count:   ["天线数量", "天线面数", "数量"],
    azimuth: ["方位角(°)", "方位角", "方位角(度)"],
    model:   ["天线型号", "型号"],
    note:    ["备注"]
  };

  function mapHeader(row, alias) {
    var idx = {};
    for (var c = 0; c < row.length; c++) {
      var h = pickStr(row[c]).toLowerCase().replace(/\s/g, "");
      if (!h) continue;
      for (var k in alias) {
        if (idx[k] !== undefined) continue;
        for (var i = 0; i < alias[k].length; i++) {
          var a = alias[k][i].toLowerCase().replace(/\s/g, "");
          if (h === a || h.indexOf(a) === 0) { idx[k] = c; break; }
        }
      }
    }
    return idx;
  }

  /* 找表头行（前6行内找含"基站名称"的行） */
  function findHeaderRow(rows, aliases) {
    for (var r = 0; r < Math.min(rows.length, 6); r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) {
        var h = pickStr(row[c]).replace(/\s/g, "");
        for (var i = 0; i < aliases.name.length; i++) {
          if (h === aliases.name[i] || h.indexOf(aliases.name[i]) === 0) return r;
        }
      }
    }
    return -1;
  }

  /* 找工作表：按 sheet 名，退化到按表头内容嗅探 */
  function pickSheets(wb) {
    var master = null, detail = null;
    wb.SheetNames.forEach(function (sn) {
      var ws = wb.Sheets[sn];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      var lower = sn.toLowerCase();
      if (lower.indexOf("主表") >= 0 || lower.indexOf("基站") >= 0 && lower.indexOf("明细") < 0) {
        if (!master) master = { name: sn, rows: rows };
      } else if (lower.indexOf("明细") >= 0 || lower.indexOf("安装") >= 0) {
        if (!detail) detail = { name: sn, rows: rows };
      }
    });
    if (!master || !detail) {
      wb.SheetNames.forEach(function (sn) {
        if (master && detail) return;
        if ((master && master.name === sn) || (detail && detail.name === sn)) return;
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "" });
        var hr = findHeaderRow(rows, M_ALIAS);
        if (hr >= 0) { if (!master) master = { name: sn, rows: rows }; return; }
        hr = findHeaderRow(rows, D_ALIAS);
        if (hr >= 0 && (mapHeader(rows[hr], D_ALIAS).elev !== undefined)) {
          if (!detail) detail = { name: sn, rows: rows };
        }
      });
    }
    return { master: master, detail: detail };
  }

  /* ============================================================
   * 主入口：parseWorkbook(wb) → { stations, errors, warnings }
   ============================================================ */
  function parseWorkbook(wb) {
    var errors = [], warnings = [];
    var picked = pickSheets(wb);
    if (!picked.master) {
      errors.push("未找到「基站主表」工作表（需含表头：基站名称/塔型/塔高等）");
      return { stations: [], errors: errors, warnings: warnings };
    }
    if (!picked.detail) {
      warnings.push("未找到「安装明细表」，所有基站将只绘制塔体");
    }

    /* ---- 解析主表 ---- */
    var mRows = picked.master.rows;
    var mHdr = findHeaderRow(mRows, M_ALIAS);
    if (mHdr < 0) { errors.push("主表中未找到表头行（基站名称）"); return { stations: [], errors: errors, warnings: warnings }; }
    var mIdx = mapHeader(mRows[mHdr], M_ALIAS);
    if (mIdx.name === undefined) { errors.push("主表缺少「基站名称」列"); return { stations: [], errors: errors, warnings: warnings }; }

    var stations = [], byName = {};
    for (var r = mHdr + 1; r < mRows.length; r++) {
      var row = mRows[r] || [];
      var name = pickStr(row[mIdx.name]);
      if (!name) continue; // 空行
      if (isWatermark(name)) continue; // 跳过AIGC标识行
      if (byName[name]) {
        warnings.push("主表存在重复基站名称「" + name + "」，已合并第一条");
        continue;
      }
      var st = {
        name: name,
        addr: mIdx.addr !== undefined ? pickStr(row[mIdx.addr]) : "",
        lon: mIdx.lon !== undefined ? pickStr(row[mIdx.lon]) : "",
        lat: mIdx.lat !== undefined ? pickStr(row[mIdx.lat]) : "",
        siteType: mIdx.siteType !== undefined ? pickStr(row[mIdx.siteType]) : "",
        towerRaw: mIdx.tower !== undefined ? pickStr(row[mIdx.tower]) : "",
        height: mIdx.height !== undefined ? pickNum(row[mIdx.height]) : null,
        supH: mIdx.supH !== undefined ? pickNum(row[mIdx.supH]) : null,
        platNum: mIdx.platNum !== undefined ? pickNum(row[mIdx.platNum]) : null,
        ran: mIdx.ran !== undefined ? pickStr(row[mIdx.ran]) : "",
        owner: mIdx.owner !== undefined ? pickStr(row[mIdx.owner]) : "",
        survey: mIdx.survey !== undefined ? pickStr(row[mIdx.survey]) : "",
        date: mIdx.date !== undefined ? pickStr(row[mIdx.date]) : "",
        projNo: mIdx.projNo !== undefined ? pickStr(row[mIdx.projNo]) : "",
        projName: mIdx.projName !== undefined ? pickStr(row[mIdx.projName]) : "",
        nature: mIdx.nature !== undefined ? pickStr(row[mIdx.nature]) : "",
        roomLoc: mIdx.roomLoc !== undefined ? pickStr(row[mIdx.roomLoc]) : "",
        cabSize: mIdx.cabSize !== undefined ? pickStr(row[mIdx.cabSize]) : "",
        note: mIdx.note !== undefined ? pickStr(row[mIdx.note]) : "",
        platforms: [],   // [{no, elev, poles:[{id, op, ran, status, count, azimuth, model, note}]}]
        warns: []
      };
      /* 三期默认值（对齐设计院模板） */
      if (!st.projNo) st.projNo = "2025HACT0001-002-WX-LY";
      if (!st.projName) st.projName = "2025年极简站";
      if (!st.cabSize) st.cabSize = "600X600X2000";
      var tw = recognizeTower(st.towerRaw);
      if (!tw) {
        st.towerKey = "monopole";
        st.towerLabel = "未知塔型";
        st.warns.push("塔型「" + st.towerRaw + "」无法识别，按单管塔示意绘制");
        warnings.push("基站「" + name + "」塔型「" + st.towerRaw + "」无法识别，按单管塔示意");
      } else {
        st.towerKey = tw.key; st.towerLabel = tw.label;
      }
      if (st.height === null || st.height <= 0) {
        st.warns.push("塔高缺失或无效，按40米示意");
        st.height = 40;
        warnings.push("基站「" + name + "」塔高缺失，按40米示意绘制");
      }
      if ((st.towerKey === "roofpole" || st.towerKey === "roofplat") && (st.supH === null || st.supH <= 0)) {
        st.supH = 20;
        st.warns.push("楼顶站未填支承物高度，按20米示意");
      }
      stations.push(st);
      byName[name] = st;
    }
    if (!stations.length) errors.push("主表没有有效数据行");

    /* ---- 解析明细表 ---- */
    if (picked.detail) {
      var dRows = picked.detail.rows;
      var dHdr = findHeaderRow(dRows, D_ALIAS);
      var dIdx = dHdr >= 0 ? mapHeader(dRows[dHdr], D_ALIAS) : null;
      if (!dIdx || dIdx.name === undefined || dIdx.platNo === undefined) {
        warnings.push("明细表表头不完整（需含：基站名称/平台序号/平台标高），忽略明细");
      } else {
        var orphan = 0;
        for (var r2 = dHdr + 1; r2 < dRows.length; r2++) {
          var dr = dRows[r2] || [];
          var dname = pickStr(dr[dIdx.name]);
          if (!dname) continue;
          if (isWatermark(dname)) continue; // 跳过AIGC标识行
          var st2 = byName[dname];
          if (!st2) {
            if (orphan < 5) warnings.push("明细行基站「" + dname + "」在主表中不存在，已忽略");
            orphan++;
            continue;
          }
          var no = pickNum(dr[dIdx.platNo]);
          if (no === null) no = 1;
          var elev = dIdx.elev !== undefined ? pickNum(dr[dIdx.elev]) : null;
          var op = recognizeOperator(dIdx.op !== undefined ? dr[dIdx.op] : "");
          if (!op) { op = { full: "未知", short: "未知", home: false }; }
          var cnt = dIdx.count !== undefined ? pickNum(dr[dIdx.count]) : null;
          if (cnt === null || cnt < 1) cnt = 1;
          if (cnt > 4) cnt = 4;

          var plat = null;
          for (var p = 0; p < st2.platforms.length; p++) {
            if (st2.platforms[p].no === no) { plat = st2.platforms[p]; break; }
          }
          if (!plat) {
            plat = { no: no, elev: elev, poles: [] };
            st2.platforms.push(plat);
          }
          if (elev !== null && plat.elev === null) plat.elev = elev;

          var poleId = dIdx.pole !== undefined ? pickStr(dr[dIdx.pole]) : "";
          if (!poleId) poleId = "P" + (plat.poles.length + 1);
          var pole = null;
          for (var q = 0; q < plat.poles.length; q++) {
            if (plat.poles[q].id === poleId) { pole = plat.poles[q]; break; }
          }
          if (!pole) {
            pole = { id: poleId, items: [] };
            plat.poles.push(pole);
          }
          pole.items.push({
            op: op,
            ran: dIdx.ran !== undefined ? pickStr(dr[dIdx.ran]) : "",
            status: normStatus(dIdx.status !== undefined ? dr[dIdx.status] : ""),
            count: cnt,
            azimuth: dIdx.azimuth !== undefined ? pickNum(dr[dIdx.azimuth]) : null,
            model: dIdx.model !== undefined ? pickStr(dr[dIdx.model]) : "",
            note: dIdx.note !== undefined ? pickStr(dr[dIdx.note]) : ""
          });
        }
      }
    }

    /* ---- 平台数据整理 + 校验 ---- */
    stations.forEach(function (st) {
      var isRoof = (st.towerKey === "roofpole" || st.towerKey === "roofplat");
      var topLimit = (isRoof ? (st.supH + st.height) : st.height);

      st.platforms.sort(function (a, b) { return a.no - b.no; });
      st.platforms.forEach(function (pl) {
        if (pl.elev === null) {
          pl.elev = Math.round((topLimit * 0.7) * 10) / 10;
          pl.autoElev = true;
        }
        if (pl.elev > topLimit + 0.01) {
          st.warns.push("平台" + pl.no + "标高" + pl.elev + "m 超出塔顶，已压至塔顶");
          pl.elev = topLimit;
        }
        // 同抱杆分组内：本网排前
        pl.poles.forEach(function (po) {
          po.items.sort(function (a, b) { return (b.op.home ? 1 : 0) - (a.op.home ? 1 : 0); });
        });
      });

      if (st.platNum !== null && st.platforms.length && st.platforms.length !== st.platNum) {
        st.warns.push("主表平台数" + st.platNum + "与明细平台数" + st.platforms.length + "不一致，按明细绘制");
      }
      if (!st.platforms.length && st.platNum !== null && st.platNum > 0) {
        // 无明细但有平台数：生成空平台（均布标高）
        for (var i = 1; i <= st.platNum; i++) {
          st.platforms.push({
            no: i,
            elev: Math.round(topLimit * (0.55 + 0.4 * (st.platNum === 1 ? 0.5 : i / st.platNum)) * 10) / 10,
            poles: [], autoElev: true
          });
        }
        st.warns.push("无安装明细，仅绘制塔体与平台");
      }
    });

    /* 三期：设备/导线/材料表解析（默认表函数见本文件顶层） */
    function parseKitSheet(picked) {
      function rowsOf(k) { return k ? k.rows : null; }
      function findHdr(rows, must1, must2) {
        if (!rows) return -1;
        for (var r = 0; r < Math.min(rows.length, 8); r++) {
          var row = rows[r] || [], has1 = false, has2 = false;
          for (var c = 0; c < row.length; c++) {
            var h = pickStr(row[c]).replace(/\s/g, "");
            if (!h) continue;
            if (h.indexOf(must1) === 0) has1 = true;
            if (h.indexOf(must2) === 0) has2 = true;
          }
          if (has1 && has2) return r;
        }
        return -1;
      }
      function colOf(hdr, key) {
        var row = hdr >= 0 ? hdr : [];
        return row;
      }
      /* 设备表 */
      var devices = null;
      var dRows = rowsOf(picked.dev);
      var dH = findHdr(dRows, "名称", "单位");
      if (dH >= 0) {
        devices = [];
        var dh = dRows[dH];
        function findCol(row, names) {
          for (var c = 0; c < row.length; c++) {
            var h = pickStr(row[c]).replace(/\s/g, "");
            for (var i = 0; i < names.length; i++) if (h.indexOf(names[i]) === 0) return c;
          }
          return -1;
        }
        var cName = findCol(dh, ["名称"]), cModel = findCol(dh, ["型号"]),
            cSpec = findCol(dh, ["规格"]), cUnit = findCol(dh, ["单位"]),
            cOld = findCol(dh, ["原有"]), cAdd = findCol(dh, ["新增"]),
            cRmv = findCol(dh, ["拆除"]), cNote = findCol(dh, ["备注"]);
        for (var r = dH + 1; r < dRows.length; r++) {
          var row2 = dRows[r] || [];
          var nm = cName >= 0 ? pickStr(row2[cName]) : "";
          if (!nm || isWatermark(nm)) continue;
          devices.push({
            name: nm,
            model: cModel >= 0 ? pickStr(row2[cModel]) : "",
            spec: cSpec >= 0 ? pickStr(row2[cSpec]) : "",
            unit: cUnit >= 0 ? pickStr(row2[cUnit]) : "",
            old: cOld >= 0 ? pickStr(row2[cOld]) : "",
            add: cAdd >= 0 ? pickStr(row2[cAdd]) : "",
            rmv: cRmv >= 0 ? pickStr(row2[cRmv]) : "",
            note: cNote >= 0 ? pickStr(row2[cNote]) : ""
          });
        }
      }
      /* 导线表 */
      var cables = null;
      var cRows = rowsOf(picked.cab);
      var cH = findHdr(cRows, "由", "到");
      if (cH < 0) cH = findHdr(cRows, "导线编号", "敷设");
      if (cH >= 0) {
        cables = [];
        var ch = cRows[cH];
        var cNo = findCol(ch, ["导线编号"]), cFrom = findCol(ch, ["由"]), cTo = findCol(ch, ["到"]),
            cWay = findCol(ch, ["敷设"]), cSpec = findCol(ch, ["导线规格", "规格"]),
            cN = findCol(ch, ["条数"]), cLen = findCol(ch, ["长度"]),
            cCol = findCol(ch, ["颜色"]), cNote = findCol(ch, ["备注"]);
        for (var r3 = cH + 1; r3 < cRows.length; r3++) {
          var row3 = cRows[r3] || [];
          var f = cFrom >= 0 ? pickStr(row3[cFrom]) : "";
          if (!f || isWatermark(f)) continue;
          cables.push({
            no: cNo >= 0 ? pickStr(row3[cNo]) : "",
            from: f, to: cTo >= 0 ? pickStr(row3[cTo]) : "",
            way: cWay >= 0 ? pickStr(row3[cWay]) : "",
            spec: cSpec >= 0 ? pickStr(row3[cSpec]) : "",
            n: cN >= 0 ? pickStr(row3[cN]) : "",
            len: cLen >= 0 ? pickStr(row3[cLen]) : "",
            color: cCol >= 0 ? pickStr(row3[cCol]) : "",
            note: cNote >= 0 ? pickStr(row3[cNote]) : ""
          });
        }
      }
      /* 材料表 */
      var materials = null;
      var mRows2 = rowsOf(picked.mat);
      var mH = findHdr(mRows2, "名称", "单位");
      if (mH >= 0) {
        materials = [];
        var mh = mRows2[mH];
        var mName = findCol(mh, ["名称"]), mSpec = findCol(mh, ["规格"]), mUnit = findCol(mh, ["单位"]),
            mAdd = findCol(mh, ["新增"]), mRmv = findCol(mh, ["拆除"]), mNote = findCol(mh, ["备注"]);
        for (var r4 = mH + 1; r4 < mRows2.length; r4++) {
          var row4 = mRows2[r4] || [];
          var nm4 = mName >= 0 ? pickStr(row4[mName]) : "";
          if (!nm4 || isWatermark(nm4)) continue;
          materials.push({
            name: nm4,
            spec: mSpec >= 0 ? pickStr(row4[mSpec]) : "",
            unit: mUnit >= 0 ? pickStr(row4[mUnit]) : "",
            add: mAdd >= 0 ? pickStr(row4[mAdd]) : "",
            rmv: mRmv >= 0 ? pickStr(row4[mRmv]) : "",
            note: mNote >= 0 ? pickStr(row4[mNote]) : ""
          });
        }
      }
      return { devices: devices, cables: cables, materials: materials };
    }

    var kitParsed = parseKitSheet(picked);
    var kit = {
      devices: kitParsed.devices && kitParsed.devices.length ? kitParsed.devices : defaultDevices(),
      cables: kitParsed.cables && kitParsed.cables.length ? kitParsed.cables : defaultCables(),
      materials: kitParsed.materials && kitParsed.materials.length ? kitParsed.materials : null, // 每站单独推导
      fromSheets: {
        devices: !!kitParsed.devices, cables: !!kitParsed.cables, materials: !!kitParsed.materials
      }
    };
    if (!kitParsed.cables) warnings.push("未找到「导线表」，已按设计院标准 9 条导线路由生成");
    if (!kitParsed.devices) warnings.push("未找到「设备表」，已按标准 17 行设备清单生成");

    return { stations: stations, errors: errors, warnings: warnings, kit: kit };
  }

  /* ============================================================
   * 三期默认表（顶层）：设备表 / 导线表 / 材料表
   ============================================================ */
  function defaultDevices() {
    return [
      { name: "无线设备-主控板", model: "", spec: "", unit: "块", old: "", add: "", rmv: "", note: "" },
      { name: "无线设备-基带板", model: "", spec: "", unit: "块", old: "", add: "", rmv: "", note: "" },
      { name: "无线设备", model: "", spec: "", unit: "架", old: "", add: "", rmv: "", note: "" },
      { name: "GSM900无线设备", model: "", spec: "", unit: "架", old: "", add: "", rmv: "", note: "" },
      { name: "GSM1800无线设备", model: "", spec: "", unit: "架", old: "", add: "", rmv: "", note: "" },
      { name: "传输综合柜", model: "", spec: "600×600×2000", unit: "架", old: "", add: "", rmv: "", note: "" },
      { name: "交流配电箱/屏(AC)", model: "", spec: "", unit: "台", old: "", add: "", rmv: "", note: "" },
      { name: "嵌入开关电源(DC)", model: "", spec: "", unit: "架", old: "", add: "", rmv: "", note: "" },
      { name: "整流模块", model: "", spec: "", unit: "块", old: "", add: "", rmv: "", note: "" },
      { name: "蓄电池", model: "", spec: "", unit: "组", old: "", add: "", rmv: "", note: "" },
      { name: "空调", model: "", spec: "", unit: "台", old: "", add: "", rmv: "", note: "" },
      { name: "直流配电箱", model: "", spec: "", unit: "块", old: "", add: "", rmv: "", note: "" },
      { name: "地线排", model: "", spec: "", unit: "套", old: "", add: "", rmv: "", note: "" },
      { name: "基站门禁和监控", model: "", spec: "", unit: "架", old: "", add: "", rmv: "", note: "" },
      { name: "ODF(光纤配线架)", model: "", spec: "", unit: "台", old: "", add: "", rmv: "", note: "" },
      { name: "直流分配单元", model: "", spec: "", unit: "个", old: "", add: "", rmv: "", note: "" },
      { name: "光模块", model: "", spec: "", unit: "个", old: "", add: "", rmv: "", note: "" }
    ];
  }
  function defaultCables() {
    return [
      { no: "001", from: "直流分配单元", to: "BBU 设备", way: "架内", spec: "RVVZ 1×4mm", n: "2", len: "", color: "红色、蓝色", note: "5G设备厂家提供" },
      { no: "002", from: "高频开关组合电源", to: "直流分配单元", way: "走线架", spec: "RVZ-600V-1×16mm", n: "2", len: "", color: "黑色", note: "5G设备厂家提供" },
      { no: "003", from: "室内地排", to: "BBU 设备外壳", way: "走线架", spec: "RVZ-600V-1×6mm", n: "2", len: "", color: "黄绿色", note: "5G设备厂家提供" },
      { no: "004", from: "综合柜地排", to: "直流分配单元", way: "架内", spec: "RVZ-600V-1×6mm", n: "2", len: "", color: "黄绿色", note: "5G设备厂家提供" },
      { no: "005", from: "综合柜地排", to: "综合柜", way: "架内", spec: "RVZ-600V-1×16mm", n: "2", len: "", color: "黄绿色", note: "综合柜厂家提供" },
      { no: "006", from: "BBU 设备", to: "传输设备", way: "走线架", spec: "单模跳纤", n: "2", len: "", color: "黄色", note: "5G设备厂家提供" },
      { no: "007", from: "BBU 设备", to: "ODF", way: "走线架", spec: "单模跳线", n: "2", len: "", color: "黑色", note: "5G设备厂家提供" },
      { no: "008", from: "直流分配单元", to: "AAU", way: "走线架", spec: "RVVZ 2×6mm", n: "2", len: "详见天馈图", color: "红色、蓝色", note: "" },
      { no: "009", from: "BBU 设备", to: "GNSS", way: "走线架", spec: "1/2\"馈线", n: "1", len: "详见天馈图", color: "黑色", note: "" }
    ];
  }
  function defaultMaterials(st) {
    /* 从天线明细推导：单频/多频/RRU/GNSS/塔棅 */
    var total = 0, fiveG = 0, fourG = 0, poles = 0;
    (st ? st.platforms : []).forEach(function (pl) {
      pl.poles.forEach(function (po) {
        var hasHome = false;
        po.items.forEach(function (it) {
          if (!it.op.home) return;
          hasHome = true;
          total += it.count;
          if (/5G|NR/i.test(it.ran)) fiveG += it.count;
          else fourG += it.count;
        });
        if (hasHome) poles++;
      });
    });
    var m = [
      { name: "RRU", spec: "", unit: "副", add: "", rmv: "", note: "" },
      { name: "天线", spec: "", unit: "副", add: "", rmv: "", note: "" },
      { name: "光缆", spec: "2芯", unit: "米", add: "", rmv: "", note: "" },
      { name: "光缆加固卡子", spec: "", unit: "个", add: "", rmv: "", note: "" },
      { name: "RRU电源线", spec: "RVVZ 2×6mm²", unit: "米", add: "", rmv: "", note: "" },
      { name: "光模块", spec: "", unit: "个", add: "", rmv: "", note: "" },
      { name: "GNSS馈线", spec: "1/2\"馈线", unit: "米", add: "", rmv: "", note: "" },
      { name: "GNSS馈线接地线", spec: "", unit: "米", add: "", rmv: "", note: "" },
      { name: "GNSS天线(含避雷器)", spec: "", unit: "副", add: "", rmv: "", note: "" },
      { name: "塔棅", spec: st ? st.towerLabel : "", unit: "座", add: "", rmv: "", note: "" },
      { name: "电源线接地件", spec: "", unit: "套", add: "", rmv: "", note: "" },
      { name: "RRU接地线", spec: "1×16mm²", unit: "米", add: "", rmv: "", note: "" },
      { name: "集束电缆", spec: "4芯", unit: "根", add: "", rmv: "", note: "" },
      { name: "集束电缆", spec: "5芯", unit: "根", add: "", rmv: "", note: "" },
      { name: "单频天线", spec: "", unit: "副", add: "", rmv: "", note: "" },
      { name: "多频天线", spec: "", unit: "副", add: "", rmv: "", note: "" },
      { name: "射频跳线", spec: "", unit: "条", add: "", rmv: "", note: "" },
      { name: "电调控制线", spec: "", unit: "条", add: "", rmv: "", note: "" },
      { name: "GPS天线", spec: "", unit: "副", add: "", rmv: "", note: "" }
    ];
    m[0].add = poles || "";           // RRU≈本网抱杆数
    m[1].add = total || "";           // 天线总数
    m[8].add = 1;                     // GNSS 天线
    m[9].add = 1;                     // 塔棅
    m[14].add = fourG || "";          // 单频天线
    m[15].add = fiveG || "";          // 多频天线
    return m;
  }

  /* 统计：某站天线总数 */
  function antennaTotal(st) {
    var n = 0;
    st.platforms.forEach(function (pl) {
      pl.poles.forEach(function (po) { po.items.forEach(function (it) { n += it.count; }); });
    });
    return n;
  }

  window.DataModel = {
    parseWorkbook: parseWorkbook,
    antennaTotal: antennaTotal,
    recognizeTower: recognizeTower,
    recognizeOperator: recognizeOperator,
    TOWER_TYPES: TOWER_TYPES,
    defaultMaterials: defaultMaterials
  };
})();
