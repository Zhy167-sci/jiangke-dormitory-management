/**
 * core.js —— 查寝汇总的全部业务逻辑（浏览器 / Node 通用）
 *
 * 这一层不碰 DOM、不碰 Excel 文件格式，只做三件事：
 *   1. 把脏数据洗干净（normalize）
 *   2. 名单 × 得分表 做匹配并算平均（aggregate）
 *   3. 自检（verify）
 *
 * 读 .xls / 写 .xlsx 分别交给 XLSX 和 ExcelJS，逻辑与文件格式解耦，
 * 这样将来换库或换格式，这一层不用改。
 *
 * 逻辑与 src/ 中的 Python 版对应，两版可互相对账。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CORE = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================================================ 一、文本清洗 */

  /** 全角字符转半角，去首尾空白。
   *  C 里要自己写查表，这里一个正则搞定。
   *  注意浮点整数：104.0 必须变成 "104"，否则和名单永远对不上。 */
  function toText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
      // 浮点整数还原（xlrd/SheetJS 都可能给 104.0）
      return Number.isInteger(v) ? String(v) : String(v);
    }
    let s = String(v);
    // 全角 -> 半角（FF01-FF5E -> 21-7E）
    s = s.replace(/[\uFF01-\uFF5E]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.replace(/\u3000/g, ' ');        // 全角空格
    return s.trim();
  }

  const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  /** 中文数字转整数，支持 1~99：三 -> 3，十二 -> 12，二十一 -> 21。
   *  学校文件里「3号楼」和「三号楼」会混着出现。 */
  function cnToInt(text) {
    if (!text) return null;
    if (/^\d+$/.test(text)) return parseInt(text, 10);
    let total = 0, section = 0, seen = false;
    for (const ch of text) {
      if (ch === '十') {
        section = section === 0 ? 1 : section;
        total += section * 10;
        section = 0;
        seen = true;
      } else if (ch in CN_DIGIT) {
        section = CN_DIGIT[ch];
        seen = true;
      } else {
        return null;
      }
    }
    return seen ? total + section : null;
  }

  /** 楼栋归一：'3号楼' '三号楼' '3栋' '十二号楼' 'C6' -> '3' / '12' / '6'
   *  C6 归一成 6 是为了做内部键；表里给人看的仍用原始写法。 */
  function normBuilding(v) {
    let s = toText(v).replace(/\s/g, '');
    // 先把中文数字段换成阿拉伯数字（十二 -> 12）
    s = s.replace(/[零一二三四五六七八九十]+/g, m => {
      const n = cnToInt(m);
      return n === null ? m : String(n);
    });
    const m = s.match(/\d+/);
    if (m) return String(parseInt(m[0], 10));
    return s.replace(/[号楼栋座#]/g, '');
  }

  /** 寝室号归一：'301' '3-301' '301室' 'Ａ－２０１' ' 301 ' -> '301' / 'A201' */
  function normRoom(v) {
    let s = toText(v).replace(/\s/g, '').toUpperCase();
    s = s.replace(/[－—–_]/g, '-');
    s = s.replace(/(寝室|房间|室)$/, '');
    s = s.replace(/^\d+-/, '');        // 3-301 -> 301（数字楼栋前缀整个删掉）
    return s.replace(/-/g, '');        // A-201 -> A201（字母前缀只去连字符）
  }

  /** 姓名归一：去掉所有空格，保留少数民族名的间隔号「·」 */
  function normName(v) {
    return toText(v).replace(/\s/g, '');
  }

  /** 寝室唯一键：楼栋#寝室号。C6-104 和 C8-104 是两间不同的寝室。 */
  function roomKey(building, room) {
    return normBuilding(building) + '#' + normRoom(room);
  }

  /** 解析床位格 '张明 95' -> {name:'张明', score:95}
   *  '95' -> {name:'', score:95}（原表漏写姓名，分数必须保留）
   *  ''   -> null（真的空床） */
  function parseBedCell(text) {
    const s = toText(text);
    if (!s) return null;
    const m = s.match(/^(.*?)\s*([\d.]+)\s*$/);
    if (m) return { name: normName(m[1]), score: parseFloat(m[2]) };
    return { name: normName(s), score: null };
  }

  /* ============================================================ 二、平均数 */

  /** 求平均，保留 2 位，四舍五入；无数据返回 null（绝不返回 0）。
   *
   *  为什么不用 (a+b)/2 再 toFixed(2)：
   *    JS 里 80.315 的实际存储是 80.31499999…，toFixed(2) 给 80.31，
   *    而 Excel 和人的习惯是 80.32。差 0.01 会被当成算错。
   *  做法：全部换算成「分」的整数再算，整数运算没有浮点误差。
   */
  function avg(values) {
    const vals = values.filter(v => v !== null && v !== undefined &&
                                    typeof v === 'number' && !Number.isNaN(v));
    if (!vals.length) return null;
    const cents = vals.map(v => Math.round(v * 100));
    const sum = cents.reduce((a, b) => a + b, 0);
    return Math.round(sum / cents.length) / 100;
  }

  /** 数字转文字：80 -> '80'，77.5 -> '77.5'，80.63 -> '80.63'
   *  避免 80.0 这种看着像精度丢失的写法。 */
  function fmtNum(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
  }

  /* ============================================================ 三、读表 */

  // 列名别名：学校表格改版时，加一个别名就能兼容
  const FIELD_ALIASES = {
    寝室号: ['寝室号', '宿舍号', '房间号', '寝室', '宿舍'],
    寝室得分: ['寝室得分', '宿舍得分', '寝室分数'],
    姓名: ['姓名', '学生姓名', '学生'],
  };

  function colOf(header, aliases) {
    for (let i = 0; i < header.length; i++) {
      const t = toText(header[i]).replace(/\s/g, '');
      if (aliases.some(a => t === a || t.includes(a))) return i;
    }
    return -1;
  }

  /** 在二维数组里找表头行：同时含「寝室号」和「床位」的那一行。 */
  function findHeader(aoa) {
    for (let r = 0; r < Math.min(20, aoa.length); r++) {
      const joined = (aoa[r] || []).map(toText).join('|');
      if (joined.includes('寝室号') || joined.includes('宿舍号')) {
        if (joined.includes('床位')) return r;
      }
    }
    return -1;
  }

  /** 解析一个楼栋评分表（二维数组）。
   *  返回 {building, date, records}
   *  records: [{room, score, beds:[4]}]
   */
  function readBuildingAoa(aoa, fileName) {
    const h = findHeader(aoa);
    if (h < 0) return { building: '', date: '', records: [], error: '找不到表头' };

    const header = aoa[h];
    const cRoom = colOf(header, FIELD_ALIASES.寝室号);
    const cScore = colOf(header, FIELD_ALIASES.寝室得分);
    const bedCols = [1, 2, 3, 4].map(i => colOf(header, ['床位' + i]));

    // 日期在表头之前，形如「2026年10月12日」
    let date = '';
    for (let r = 0; r < h; r++) {
      const m = (aoa[r] || []).map(toText).join(' ')
        .match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (m) {
        date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
        break;
      }
    }

    // 楼栋从文件名取：C16_20261012.xls -> C16
    const building = normBuilding(String(fileName).split('_')[0]);

    const records = [];
    for (let r = h + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      if (cRoom < 0 || cRoom >= row.length) continue;
      const room = normRoom(row[cRoom]);
      if (!room || !/\d/.test(room)) continue;

      const beds = bedCols.map(c =>
        (c >= 0 && c < row.length) ? parseBedCell(row[c]) : null);

      let score = null;
      if (cScore >= 0 && cScore < row.length) {
        const s = toText(row[cScore]);
        score = s === '' ? null : (Number.isNaN(Number(s)) ? null : Number(s));
      }
      records.push({ room, score, beds });
    }

    return { building, date, records };
  }

  /** 把一组 {name, buffer} 文件变成周数据：{roomKey: [检查...]}
   *  同一寝室一周查两次，所以 value 是数组，按日期排序。
   */
  function loadWeek(files, XLSX) {
    const data = new Map();
    const skipped = [];      // 解析失败
    const ignored = [];      // 内容完全相同的重复文件
    const warnings = [];     // 文件名像副本、但内容不同，不能擅自跳过
    const seenFiles = [];

    for (const f of files) {
      if (!/\.xlsx?$/i.test(f.name)) continue;

      let aoa;
      try {
        const wb = XLSX.read(f.buffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      } catch (e) {
        skipped.push(`${f.name}（无法解析：${e.message}）`);
        continue;
      }

      const { building, date, records, error } = readBuildingAoa(aoa, f.name);
      if (error) { skipped.push(`${f.name}（${error}）`); continue; }

      // XLS 重新保存可能只改变元数据，因此按解析后的楼栋、日期和全部记录判重。
      const signature = JSON.stringify({ building, date, records });
      const previous = seenFiles.find(item => item.signature === signature);
      if (previous) {
        ignored.push(`${f.name}（与 ${previous.name} 的表内数据相同）`);
        continue;
      }
      if (/\(\d+\)/.test(f.name)) {
        warnings.push(`${f.name} 文件名像下载副本，但表内数据不同，已纳入计算，请核对`);
      }
      seenFiles.push({ name: f.name, signature });

      for (const rec of records) {
        const k = roomKey(building, rec.room);
        if (!data.has(k)) data.set(k, []);
        data.get(k).push({
          date: date || (f.name.replace(/\.xlsx?$/i, '').split('_').pop()),
          score: rec.score,
          beds: rec.beds,
        });
      }
    }

    // 按日期排序，后面「取最新一次」才有意义
    for (const list of data.values()) {
      list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
    return { data, skipped, ignored, warnings };
  }

  /* ============================================================ 四、聚合 */

  /** 某个学生本周的分数：把他各次检查的分数取平均。 */
  function studentScore(checks, name) {
    const got = [];
    for (const c of checks) {
      for (const b of c.beds) {
        if (b && b.name === name && typeof b.score === 'number') got.push(b.score);
      }
    }
    return avg(got);
  }

  /** 某间寝室本周的寝室得分 */
  function roomScore(checks) {
    return avg(checks.map(c => c.score));
  }

  /** 整间 4 个床位（按楼栋视角）。
   *
   *  必须返回固定 4 个位置，空缺用 null 占位。
   *  早期版本只返回「有人的床位」，第 1 床空着时其余整体左移一格，
   *  2 床的人被写进「床位1」列 —— 分数对、人对错。
   */
  function fullRoomBeds(checks) {
    if (!checks.length) return [null, null, null, null];
    const last = checks[checks.length - 1];
    const beds = [null, null, null, null];

    for (let i = 0; i < 4; i++) {
      const b = last.beds[i];
      if (!b) continue;
      if (!b.name && b.score === null) continue;
      beds[i] = {
        bed: i + 1,
        name: b.name,
        score: b.name ? (studentScore(checks, b.name) ?? b.score) : b.score,
      };
    }
    return beds;
  }

  /** 按班级：只列本班学生，其他床位显示 —（不是「空床」） */
  function buildClassRows(roster, cls, weekData) {
    const mine = roster.filter(s => s.c === cls);
    const groups = new Map();
    for (const s of mine) {
      const k = roomKey(s.b, s.r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }

    const rows = [];
    for (const [k, members] of groups) {
      const checks = weekData.get(k) || [];
      const beds = [null, null, null, null];
      for (const s of members) {
        if (s.d >= 1 && s.d <= 4) {
          beds[s.d - 1] = { bed: s.d, name: s.n, score: studentScore(checks, s.n) };
        }
      }
      rows.push({
        bld: members[0].b,
        room: members[0].r,
        cls,
        beds,
        personAvg: avg(beds.filter(Boolean).map(b => b.score)),
        roomScore: roomScore(checks),
        checkCount: checks.length,
      });
    }
    rows.sort((a, b) => cmpRoom(a.bld, b.bld) || cmpNum(a.room, b.room));
    return rows;
  }

  /** 按楼栋：整间 4 个床位全部列出（含外班、含名单外） */
  function buildBuildingRows(roster, bld, weekData) {
    const mine = roster.filter(s => s.b === bld);
    const groups = new Map();
    for (const s of mine) {
      if (!groups.has(s.r)) groups.set(s.r, []);
      groups.get(s.r).push(s);
    }

    const rows = [];
    for (const [room, members] of groups) {
      const checks = weekData.get(roomKey(bld, room)) || [];
      const beds = fullRoomBeds(checks);
      rows.push({
        bld, room,
        cls: [...new Set(members.map(s => s.c))].sort().join('+'),
        beds,
        personAvg: avg(beds.filter(Boolean).map(b => b.score)),
        roomScore: roomScore(checks),
        checkCount: checks.length,
      });
    }
    rows.sort((a, b) => cmpNum(a.room, b.room));
    return rows;
  }

  /** 全表：一周一张，所有寝室按楼栋号 → 门牌号排序 */
  function buildFullRows(roster, weekData) {
    const groups = new Map();
    for (const s of roster) {
      const k = roomKey(s.b, s.r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }

    const rows = [];
    for (const [k, members] of groups) {
      const checks = weekData.get(k) || [];
      const beds = fullRoomBeds(checks);
      rows.push({
        bld: members[0].b,
        room: members[0].r,
        cls: [...new Set(members.map(s => s.c))].sort().join('+'),
        beds,
        personAvg: avg(beds.filter(Boolean).map(b => b.score)),
        roomScore: roomScore(checks),
        checkCount: checks.length,
      });
    }
    rows.sort((a, b) => cmpRoom(a.bld, b.bld) || cmpNum(a.room, b.room));
    return rows;
  }

  function cmpNum(a, b) {
    const na = parseInt(String(a).replace(/\D/g, ''), 10) || 9999;
    const nb = parseInt(String(b).replace(/\D/g, ''), 10) || 9999;
    return na - nb;
  }
  function cmpRoom(ba, bb) { return cmpNum(ba, bb); }

  /* ============================================================ 五、自检 */

  /** 跑完自查：人数守恒、寝室守恒、重复计人、可追溯。
   *  返回 [{level:'严重'|'提示', msg}] —— 严重不为空时不允许交付。 */
  function verify(roster, weekData, classTables, buildingTables) {
    const issues = [];
    const add = (level, msg) => issues.push({ level, msg });

    // 1. 人数守恒：每个班表里的人数必须等于名单人数
    let total = 0;
    const seenRooms = new Map();
    for (const [cls, rows] of Object.entries(classTables)) {
      let people = 0;
      for (const r of rows) {
        for (const b of r.beds) {
          if (b && b.name) {
            people++;
            const key = `${b.name}`;
            if (!seenRooms.has(key)) seenRooms.set(key, new Set());
            seenRooms.get(key).add(`${r.bld}-${r.room}`);
          }
        }
      }
      total += people;
      const expect = roster.filter(s => s.c === cls).length;
      if (people !== expect) add('严重', `${cls}：表内 ${people} 人，名单 ${expect} 人`);
    }
    if (total !== roster.length) {
      add('严重', `全部班级表合计 ${total} 人，名单 ${roster.length} 人`);
    }

    // 2. 同名判定：同名不同人是合法的，同名且同住才是真危险
    const nameCount = {};
    const nameRooms = {};
    for (const s of roster) {
      nameCount[s.n] = (nameCount[s.n] || 0) + 1;
      if (!nameRooms[s.n]) nameRooms[s.n] = new Set();
      nameRooms[s.n].add(roomKey(s.b, s.r));
    }
    for (const [name, places] of seenRooms) {
      const rooms = [...places];
      if ((nameCount[name] || 0) > 1) {
        if (nameRooms[name].size < nameCount[name]) {
          add('严重', `「${name}」有 ${nameCount[name]} 人同名且同住，按姓名匹配会串分`);
        } else {
          add('提示', `「${name}」有 ${nameCount[name]} 人同名（不同学号），分住 ${rooms.join('、')}，已按不同人处理`);
        }
      } else if (rooms.length > 1) {
        add('严重', `「${name}」出现在 ${rooms.length} 间寝室：${rooms.join('、')}，疑似重复计人`);
      }
    }

    // 3. 寝室守恒：楼栋表覆盖的寝室数必须等于名单里的寝室数
    const rosterRooms = new Set(roster.map(s => roomKey(s.b, s.r)));
    const tableRooms = new Set();
    for (const rows of Object.values(buildingTables)) {
      for (const r of rows) tableRooms.add(roomKey(r.bld, r.room));
    }
    if (tableRooms.size !== rosterRooms.size) {
      add('严重', `楼栋表覆盖 ${tableRooms.size} 间，名单 ${rosterRooms.size} 间`);
    }
    for (const k of rosterRooms) {
      if (!tableRooms.has(k)) add('严重', `寝室 ${k.replace('#', '-')} 未出现在任何楼栋表`);
    }

    // 4. 未查到：名单有人但评分表无记录
    let missing = 0;
    for (const rows of Object.values(classTables)) {
      for (const r of rows) if (r.roomScore === null) missing++;
    }
    if (missing) add('提示', `${missing} 间寝室本周无检查记录（表内标「未查到」）`);

    return issues;
  }

  return {
    toText, cnToInt, normBuilding, normRoom, normName, roomKey, parseBedCell,
    avg, fmtNum, readBuildingAoa, loadWeek, findHeader, colOf,
    studentScore, roomScore, fullRoomBeds,
    buildClassRows, buildBuildingRows, buildFullRows,
    verify, FIELD_ALIASES,
    CONFIG: { PAD: 2 },
  };
}));
