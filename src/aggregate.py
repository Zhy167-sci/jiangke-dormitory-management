"""
aggregate.py —— 聚合层：把“行”变成“寝室 / 班级 / 楼栋”的统计。

这一层回答四个问题
------------------
1. 一个学生本周的分数是多少？（同一周查了两次 -> 取平均）
2. 一间寝室本周的寝室得分是多少？（同理）
3. 按班级看：这个班有几间寝室、每间寝室 4 个床位分别是谁、多少分？
4. 按楼栋看：这栋楼里她管的每间寝室，整间 4 个人分别是谁、多少分？

一个重要的口径
--------------
“按班级”的表只列本班学生，其他床位留空（显示 —）；
“按楼栋”的表列整间所有人（含外班、含名单外），因为看的是这间寝室整体。
两种视角，两种口径，不要混。
"""

from decimal import Decimal, ROUND_HALF_UP

from config import EMPTY_BED_TEXT, OTHER_BED_TEXT, UNNAMED_TEXT, NOT_FOUND_TEXT
from normalize import room_key


def fmt_num(v):
    """数字转文字：80 -> '80'，77.5 -> '77.5'，80.63 -> '80.63'。

    为什么不用 str(80.0)：会得到 '80.0'，表里看着像精度丢失，
    和手工做的表对不上，也让人觉得数据不可靠。
    """
    if v is None:
        return ""
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, (int, float)):
        f = float(v)
        if f == int(f):
            return str(int(f))
        return f"{f:.2f}".rstrip("0").rstrip(".")
    return str(v)


def avg(values):
    """求平均，保留两位小数，四舍五入；空列表返回 None（不要返回 0！）。

    两个坑
    ------
    1. 没数据 ≠ 得 0 分。把缺失当 0 会悄悄拉低平均分，表面看不出来。
    2. **不能用内置 round()**。Python 的 round 是“银行家舍入”
       （round(80.625, 2) -> 80.62），而 Excel 和人的习惯是四舍五入（-> 80.63）。
       两者差 0.01，在汇总表里会被当成“算错了”。
       所以这里用 Decimal + ROUND_HALF_UP，和 Excel 口径一致。
    """
    vals = [Decimal(str(v)) for v in values if v is not None]
    if not vals:
        return None
    mean = sum(vals) / Decimal(len(vals))
    return float(mean.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def student_score(checks, name):
    """某个学生本周的分数：把他各次检查的分数取平均。"""
    got = []
    for chk in checks:
        for bed in chk["床位"]:
            if bed and bed["姓名"] == name and bed["得分"] is not None:
                got.append(bed["得分"])
    return avg(got)


def room_score(checks):
    """某间寝室本周的寝室得分：各次检查的寝室得分取平均。"""
    return avg([c["寝室得分"] for c in checks])


def full_room_beds(checks):
    """整间 4 个床位（用于“按楼栋”视角）。

    规则：
      * 人员名单取“最后一次检查”的排布（有人换床时以最新为准）
      * 每个人的分数 = 他各次分数的平均
      * 床位格完全为空 -> None（渲染成“空床”）
      * 有分数没姓名     -> 姓名留空，渲染成“未署名 92”

    关键：**必须返回固定 4 个位置**（空缺用 None 占位）。
    早期版本只返回“有人的床位”，结果 C16-115 那种第 1 床空着、
    2/3/4 床有人的寝室，写表时整体左移一格，
    把 2 床的人写进了“床位1”列——分数没错但人对错了床位。
    """
    if not checks:
        return [None, None, None, None]

    last = checks[-1]
    raw = last["床位"]
    beds = [None, None, None, None]

    for i in range(4):
        if i >= len(raw):
            continue                                  # 原始表这一行不足 4 格
        bed = raw[i]
        if bed is None:
            continue                                  # 这一格真的是空的
        name, score = bed["姓名"], bed["得分"]
        if not name and score is None:
            continue
        if name:
            score = student_score(checks, name) or score
        beds[i] = {"床号": i + 1, "姓名": name, "得分": score}
    return beds


def format_bed(bed, empty_text=EMPTY_BED_TEXT):
    """把床位渲染成表里显示的文字。

    empty_text 决定“这一格没有本人”时显示什么：
      * 按楼栋表 -> 「空床」（原始表真的没人）
      * 按班级表 -> 「—」（住的是别人，本表不关心）
    """
    if bed is None:
        return empty_text
    if not bed["姓名"]:
        return (f"{UNNAMED_TEXT} {fmt_num(bed['得分'])}"
                if bed["得分"] is not None else UNNAMED_TEXT)
    if bed["得分"] is None:
        return f"{bed['姓名']} {NOT_FOUND_TEXT}"
    return f"{bed['姓名']} {fmt_num(bed['得分'])}"


# ---------------------------------------------------------------- 按班级
def build_class_rows(students, cls, week_data):
    """生成一个班的表格行。

    每个元素：{
      '楼栋', '寝室号', '班级', '床位': [4 位], '个人均分', '寝室得分'
    }
    只放本班学生；其他床位为 None（表格里显示 —）。
    """
    mine = [s for s in students if s["班级"] == cls]
    keys = sorted({room_key(s["楼栋"], s["寝室号"]) for s in mine})

    rows = []
    for key in keys:
        room_students = [s for s in mine if room_key(s["楼栋"], s["寝室号"]) == key]
        checks = week_data.get(key, [])
        building = room_students[0]["楼栋"]
        room = room_students[0]["寝室号"]

        beds = [None, None, None, None]
        for stu in room_students:
            if stu["床号"] and 1 <= stu["床号"] <= 4:
                beds[stu["床号"] - 1] = {
                    "床号": stu["床号"],
                    "姓名": stu["姓名"],
                    "得分": student_score(checks, stu["姓名"]),
                }

        rows.append({
            "楼栋": building,
            "寝室号": room,
            "班级": cls,
            "床位": beds,
            "个人均分": avg([b["得分"] for b in beds if b]),
            "寝室得分": room_score(checks),
        })

    # 按楼栋、寝室号排序（楼栋按数字，寝室号按数字）
    rows.sort(key=lambda r: (int("".join(filter(str.isdigit, r["楼栋"])) or 9999),
                             int("".join(filter(str.isdigit, r["寝室号"])) or 9999),
                             r["寝室号"]))
    return rows


# ---------------------------------------------------------------- 按楼栋
def build_building_rows(students, building, week_data):
    """生成一栋楼的表格行：每间在她名下的寝室一行，整间 4 个床位全部列出。"""
    mine = [s for s in students if s["楼栋"] == building]
    rooms = {}
    for s in mine:
        rooms.setdefault(s["寝室号"], []).append(s)

    rows = []
    for room, room_students in rooms.items():
        key = room_key(building, room)
        checks = week_data.get(key, [])
        beds = full_room_beds(checks)
        rows.append({
            "楼栋": building,
            "寝室号": room,
            "班级": "+".join(sorted({s["班级"] for s in room_students})),
            "床位": beds,
            "个人均分": avg([b["得分"] for b in beds if b]),
            "寝室得分": room_score(checks),
        })

    rows.sort(key=lambda r: (int("".join(filter(str.isdigit, r["寝室号"])) or 9999),
                             r["寝室号"]))
    return rows
