/**
 * writer.js —— 出表层：把聚合结果写成带格式的 Excel（浏览器版，用 ExcelJS）
 *
 * 和 Python 版的 writer.py + report.py 一一对应：
 *   班级表 / 楼栋表 / 全表 / 总表
 *
 * 为什么必须用 ExcelJS 而不是 SheetJS：
 *   SheetJS 免费版能写数据，但**写不进样式**（列宽、底色、合并、A4 打印设置全丢）。
 *   交付给领导看的表，没有这些打印出来会很难看。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WRITER = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    head: 'FF1F4E79',      // 表头深蓝
    band: 'FFF4F7FA',      // 斑马纹
    line: 'FFBFC7D2',      // 边框
    warn: 'FFB45309',      // 空床橙
    bad: 'FFFCE8E8',       // 未查到浅红
    top3: 'FFFFF3E0',      // 前三名
  };
  const FONT = '微软雅黑';

  const font = (size, bold, color) => {
    const f = { name: FONT, size: size || 10, bold: !!bold };
    if (color) f.color = { argb: color };
    return f;
  };
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const side = { style: 'thin', color: { argb: C.line } };
  const border = () => ({ left: side, right: side, top: side, bottom: side });

  /** 通用写表：标题（合并）+ 副标题（合并）+ 表头 + 数据 + 打印设置 */
  function writeTable(ws, { title, subtitle, headers, body, widths, landscape, badRows, bandStart }) {
    const n = headers.length;

    // 标题
    ws.mergeCells(1, 1, 1, n);
    const t = ws.getCell(1, 1);
    t.value = title;
    t.font = font(15, true);
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    // 副标题
    ws.mergeCells(2, 1, 2, n);
    const s = ws.getCell(2, 1);
    s.value = subtitle;
    s.font = font(9, false, 'FF6B7280');
    s.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 20;

    // 表头
    headers.forEach((h, i) => {
      const c = ws.getCell(3, i + 1);
      c.value = h;
      c.font = font(10, true, 'FFFFFFFF');
      c.fill = fill(C.head);
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = border();
    });
    ws.getRow(3).height = 32;

    // 数据
    body.forEach((row, ri) => {
      const r = ri + 4;
      row.forEach((v, ci) => {
        const c = ws.getCell(r, ci + 1);
        c.value = v;
        c.font = font(10);
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = border();

        const isBad = badRows && badRows.has(ri);
        if (isBad || v === '未查到') c.fill = fill(C.bad);
        else if (bandStart && r <= bandStart) c.fill = fill(C.top3);
        else if (r % 2 === 0) c.fill = fill(C.band);

        if (v === '空床') c.font = font(10, true, C.warn);
      });
      ws.getRow(r).height = 23;
    });

    // 列宽
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    // 冻结表头
    ws.views = [{ state: 'frozen', ySplit: 3 }];

    // 打印：A4、一页宽
    ws.pageSetup = {
      paperSize: 9,
      orientation: landscape ? 'landscape' : 'portrait',
      fitToWidth: 1,
      fitToHeight: 0,
      fitToPage: true,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };
    return ws;
  }

  /* ---------------------------------------------------------------- 单元格渲染 */

  const EMPTY = '空床';

  function bedText(b, emptyText) {
    if (!b) return emptyText;
    if (!b.name) return b.score === null ? '未署名' : `未署名 ${fmtNum(b.score)}`;
    if (b.score === null) return `${b.name} 未查到`;
    return `${b.name} ${fmtNum(b.score)}`;
  }

  function fmtNum(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
  }

  function avgOf(list) {
    const vals = list.filter(v => typeof v === 'number' && !Number.isNaN(v));
    if (!vals.length) return '—';
    const cents = vals.map(v => Math.round(v * 100));
    return Math.round(cents.reduce((a, b) => a + b, 0) / cents.length) / 100;
  }

  /* ---------------------------------------------------------------- 四类表 */

  /** 班级表：只列本班学生，其他床位显示 — */
  function classSheet(wb, cls, week, rows) {
    const ws = wb.addWorksheet(cls);
    const body = [];
    const bad = new Set();

    rows.forEach((r, i) => {
      const beds = r.beds.map(b => bedText(b, '—'));
      if (beds.some(t => t.endsWith('未查到')) || r.roomScore === null) bad.add(i);
      body.push([
        r.bld, r.room, ...beds,
        r.personAvg === null ? '—' : r.personAvg,
        r.roomScore === null ? '未查到' : r.roomScore,
      ]);
    });

    const people = rows.reduce((a, r) => a + r.beds.filter(b => b && b.name).length, 0);
    return writeTable(ws, {
      title: `${cls}　查寝得分汇总`,
      subtitle: `${week}　寝室 ${rows.length} 间 / ${people} 人　寝室均分 ${avgOf(rows.map(r => r.roomScore))}`,
      headers: ['楼栋', '寝室号', '床位1', '床位2', '床位3', '床位4', '个人均分', '寝室得分'],
      body,
      widths: [7, 10, 17, 17, 17, 17, 11, 11],
      landscape: false,
      badRows: bad,
    });
  }

  /** 楼栋表：整间 4 个床位全部列出（含外班、含名单外） */
  function buildingSheet(wb, bld, week, rows) {
    const ws = wb.addWorksheet(`${bld}楼`);
    const body = [];
    const bad = new Set();

    rows.forEach((r, i) => {
      const beds = r.beds.map(b => bedText(b, EMPTY));
      if (r.roomScore === null) bad.add(i);
      body.push([
        r.room, r.cls, ...beds,
        r.personAvg === null ? '—' : r.personAvg,
        r.roomScore === null ? '未查到' : r.roomScore,
      ]);
    });

    return writeTable(ws, {
      title: `${bld} 栋 查寝得分汇总`,
      subtitle: `${week}　寝室 ${rows.length} 间　寝室均分 ${avgOf(rows.map(r => r.roomScore))}`,
      headers: ['寝室号', '班级', '床位1', '床位2', '床位3', '床位4', '个人均分', '寝室得分'],
      body,
      widths: [10, 30, 17, 17, 17, 17, 11, 11],
      landscape: true,
      badRows: bad,
    });
  }

  /** 全表：一周一张，所有寝室按楼栋号 → 门牌号排 */
  function fullSheet(wb, week, rows) {
    const ws = wb.addWorksheet('查寝全表');
    const body = [];
    let people = 0;

    rows.forEach((r, i) => {
      const beds = r.beds.map(b => bedText(b, EMPTY));
      people += r.beds.filter(b => b && b.name).length;
      body.push([
        i + 1, r.bld, r.room, r.cls, ...beds,
        r.personAvg === null ? '—' : r.personAvg,
        r.roomScore === null ? '未查到' : r.roomScore,
      ]);
    });

    return writeTable(ws, {
      title: `查寝全表（${week}）`,
      subtitle: `${week}　共 ${rows.length} 间寝室 / ${people} 人　按楼栋号、寝室门牌号排序　寝室均分 ${avgOf(rows.map(r => r.roomScore))}`,
      headers: ['序号', '楼栋', '寝室号', '班级', '床位1', '床位2', '床位3', '床位4', '个人均分', '寝室得分'],
      body,
      widths: [6, 7, 9, 26, 17, 17, 17, 17, 11, 11],
      landscape: true,
    });
  }

  /** 总表：班级汇总（含排名）+ 楼栋汇总 + 寝室明细 */
  function masterSheet(wb, weeks, roster, classTables, buildingRows) {
    const multiWeek = weeks.length > 1;
    // ---------- 班级汇总 ----------
    const classes = [...new Set(roster.map(s => s.c))];
    const data = classes.map(cls => {
      const people = roster.filter(s => s.c === cls).length;
      const perWeek = {};
      let roomCount = 0;
      for (const w of weeks) {
        const rows = classTables[w][cls] || [];
        roomCount = Math.max(roomCount, rows.length);
        perWeek[w] = avgOf(rows.map(r => r.roomScore));
      }
      const vals = Object.values(perWeek).filter(v => typeof v === 'number');
      const overall = vals.length
        ? Math.round(vals.reduce((a, v) => a + Math.round(v * 100), 0) / vals.length) / 100
        : null;
      return { cls, people, roomCount, perWeek, overall };
    });
    data.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

    const ws = wb.addWorksheet('班级汇总');
    const body = data.map((d, i) => {
      const row = [
        i + 1, d.cls, d.cls.startsWith('计科') ? '计科' : '信安', d.people, d.roomCount,
        ...weeks.map(w => (typeof d.perWeek[w] === 'number' ? d.perWeek[w] : '—')),
      ];
      if (multiWeek) row.push(d.overall ?? '—');
      return row;
    });

    writeTable(ws, {
      title: '查寝得分　班级汇总',
      subtitle: `${weeks.join('、')}　${classes.length} 个班　学生 ${roster.length} 人　按${multiWeek ? '各周平均分' : '本周寝室均分'}排序`,
      headers: ['名次', '班级', '专业', '人数', '寝室',
        ...weeks.map(w => `${w}寝室均分`), ...(multiWeek ? ['各周平均'] : [])],
      body,
      widths: [7, 18, 8, 8, 8, ...weeks.map(() => 15), ...(multiWeek ? [12] : [])],
      landscape: false,
      bandStart: 3,          // 第 4~6 行 = 前三名
    });

    // ---------- 楼栋汇总 ----------
    const ws2 = wb.addWorksheet('楼栋汇总');
    const blds = [...new Set(roster.map(s => s.b))]
      .sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0));

    const body2 = blds.map(bld => {
      const people = roster.filter(s => s.b === bld).length;
      const rooms = new Set(roster.filter(s => s.b === bld).map(s => s.r)).size;
      return [
        bld, rooms, people,
        ...weeks.map(w => {
          const rows = (buildingRows[w] || {})[bld] || [];
          const v = avgOf(rows.map(r => r.roomScore));
          return v === '—' ? '—' : v;
        }),
      ];
    });

    writeTable(ws2, {
      title: '查寝得分　楼栋汇总',
      subtitle: `${weeks.join('、')}　${blds.length} 栋楼`,
      headers: ['楼栋', '寝室', '在册人数', ...weeks],
      body: body2,
      widths: [10, 9, 11, ...weeks.map(() => 13)],
      landscape: false,
    });

    // ---------- 寝室明细 ----------
    const ws3 = wb.addWorksheet('寝室明细');
    const roomCls = new Map();
    for (const s of roster) {
      const k = `${s.b}|${s.r}`;
      if (!roomCls.has(k)) roomCls.set(k, new Set());
      roomCls.get(k).add(s.c);
    }
    const keys = [...roomCls.keys()].sort((x, y) => {
      const [bx, rx] = x.split('|'), [by, ry] = y.split('|');
      return (parseInt(bx.replace(/\D/g, ''), 10) || 0) - (parseInt(by.replace(/\D/g, ''), 10) || 0) ||
             (parseInt(rx, 10) || 0) - (parseInt(ry, 10) || 0);
    });

    const body3 = keys.map(k => {
      const [bld, room] = k.split('|');
      const vals = weeks.map(w => {
        const rows = ((buildingRows[w] || {})[bld] || []).filter(r => r.room === room);
        return rows.length ? rows[0].roomScore : null;
      });
      let change = '—';
      if (vals.length >= 2 && typeof vals[0] === 'number' && typeof vals[vals.length - 1] === 'number') {
        const d = Math.round((vals[vals.length - 1] - vals[0]) * 100) / 100;
        change = (d >= 0 ? '+' : '') + d.toFixed(2);
      }
      const row = [
        bld, room, [...roomCls.get(k)].sort().join('+'),
        ...vals.map(v => (typeof v === 'number' ? v : '—')),
      ];
      if (multiWeek) row.push(change);
      return row;
    });

    writeTable(ws3, {
      title: '查寝得分　寝室明细',
      subtitle: `${weeks.join('、')}　共 ${keys.length} 间${multiWeek ? '　变化 = 最后一周 − 第一周' : ''}`,
      headers: ['楼栋', '寝室号', '班级', ...weeks, ...(multiWeek ? ['变化'] : [])],
      body: body3,
      widths: [9, 10, 30, ...weeks.map(() => 11), ...(multiWeek ? [10] : [])],
      landscape: true,
    });

    return wb;
  }

  return { writeTable, classSheet, buildingSheet, fullSheet, masterSheet, avgOf, fmtNum };
}));
