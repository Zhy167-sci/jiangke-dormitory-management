# 使用与维护说明

## 1. 公开演示与真实使用的区别

仓库公开的是代码和虚构数据。公开网页内的“示例学生”仅用于演示，不能生成真实班级结果。

## 2. Python 真实数据目录

把真实数据放在仓库外的私有目录，例如由你自行选择的文件夹：

```text
私有数据目录/
├─ 你的名单.xlsx
├─ 第7周宿舍卫生得分/
│  ├─ C6_日期.xls
│  └─ 其他楼栋.xls
└─ 第8周宿舍卫生得分/
```

在 PowerShell 中设置：

```powershell
$env:DORM_DATA_ROOT = "你的私有数据目录"
$env:DORM_ROSTER_FILE = "你的名单.xlsx"
python src/main.py 第7周
```

需要新增周次时，在 `src/config.py` 的 `WEEKS` 增加对应关系；这项业务配置变更不应包含真实文件路径。

## 3. 网页真实名单的本地维护

网页需要 `window.ROSTER`，字段为：

```javascript
{ n: "姓名", b: "楼栋", r: "寝室号", d: 床号, c: "班级" }
```

在本机由真实名单生成 `web/roster.js` 后运行 `python scripts/build_web.py`，即可得到内嵌名单的单文件网页。这个文件已受 Git 跟踪，真实版本**不要提交**。更稳妥的做法是先克隆一份私有仓库，在私有副本里生成真实版本。

生成后的 HTML 也含名单，只能交给获授权的使用者，不能上传到公开 Release。

## 4. 出表规则

- 同一寝室同周多次检查：分数取平均。
- 人员布局：取最后一次检查，床位固定四格。
- 按班级：只显示本班学生，其他床显示“—”。
- 按楼栋：保留整间原始床位，空床显示“空床”。
- 平均分：四舍五入保留两位，无有效数据不等于 0 分。

## 5. 修改后的验证

```bash
python tests/test_python.py
python src/main.py
node web/test_core.js
python scripts/build_web.py
```

再打开三个浏览器测试页检查界面、粘贴和端到端流程。真实业务变更还应由 Python 与网页处理同一份数据并逐格对账。
