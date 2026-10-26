/**
 * build.js —— 纯构建逻辑：文件 → 全部表格 → zip
 *
 * 从 app.js 里抽出来单独一层，原因只有一个：**要能测**。
 * 绑在 DOM 上的代码没法自动验证，抽出来之后
 * 测试页可以直接调 buildAll()，逐项检查生成的 zip 内容。
 *
 * 依赖：XLSX / ExcelJS / JSZip / CORE / WRITER / ROSTER（均为全局）
 */
(function (root) {
  'use strict';

  /** 周次 -> 目录名：第7周 -> 第七周 */
  function weekDirName(week) {
    const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const m = String(week).match(/(\d+)/);
    if (!m) return week;
    const n = parseInt(m[1], 10);
    const cn = n <= 10 ? CN[n] : (n < 20 ? '十' + (n % 10 ? CN[n % 10] : '') : String(n));
    return `第${cn}周`;
  }

  /** 楼栋目录名补零：C6 -> C06楼（只影响排序，表内标题仍写 C6） */
  function buildDir(bld) {
    const m = String(bld).match(/^([A-Za-z]*)(\d+)$/);
    if (!m) return bld + '楼';
    return `${m[1]}${m[2].padStart(2, '0')}楼`;
  }

  function sortClasses(list) {
    return list.slice().sort((a, b) => {
      const ka = (a.startsWith('计科') ? 0 : 1) * 10000 + (parseInt(a.split('级')[1], 10) || 0);
      const kb = (b.startsWith('计科') ? 0 : 1) * 10000 + (parseInt(b.split('级')[1], 10) || 0);
      return ka - kb;
    });
  }

  function sortBuildings(list) {
    return list.slice().sort(
      (a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0));
  }

  /**
   * @param {{week:string, files:Array<{name,buffer}>}[]} groups
   * @param {function} onProgress  (step, text) 进度回调，可选
   * @returns {Promise<{zip, count, weeks, issues, rank, classTables, buildingTables, fullRows}>}
   */
  async function buildAll(groups, onProgress) {
    const say = onProgress || (() => {});
    const roster = window.ROSTER;
    const CORE = window.CORE;
    const W = window.WRITER;

    const weeks = groups.map(g => g.week);
    if (!weeks.length) throw new Error('没有可处理的周次');
    if (weeks.some(w => !w)) throw new Error('有周次未填写');

    /* ---------- 1. 读表 ---------- */
    say('read', '正在解析评分表 …');
    const weekData = {};
    const skippedAll = {};
    const ignoredAll = {};
    const warningsAll = {};
    for (const g of groups) {
      const { data, skipped, ignored, warnings } = CORE.loadWeek(g.files, window.XLSX);
      weekData[g.week] = data;
      skippedAll[g.week] = skipped;
      ignoredAll[g.week] = ignored || [];
      warningsAll[g.week] = warnings || [];
    }

    const classes = sortClasses([...new Set(roster.map(s => s.c))]);
    const buildings = sortBuildings([...new Set(roster.map(s => s.b))]);

    /* ---------- 2. 聚合 + 自检 ---------- */
    say('calc', '正在汇总 …');
    const classTables = {}, buildingTables = {}, fullRows = {}, issues = [];

    for (const wk of weeks) {
      classTables[wk] = {};
      for (const cls of classes) {
        classTables[wk][cls] = CORE.buildClassRows(roster, cls, weekData[wk]);
      }
      buildingTables[wk] = {};
      for (const bld of buildings) {
        buildingTables[wk][bld] = CORE.buildBuildingRows(roster, bld, weekData[wk]);
      }
      fullRows[wk] = CORE.buildFullRows(roster, weekData[wk]);

      for (const i of CORE.verify(roster, weekData[wk], classTables[wk], buildingTables[wk])) {
        issues.push({ week: wk, ...i });
      }
      for (const s of skippedAll[wk]) {
        issues.push({ week: wk, level: '严重', msg: `文件未纳入汇总：${s}` });
      }
      for (const s of ignoredAll[wk]) {
        issues.push({ week: wk, level: '提示', msg: `跳过重复文件 ${s}` });
      }
      for (const s of warningsAll[wk]) {
        issues.push({ week: wk, level: '提示', msg: s });
      }
    }

    /* ---------- 3. 排名 ---------- */
    const rank = classes.map(cls => {
      const per = {};
      for (const wk of weeks) per[wk] = W.avgOf(classTables[wk][cls].map(r => r.roomScore));
      const vals = Object.values(per).filter(v => typeof v === 'number');
      const overall = vals.length
        ? Math.round(vals.reduce((a, v) => a + Math.round(v * 100), 0) / vals.length) / 100
        : null;
      return { cls, per, overall };
    }).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

    /* ---------- 4. 出表 ---------- */
    say('write', '正在生成 Excel …');
    const zip = new JSZip();
    const rootFolder = zip.folder('查寝得分汇总');
    let count = 0;

    for (const wk of weeks) {
      const wdir = rootFolder.folder(weekDirName(wk));

      for (const cls of classes) {
        const rows = classTables[wk][cls];
        if (!rows.length) continue;
        const no = (cls.match(/(\d+)班/) || [])[1] || '';
        const major = cls.startsWith('计科') ? '计科' : '信安';
        const wb = new ExcelJS.Workbook();
        wb.creator = '查寝得分汇总工具';
        W.classSheet(wb, cls, wk, rows);
        wdir.folder('按班级分类').folder(cls)
          .file(`${major}${no}班_${wk}.xlsx`, await wb.xlsx.writeBuffer());
        count++;
      }

      for (const bld of buildings) {
        const rows = buildingTables[wk][bld];
        if (!rows.length) continue;
        const dn = buildDir(bld);
        const wb = new ExcelJS.Workbook();
        wb.creator = '查寝得分汇总工具';
        W.buildingSheet(wb, bld, wk, rows);
        wdir.folder('按寝室楼分类').folder(dn)
          .file(`${dn}_${wk}.xlsx`, await wb.xlsx.writeBuffer());
        count++;
      }

      const wbFull = new ExcelJS.Workbook();
      wbFull.creator = '查寝得分汇总工具';
      W.fullSheet(wbFull, wk, fullRows[wk]);
      wdir.file(`查寝全表_${wk}.xlsx`, await wbFull.xlsx.writeBuffer());
      count++;
    }

    const wbMaster = new ExcelJS.Workbook();
    wbMaster.creator = '查寝得分汇总工具';
    W.masterSheet(wbMaster, weeks, roster, classTables, buildingTables);
    rootFolder.file('查寝得分总表.xlsx', await wbMaster.xlsx.writeBuffer());
    count++;

    say('zip', '正在打包 …');
    return { zip, count, weeks, issues, rank, classTables, buildingTables, fullRows, weekData };
  }

  root.BUILD = { buildAll, weekDirName, buildDir, sortClasses, sortBuildings };
}(typeof self !== 'undefined' ? self : this));
