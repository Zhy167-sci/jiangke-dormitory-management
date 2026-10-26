/**
 * test_core.js —— 用脱敏数据验证浏览器逻辑，并与 Python 版逐格对账。
 *
 * 为什么要在 Node 里测 core.js：
 *   core.js 不碰 DOM，可以直接跑。浏览器里调试困难，
 *   逻辑对错在这里先查清，搬到浏览器只是套界面。
 *
 * 运行：node test_core.js
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('./xlsx.full.min.js');
const CORE = require('./core.js');

// roster.js 是给浏览器用的（window.ROSTER），这里补一个 window
global.window = {};
require('./roster.js');
const ROSTER = global.window.ROSTER;

const ROOT = path.join(__dirname, '..', 'data');
const WEEKS = {
  第7周: '第7周宿舍卫生得分',
  第8周: '第8周宿舍卫生得分',
};

const passed = [];
const failed = [];
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  (ok ? passed : failed).push({ label, got, want });
};

/* ---------------------------------------------------------------- 1. 逻辑单元 */

check('楼栋 3号楼', CORE.normBuilding('3号楼'), '3');
check('楼栋 三号楼', CORE.normBuilding('三号楼'), '3');
check('楼栋 十二号楼', CORE.normBuilding('十二号楼'), '12');
check('楼栋 二十一号楼', CORE.normBuilding('二十一号楼'), '21');
check('楼栋 C6', CORE.normBuilding('C6'), '6');

check('寝室 3-301', CORE.normRoom('3-301'), '301');
check('寝室 1204室', CORE.normRoom('1204室'), '1204');
check('寝室 Ａ－２０１', CORE.normRoom('Ａ－２０１'), 'A201');
check('寝室 a201', CORE.normRoom('a201'), 'A201');

check('平均 空', CORE.avg([]), null);
check('平均 80.315 -> 80.32', CORE.avg([83.13, 77.5]), 80.32);
check('平均 78.755 -> 78.76', CORE.avg([76.88, 80.63]), 78.76);
check('平均 80.005 -> 80.01', CORE.avg([80.0, 80.01]), 80.01);
check('平均 跳过 null', CORE.avg([80, null, 90]), 85);

check('数字 80.0', CORE.fmtNum(80.0), '80');
check('数字 77.5', CORE.fmtNum(77.5), '77.5');

check('床位解析', CORE.parseBedCell('张明 95'), { name: '张明', score: 95 });
check('床位只有分数', CORE.parseBedCell('92'), { name: '', score: 92 });
check('床位空', CORE.parseBedCell(''), null);

// 固定 4 格：第 1 床空时不得左移
const beds = CORE.fullRoomBeds([{
  date: '10-12', score: 75,
  beds: [null, { name: '张三', score: 80 }, { name: '李四', score: 70 }, null],
}]);
check('床位固定 4 格', beds.length, 4);
check('1 床空', beds[0], null);
check('2 床是张三', beds[1] && beds[1].name, '张三');
check('2 床床号', beds[1] && beds[1].bed, 2);
check('3 床床号', beds[2] && beds[2].bed, 3);

check('名单人数', ROSTER.length, 8);
check('名单字段无学号', Object.keys(ROSTER[0]).sort(), ['b', 'c', 'd', 'n', 'r']);

/* ---------------------------------------------------------------- 2. 真实数据 */

console.log('\n读取脱敏原始表 …');
const weekData = {};

for (const [week, folder] of Object.entries(WEEKS)) {
  const dir = path.join(ROOT, folder);
  const files = fs.readdirSync(dir)
    .filter(f => /\.xlsx?$/i.test(f) && !/\(\d+\)/.test(f))
    .map(f => {
      const buffer = fs.readFileSync(path.join(dir, f));
      return { name: f, buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
    });

  const { data, skipped } = CORE.loadWeek(files, XLSX);
  weekData[week] = data;
  console.log(`  ${week}：${files.length} 个文件 → ${data.size} 间寝室` +
              (skipped.length ? `，跳过 ${skipped.length} 个` : ''));
  check(`${week} 无解析失败`, skipped.length, 0);
}

// 班级聚合
const CLASSES = [...new Set(ROSTER.map(s => s.c))].sort((a, b) =>
  (a.startsWith('计科') ? 0 : 1) - (b.startsWith('计科') ? 0 : 1) ||
  CORE.normBuilding(a.split('级')[1]) - CORE.normBuilding(b.split('级')[1]));

const classTables = {};
for (const week of Object.keys(WEEKS)) {
  classTables[week] = {};
  for (const cls of CLASSES) {
    classTables[week][cls] = CORE.buildClassRows(ROSTER, cls, weekData[week]);
  }
}

// 人数守恒
for (const [week, tables] of Object.entries(classTables)) {
  let n = 0;
  for (const rows of Object.values(tables)) {
    for (const r of rows) n += r.beds.filter(b => b && b.name).length;
  }
  check(`${week} 人数合计`, n, 8);
}

/* ---------------------------------------------------------------- 3. 与 Python 版对账 */

console.log('\n与 Python 版逐格对账 …');

const PY_OUT = path.join(__dirname, '..', 'out');
const weekDir = { 第7周: '第七周', 第8周: '第八周' };

if (!fs.existsSync(PY_OUT)) {
  console.log('  （Python 版输出不存在，跳过对账：' + PY_OUT + '）');
} else {
  let cells = 0, diffs = [];

  for (const [week, dirName] of Object.entries(weekDir)) {
    for (const cls of CLASSES) {
      const no = cls.match(/(\d+)班/)[1];
      const major = cls.startsWith('计科') ? '计科' : '信安';
      const pyFile = path.join(PY_OUT, dirName, '按班级分类', cls, `${major}${no}班_${week}.xlsx`);
      if (!fs.existsSync(pyFile)) continue;

      const wb = XLSX.read(fs.readFileSync(pyFile), { type: 'buffer' });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      // 表头第 3 行（索引 2），数据从第 4 行
      const pyRows = {};
      for (let r = 3; r < aoa.length; r++) {
        const room = CORE.toText(aoa[r][1]);
        if (!room) continue;
        pyRows[room] = {
          b1: CORE.toText(aoa[r][2]), b2: CORE.toText(aoa[r][3]),
          b3: CORE.toText(aoa[r][4]), b4: CORE.toText(aoa[r][5]),
          avg: aoa[r][6], room: aoa[r][7],
        };
      }

      const jsRows = {};
      for (const r of classTables[week][cls]) {
        const cell = b => {
          if (!b) return '—';
          if (!b.name) return b.score === null ? '未署名' : `未署名 ${CORE.fmtNum(b.score)}`;
          return b.score === null ? `${b.name} 未查到` : `${b.name} ${CORE.fmtNum(b.score)}`;
        };
        jsRows[r.room] = {
          b1: cell(r.beds[0]), b2: cell(r.beds[1]),
          b3: cell(r.beds[2]), b4: cell(r.beds[3]),
          avg: r.personAvg === null ? '—' : r.personAvg,
          room: r.roomScore === null ? '未查到' : r.roomScore,
        };
      }

      for (const room of Object.keys(pyRows)) {
        if (!jsRows[room]) { diffs.push(`${week} ${cls} ${room}：JS 缺行`); continue; }
        for (const k of ['b1', 'b2', 'b3', 'b4', 'avg', 'room']) {
          cells++;
          const a = jsRows[room][k], b = pyRows[room][k];
          const same = typeof a === 'number' && typeof b === 'number'
            ? Math.abs(a - b) < 1e-9
            : String(a) === String(b);
          if (!same) diffs.push(`${week} ${cls} ${room} ${k}：JS「${a}」vs PY「${b}」`);
        }
      }
      for (const room of Object.keys(jsRows)) {
        if (!pyRows[room]) diffs.push(`${week} ${cls} ${room}：PY 缺行`);
      }
    }
  }

  check('班级表逐格与 Python 一致', diffs.length, 0);
  if (diffs.length) {
    console.log(`  差异 ${diffs.length} 处，前 8 条：`);
    diffs.slice(0, 8).forEach(d => console.log('    · ' + d));
  } else {
    console.log(`  ${cells} 个单元格全部一致`);
  }
}

/* ---------------------------------------------------------------- 4. 自检 */

for (const week of Object.keys(WEEKS)) {
  const buildingTables = {};
  for (const bld of [...new Set(ROSTER.map(s => s.b))]) {
    buildingTables[bld] = CORE.buildBuildingRows(ROSTER, bld, weekData[week]);
  }
  const issues = CORE.verify(ROSTER, weekData[week], classTables[week], buildingTables);
  const severe = issues.filter(i => i.level === '严重');
  check(`${week} 自检无严重问题`, severe.length, 0);
  const info = issues.filter(i => i.level === '提示');
  if (info.length) info.forEach(i => console.log(`  [提示] ${i.msg}`));
}

/* ---------------------------------------------------------------- 汇总 */

const total = passed.length + failed.length;
console.log(`\n${'='.repeat(56)}`);
console.log(`测试结果：${passed.length} / ${total} 通过`);
console.log('='.repeat(56));
if (failed.length) {
  console.log('\n失败明细：');
  failed.forEach(f => {
    console.log(`  ✗ ${f.label}`);
    console.log(`      期望：${JSON.stringify(f.want)}`);
    console.log(`      实际：${JSON.stringify(f.got)}`);
  });
  process.exit(1);
}
console.log('全部通过。');
