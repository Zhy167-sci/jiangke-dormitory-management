"""
test.py —— 单元测试。运行：python test.py

为什么要有这个文件
------------------
这些函数平时看不出问题，一换数据就出错，而错了往往"表看着很正常"。
比如寝室号被读成 104.0、第 1 床空着导致其余床位左移一格、
平均分 80.315 舍成 80.31 —— 这三种错误在表格里都不会报错，
只会静默地把错的数字交给领导。

所以每个测试用例后面都写清"这条是防什么坑"。改代码时先跑这个文件。

约定：不用 pytest，直接 python test.py 就能跑，不装任何额外依赖。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from normalize import (to_text, cn_to_int, norm_building, norm_room,
                       norm_name, room_key, parse_sid, class_name)
from aggregate import avg, fmt_num, full_room_beds, format_bed
from reader import parse_bed_cell
from config import MERGE_RULES, EMPTY_BED_TEXT, OTHER_BED_TEXT

_passed = 0
_failed = []
_current_group = ""


def group(name):
    global _current_group
    _current_group = name


def check(label, got, want):
    global _passed
    if got == want:
        _passed += 1
    else:
        _failed.append((_current_group, label, got, want))


# ============================================================ 1. 文本清洗
group("文本清洗")

check("None -> 空串", to_text(None), "")
# xlrd 把 .xls 里的整数读成 float，104 会变成 104.0，
# 不还原就永远匹配不上名单里的 "104"
check("浮点整数还原", to_text(104.0), "104")
check("浮点小数保留", to_text(77.5), "77.5")
check("全角数字转半角", to_text("３０１"), "301")
check("全角空格当普通空格", to_text("\u3000张三\u3000"), "张三")
check("去首尾空白", to_text("  301  "), "301")


# ============================================================ 2. 楼栋归一
group("楼栋归一")

check("3号楼", norm_building("3号楼"), "3")
check("3栋", norm_building("3栋"), "3")
check("三号楼（中文数字）", norm_building("三号楼"), "3")
check("十二号楼", norm_building("十二号楼"), "12")     # 早期版本只认一到十，这里是回归点
check("十二栋", norm_building("十二栋"), "12")
check("二十号楼", norm_building("二十号楼"), "20")
check("二十一号楼", norm_building("二十一号楼"), "21")
check("全角３号楼", norm_building("３号楼"), "3")
check("C6 -> 6（内部键）", norm_building("C6"), "6")
check("12栋", norm_building("12栋"), "12")
check("B栋（无数字）", norm_building("B栋"), "B")

check("中文数字 三", cn_to_int("三"), 3)
check("中文数字 十", cn_to_int("十"), 10)
check("中文数字 十二", cn_to_int("十二"), 12)
check("中文数字 二十", cn_to_int("二十"), 20)
check("中文数字 二十一", cn_to_int("二十一"), 21)
check("中文数字 九十九", cn_to_int("九十九"), 99)
check("非中文数字", cn_to_int("abc"), None)


# ============================================================ 3. 寝室号归一
group("寝室号归一")

check("纯数字", norm_room("301"), "301")
check("带楼栋前缀 3-301", norm_room("3-301"), "301")   # 同一间寝室两种写法必须归一
check("带“室”", norm_room("1204室"), "1204")
check("全角字母数字", norm_room("Ａ－２０１"), "A201")
check("小写字母转大写", norm_room("a201"), "A201")
check("去空格", norm_room(" 301 "), "301")
check("破折号变体", norm_room("A—201"), "A201")
check("房间号", norm_room("301房间"), "301")

# 楼栋 + 寝室号才是唯一键：C6-104 和 C8-104 是两间寝室
check("键 C6-104", room_key("C6", "104"), "6#104")
check("键 C8-104", room_key("C8", "104"), "8#104")
check("不同楼栋不相等", room_key("C6", "104") == room_key("C8", "104"), False)


# ============================================================ 4. 姓名归一
group("姓名归一")

check("中间空格", norm_name("张 明"), "张明")
check("全角空格", norm_name("张\u3000明"), "张明")
# 少数民族名字里的间隔号必须保留，去掉就变成另一个人
check("保留间隔号", norm_name("麦尔旦·麦提图尔迪"), "麦尔旦·麦提图尔迪")
check("首尾空白", norm_name(" 张三 "), "张三")


# ============================================================ 5. 平均与舍入
group("平均与舍入")

# 没数据 ≠ 得 0 分。返回 0 会静默拉低整班平均分
check("空列表返回 None", avg([]), None)
check("全 None 返回 None", avg([None, None]), None)
check("跳过 None", avg([80, None, 90]), 85.0)
check("单个值", avg([95]), 95.0)

# Python 内置 round 是“银行家舍入”，round(80.315, 2) 会给 80.31，
# 而 Excel 和人的习惯是 80.32。差 0.01 会被当成算错。
check(".x5 进位（80.315）", avg([83.13, 77.5]), 80.32)
check(".x5 进位（78.755）", avg([76.88, 80.63]), 78.76)
check(".x5 进位（80.005）", avg([80.0, 80.01]), 80.01)
check("普通平均", avg([80, 90]), 85.0)
check("循环小数取两位", avg([80, 81]), 80.5)

group("数字转文字")

check("整数不带小数点", fmt_num(80.0), "80")
check("一位小数", fmt_num(77.5), "77.5")
check("两位小数", fmt_num(80.63), "80.63")
check("None", fmt_num(None), "")
check("整数 int", fmt_num(95), "95")


# ============================================================ 6. 床位解析
group("床位单元格解析")

bed = parse_bed_cell("张明 95")
check("姓名", bed["姓名"], "张明")
check("分数", bed["得分"], 95.0)

bed = parse_bed_cell("麦尔旦·麦提图尔迪 95")
check("少数民族名", bed["姓名"], "麦尔旦·麦提图尔迪")
check("少数民族名分数", bed["得分"], 95.0)

# 原表漏写姓名只写分数，这种情况必须保留分数，不能当没人
bed = parse_bed_cell("92")
check("只有分数-姓名空", bed["姓名"], "")
check("只有分数-分数保留", bed["得分"], 92.0)

check("空字符串", parse_bed_cell(""), None)
check("None", parse_bed_cell(None), None)


# ============================================================ 7. 整间床位（错位坑）
group("整间床位不错位")

# 关键回归点：第 1 床空着、2/3/4 床有人时，
# 早期版本返回 3 条记录，写表时整体左移一格，
# 2 床的人被写进“床位1”列——分数对、人对错。
chk = {
    "日期": "10-12",
    "寝室得分": 75.0,
    "床位": [
        None,                                          # 1 床真空
        {"姓名": "张三", "得分": 80.0},                  # 2 床
        {"姓名": "李四", "得分": 70.0},                  # 3 床
        None,                                          # 4 床真空
    ],
}
beds = full_room_beds([chk])

check("固定 4 个位置", len(beds), 4)
check("1 床为空", beds[0], None)
check("2 床是张三", beds[1]["姓名"], "张三")
check("2 床床号是 2", beds[1]["床号"], 2)
check("3 床是李四", beds[2]["姓名"], "李四")
check("3 床床号是 3", beds[2]["床号"], 3)     # 早期版本这里会是 2
check("4 床为空", beds[3], None)

check("无检查记录也返回 4 格", len(full_room_beds([])), 4)


# ============================================================ 8. 床位渲染
group("床位渲染")

check("空床（按楼栋表）", format_bed(None), EMPTY_BED_TEXT)
# 同一个空格子在两种表里含义不同：
#   按楼栋表 -> 这床位真的没人 -> 空床
#   按班级表 -> 这床位住的是别人 -> —
check("非本班（按班级表）", format_bed(None, OTHER_BED_TEXT), OTHER_BED_TEXT)
check("正常", format_bed({"姓名": "张三", "得分": 85.0}), "张三 85")
check("有名字没分数", format_bed({"姓名": "张三", "得分": None}), "张三 未查到")
check("有分数没名字", format_bed({"姓名": "", "得分": 92.0}), "未署名 92")


# ============================================================ 9. 学号解码
group("学号解码")

p = parse_sid("269990701131")
check("年级", p["grade"], "26")
check("专业", p["major"], "计科")
check("显示班号 11->1", p["class_no"], 1)
check("学号班号", p["sid_class"], 11)
check("班内序号", p["seq"], "31")

check("计科16班->6班", class_name("269990701601"), "计科26级6班")
check("信安1班", class_name("269990710101"), "信安26级1班")
check("信安4班", class_name("269990710401"), "信安26级4班")
check("25级学生", class_name("259990701409"), "计科25级4班")
check("非法学号", class_name("abc"), "未知班级")

# 开源仓库默认不包含本校并班特例，避免泄露真实学号与业务规则。
check("公开版不含私有并班规则", MERGE_RULES, {})


# ============================================================ 10. 脱敏数据冒烟
group("脱敏数据冒烟")

try:
    from reader import read_roster
    students = read_roster()
    rooms = {(s["楼栋"], s["寝室号"]) for s in students}
    check("名单人数", len(students), 8)
    check("寝室数", len(rooms), 2)
    check("班级数", len({s["班级"] for s in students}), 2)
    check("床号都在 1~4", all(1 <= s["床号"] <= 4 for s in students), True)
    check("学号不重复", len({s["学号"] for s in students}), 8)
except Exception as e:      # 原始文件不在时，跳过而不是判失败
    print(f"  （跳过：{e}）")


# ============================================================ 汇总
total = _passed + len(_failed)
print(f"\n{'=' * 56}")
print(f"测试结果：{_passed} / {total} 通过")
print("=" * 56)

if _failed:
    print("\n失败明细：")
    last = None
    for grp, label, got, want in _failed:
        if grp != last:
            print(f"\n[{grp}]")
            last = grp
        print(f"  ✗ {label}")
        print(f"      期望：{want!r}")
        print(f"      实际：{got!r}")
    sys.exit(1)

print("全部通过。")
