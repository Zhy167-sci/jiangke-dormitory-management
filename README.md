# 江科大宿舍管理

一个离线运行的查寝得分汇总项目，包含 **Python 命令行程序**和**单文件网页工具**。把学校原始评分表整理为按班级、按楼栋、全表和跨周总表，并提供异常核对、结果预览和 ZIP 下载。

> 公开仓库不包含真实学生名单、真实学号或原始查寝数据。`data/` 和 `web/testdata/` 中只有明确标注的虚构演示数据。

## 功能

- 读取 `.xls`、`.xlsx` 和 ZIP 评分表，可一次处理多周。
- 统一楼栋、寝室号、全角字符等写法。
- 同一周多次检查取平均，保留四个床位的位置。
- 生成班级表、楼栋表、全表与跨周总表。
- 检查未查到、未署名、重复文件和人数异常。
- 网页完全离线，不上传学生数据；输入改变后旧结果自动失效。
- 严重异常默认禁止下载，需人工明确确认。

## 目录

```text
src/          Python 主程序：配置、读取、清洗、聚合、出表、自检
web/          网页源码、内置第三方库和浏览器测试
tests/        Python 单元与脱敏数据测试
docs/         项目使用与维护说明
scripts/      演示数据生成、网页打包、公开前检查
assets/       项目图标
data/         脱敏名单与评分表；真实数据不得提交
out/          本地输出，Git 自动忽略
dist/         本地构建产物，Git 自动忽略
```

## 第一步：运行 Python 演示

需要 Python 3.10 或更高版本。

```bash
python -m pip install -r requirements.txt
python scripts/generate_demo_data.py
python tests/test_python.py
python src/main.py
```

成功后，结果位于 `out/`。默认使用 8 名虚构学生、2 间寝室和 2 周评分表。

## 第二步：运行网页演示

直接用浏览器打开 `web/index.html`，导入：

```text
web/testdata/第7周宿舍卫生得分.zip
web/testdata/第8周宿舍卫生得分.zip
```

点击“生成汇总表”，核对异常、预览和文件清单后下载。公开版网页使用虚构名单，不能直接用于本校真实上报。

构建可复制的脱敏单文件版：

```bash
python scripts/build_web.py
```

产物为 `dist/查寝得分汇总工具_脱敏演示版.html`。

## 真实数据怎样使用

真实名单和评分表只放在本机，不要提交到 Git。Python 版通过环境变量指定私有目录，不要求改动源码：

```powershell
$env:DORM_DATA_ROOT = "你的私有数据目录"
$env:DORM_ROSTER_FILE = "你的名单文件.xlsx"
python src/main.py 第7周
```

私有目录应包含名单文件以及 `第7周宿舍卫生得分/` 等周目录。网页真实名单的本地构建方式见 [使用说明](docs/USAGE.md)。

## 测试

```bash
python tests/test_python.py
node web/test_core.js
```

浏览器测试页：`web/test_ui.html`、`web/test_paste.html`、`web/test_e2e.html`。`test_core.js` 直接读取内置 SheetJS；`gen_zip.js` 的 Node 依赖可用 `npm install` 安装。

提交公开仓库前运行：

```bash
python scripts/check_public.py
```

## 开源与第三方组件

本项目代码使用 [MIT License](LICENSE)。网页内置 ExcelJS、JSZip 和 SheetJS；其版权和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 贡献

欢迎改进解析可靠性、异常核对、测试和项目文档。请先阅读 [贡献指南](CONTRIBUTING.md) 与 [隐私安全说明](SECURITY.md)，不要通过 Issue、PR 或测试附件上传真实学生信息。
