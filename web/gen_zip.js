/**
 * gen_zip.js —— 在 Node 里跑一遍网页版的构建逻辑，把 zip 落到磁盘上，用来检查真实产物。
 *
 * 为什么要这个：网页里的下载没法直接看内容，
 * 但用户拿到的就是这个 zip，必须能拆开逐项核对。
 *
 * 用法：node gen_zip.js
 */
const fs = require('fs');
const path = require('path');

// 模拟浏览器的全局环境（core/writer/build 都是 UMD）
global.window = {};
global.self = global.window;

require('./roster.js');                       // window.ROSTER
global.window.CORE = require('./core.js');
global.window.WRITER = require('./writer.js');
global.window.ExcelJS = require('exceljs');
global.window.JSZip = require('jszip');
global.window.XLSX = require('xlsx');
// build.js 里是裸用 ExcelJS / JSZip / XLSX，node 下要挂到 global
global.ExcelJS = global.window.ExcelJS;
global.JSZip = global.window.JSZip;
global.XLSX = global.window.XLSX;

require('./build.js');                        // window.BUILD

const ROOT = path.join(__dirname, '..', 'data');
const FOLDERS = {
  第7周: '第7周宿舍卫生得分',
  第8周: '第8周宿舍卫生得分',
};

(async () => {
  const groups = [];
  for (const [week, folder] of Object.entries(FOLDERS)) {
    const dir = path.join(ROOT, folder);
    if (!fs.existsSync(dir)) { console.log('缺目录', dir); continue; }
    const files = fs.readdirSync(dir)
      .filter(f => /\.xlsx?$/i.test(f))
      .map(f => {
        const buffer = fs.readFileSync(path.join(dir, f));
        return { name: f, buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
      });
    groups.push({ week, files });
  }

  const res = await global.window.BUILD.buildAll(groups, (s, t) => console.log('  [' + s + '] ' + t));
  const buf = await res.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const out = path.join(__dirname, '..', 'dist', '脱敏演示汇总.zip');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`\n已写出 ${out}  ${(buf.length / 1024).toFixed(1)} KB`);

  // 打印完整目录树
  const names = Object.keys(res.zip.files).sort();
  console.log(`\nzip 内共 ${names.length} 个条目：`);
  for (const n of names) {
    const isDir = res.zip.files[n].dir;
    console.log((isDir ? '[D] ' : '    ') + n);
  }

  console.log('\n自检：', res.issues.length ? res.issues.map(i => i.level + ' ' + i.msg).join('\n      ') : '无异常');
})().catch(e => { console.error(e); process.exit(1); });
