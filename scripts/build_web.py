"""
pack.py —— 把 web/ 下的分文件版本合并成一个可双击运行的单文件 HTML。

为什么要合成单文件：
  交付给辅导员的东西，不能是"一个文件夹里十几个文件，其中少一个就跑不起来"。
  单文件 = 双击就能用，复制到 U 盘、发微信都不会漏。

做法：
  把 <script src="xxx.js"> 全部替换成 <script>…文件内容…</script>，
  顺带把 JS 里出现的 </script 转义（否则会提前闭合标签，整页崩掉）。

用法：
  python pack.py            # 生成 查寝得分汇总工具.html + 一个冒烟测试版
"""
import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'
OUT_MAIN = ROOT / 'dist' / '查寝得分汇总工具_脱敏演示版.html'
OUT_SMOKE = WEB / '_smoke.html'

# 这两个第三方库必须用 base64 data URL 引入，不能直接内联。
# 原因：SheetJS 的源码里有 4 个 <!--...-->  正则，写进 <script> 后会触发
# HTML 解析器的「脚本内注释」状态，把后面的 </script> 吞掉，
# 导致整块代码被截断一半 —— 表现是 XLSX 变量没挂上，读表直接失效。
# data URL 不经过 HTML 解析，从根上绕开这个问题。
DATA_URL_FILES = {'vendor.bundle.js', 'xlsx.full.min.js'}

SMOKE_JS = r'''
<script>
/* 冒烟测试：确认单文件版里所有依赖都就位、构建流程能跑通 */
window.addEventListener('load', async () => {
  const rows = [];
  const chk = (label, ok, detail) => rows.push([label, ok, String(detail || '')]);
  const t0 = performance.now();

  chk('CORE 就位', !!window.CORE);
  chk('WRITER 就位', !!window.WRITER);
  chk('BUILD 就位', !!window.BUILD);
  chk('ExcelJS 就位', !!window.ExcelJS);
  chk('JSZip 就位', !!window.JSZip);
  chk('XLSX 就位', !!window.XLSX,
      'window.XLSX=' + (typeof window.XLSX) + ' 全局XLSX=' + (typeof window.eval('typeof XLSX')) +
      ' scripts=' + document.scripts.length);
  chk('脱敏名单 8 人', window.ROSTER && window.ROSTER.length === 8,
      window.ROSTER && window.ROSTER.length);

  try {
    // 用空文件跑一遍完整构建，验证出表管线不断
    const res = await window.BUILD.buildAll([{ week: '第7周', files: [] }]);
    chk('构建完成', true, res.count + ' 个表');
    const names = Object.keys(res.zip.files).filter(k => !res.zip.files[k].dir);
    chk('zip 内文件数', names.length === res.count, names.length + '/' + res.count);
    chk('含总表', names.some(n => n.includes('查寝得分总表')));
    chk('含周目录', names.some(n => n.includes('第七周/查寝全表_第7周.xlsx')));
    chk('空数据仍出 2 间', res.fullRows['第7周'].length === 2,
        res.fullRows['第7周'].length);
  } catch (e) {
    chk('构建完成', false, e.message);
  }

  const pass = rows.filter(r => r[1]).length;
  document.body.innerHTML = '<pre id="smoke">' +
    rows.map(([l, ok, d]) => `${ok ? '[OK]' : '[FAIL]'} ${l} ${d}`).join('\n') +
    `\n\nSMOKE ${pass}/${rows.length} ${Math.round(performance.now() - t0)}ms</pre>`;
  document.title = `SMOKE ${pass}/${rows.length}`;
});
</script>
'''


def inline(html: str) -> str:
    """把 <script src="x.js"> 换成可独立运行的形式。

    两类处理：
      * 第三方大库（DATA_URL_FILES）-> base64 data URL，完全避开 HTML 解析
      * 自己的代码 -> 直接内联（已确认不含 HTML 敏感序列，保留可读性）
    """
    def repl(m):
        src = m.group(1)
        f = WEB / src
        if not f.exists():
            raise SystemExit(f'缺少文件：{f}')

        if src in DATA_URL_FILES:
            b64 = base64.b64encode(f.read_bytes()).decode('ascii')
            return f'<script src="data:text/javascript;base64,{b64}"></script>'

        code = f.read_text(encoding='utf-8')
        # 自己代码也做一遍兜底转义：以后新增文件若含这些序列不至于炸
        code = re.sub(r'</script', r'<\\/script', code, flags=re.I)
        return f'<script>\n/* ==== {src} ==== */\n{code}\n</script>'

    return re.sub(r'<script src="([^"]+)"></script>', repl, html)


def refresh_browser_tests(html: str):
    """测试页复用当前 index.html，避免产品界面更新后仍在测试旧 DOM。"""
    for name in ('test_ui.html', 'test_paste.html'):
        path = WEB / name
        previous = path.read_text(encoding='utf-8')
        scripts = re.findall(r'<script>([\s\S]*?)</script>', previous)
        if not scripts:
            raise SystemExit(f'{name} 中找不到测试脚本')
        path.write_text(html.replace('</body>', '<script>' + scripts[-1] + '</script></body>'),
                        encoding='utf-8')
        print(f'已同步测试页：{path.name}')


def main():
    html = (WEB / 'index.html').read_text(encoding='utf-8')
    refresh_browser_tests(html)
    packed = inline(html)

    OUT_MAIN.parent.mkdir(parents=True, exist_ok=True)
    OUT_MAIN.write_text(packed, encoding='utf-8')
    size_mb = OUT_MAIN.stat().st_size / 1024 / 1024
    print(f'已生成：{OUT_MAIN}')
    print(f'  大小 {size_mb:.2f} MB')

    smoke = packed.replace('</body>', SMOKE_JS + '</body>')
    OUT_SMOKE.write_text(smoke, encoding='utf-8')
    print(f'冒烟版：{OUT_SMOKE}')

    # 检查是否还有未内联的外链（data: URL 是已内联的，排除）
    left = [x for x in re.findall(r'<script src="([^"]+)"', packed)
            if not x.startswith('data:')]
    print(f'  未内联的外链：{left if left else "无"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
