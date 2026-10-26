"""
reader.py —— 读取层：把“文件”变成“内存里的行”。

职责边界
--------
只负责“读出来、找表头、按列名取数”，不做任何业务判断（谁属于谁班、怎么算平均）。
业务判断放 aggregate.py。这样分层的好处：
  学校表结构变了，只改本文件；口径变了，只改 aggregate.py。

三个必须处理的现实问题
----------------------
1. 表头不一定在第 1 行（评分表前面有标题行、日期行）。
2. 列的顺序不固定，甚至列数不一样（C16 就比别人多一列）。
   → 所以一律“按表头文字定位列”，绝不按第几列取数。
3. 旧格式 .xls 和新格式 .xlsx 要都能读（.xls 用 xlrd，.xlsx 用 openpyxl）。
"""

import re
from pathlib import Path

import openpyxl
import xlrd

from config import (DATA_ROOT, WEEKS, ROSTER_FILE, HEADER_KEYWORDS,
                    MERGE_RULES, EMPTY_BED_TEXT)
from normalize import (to_text, norm_name, norm_building, norm_room,
                       room_key, class_name, parse_sid)


# ---------------------------------------------------------------- 底层：读成二维表
def read_rows(path: Path):
    """把一个工作表读成 [[单元格文本, ...], ...]。

    返回所有单元格都已 to_text 处理过的二维列表，后续不用再关心格式。
    """
    path = Path(path)
    rows = []

    if path.suffix.lower() == ".xls":
        book = xlrd.open_workbook(str(path))
        sheet = book.sheet_by_index(0)
        for r in range(sheet.nrows):
            rows.append([to_text(sheet.cell_value(r, c)) for c in range(sheet.ncols)])
    else:
        book = openpyxl.load_workbook(str(path), data_only=True)
        sheet = book.worksheets[0]
        for row in sheet.iter_rows(values_only=True):
            rows.append([to_text(v) for v in row])
        book.close()

    return rows


def find_header(rows, keywords=HEADER_KEYWORDS, max_scan=20):
    """在前 max_scan 行里找表头行，返回行号；找不到返回 -1。

    判断依据：这一行必须同时包含 keywords 里的词（默认“寝室号”和“床位”）。
    为什么不用“第一行就是表头”：评分表第 1 行是标题、第 2 行是日期、第 3 行才是表头。
    """
    for i, row in enumerate(rows[:max_scan]):
        line = "|".join(row)
        if all(k in line for k in keywords):
            return i
    return -1


def col_of(header_row, alias_list):
    """按别名找列号，找不到返回 -1。

    注意：比较时把表头里的空格去掉，'楼 栋' 和 '楼栋' 视为同一列。
    """
    for idx, cell in enumerate(header_row):
        if to_text(cell).replace(" ", "") in alias_list:
            return idx
    return -1


# ---------------------------------------------------------------- 读学生名单
def read_roster(path: Path = None):
    """读学生名单，返回学生列表。

    名单文件的特点：一行一个学生，宿舍号写成 'C7-620' 这种“楼栋-房间”连写，
    没有班级列——班级要靠学号推出来。
    """
    from config import FIELD_ALIASES

    path = Path(path or Path(DATA_ROOT) / ROSTER_FILE)
    rows = read_rows(path)

    h = find_header(rows, keywords=("姓名", "学号"), max_scan=10)
    if h < 0:
        raise ValueError(f"名单里找不到表头（需要含“姓名”“学号”）：{path}")

    header = rows[h]
    c_name = col_of(header, FIELD_ALIASES["姓名"])
    c_sid = col_of(header, ["学号", "学籍号"])
    c_dorm = col_of(header, FIELD_ALIASES["寝室号"])
    c_bed = col_of(header, FIELD_ALIASES["床号"])

    if min(c_name, c_sid, c_dorm, c_bed) < 0:
        raise ValueError(f"名单缺少必要列，实际表头：{header}")

    students = []
    for row in rows[h + 1:]:
        name = norm_name(row[c_name])
        sid = to_text(row[c_sid]).replace(" ", "")
        if not name or not sid:
            continue

        # 'C7-620' -> 楼栋 C7 / 寝室 620
        dorm = to_text(row[c_dorm])
        m = re.match(r"^([A-Za-z]*\d+)\s*[-－—]?\s*(.+)$", dorm)
        building, room = (m.group(1).upper(), m.group(2)) if m else ("", dorm)

        bed = to_text(row[c_bed])
        stu = {
            "姓名": name,
            "学号": sid,
            "楼栋": building,
            "寝室号": norm_room(room),
            "床号": int(float(bed)) if bed.replace(".", "").isdigit() else None,
            "班级": MERGE_RULES.get(sid) or class_name(sid),   # 有特例就并班
        }
        stu["专业"] = parse_sid(sid)["major"]
        students.append(stu)

    return students


# ---------------------------------------------------------------- 读楼栋评分表
def parse_bed_cell(text):
    """解析床位格 '张明 95' -> {'姓名': '张明', '得分': 95.0}

    三种情况：
        '张明 95'  -> 正常
        '95'       -> 只有分数没姓名（原表漏写）
        ''         -> 空床位
    """
    text = to_text(text)
    if not text:
        return None

    m = re.match(r"^(.*?)\s*([\d.]+)\s*$", text)
    if m:
        name, score = norm_name(m.group(1)), float(m.group(2))
    else:
        name, score = norm_name(text), None

    return {"姓名": name, "得分": score}


def read_building_sheet(path: Path):
    """读一个楼栋评分表文件，返回 (楼栋, 日期, 寝室记录列表)。

    寝室记录：{'寝室号': '104', '寝室得分': 80.0, '床位': [{...}, None, {...}, {...}]}
    床位列表长度固定为 4，位置就是床位号（第 1 个元素 = 床位1）。
    """
    from config import FIELD_ALIASES

    path = Path(path)
    rows = read_rows(path)

    h = find_header(rows)
    if h < 0:
        raise ValueError(f"评分表找不到表头：{path.name}")

    header = rows[h]
    c_room = col_of(header, FIELD_ALIASES["寝室号"])
    c_score = col_of(header, FIELD_ALIASES["寝室得分"])
    bed_cols = [col_of(header, [f"床位{i}"]) for i in range(1, 5)]

    # 日期在表头之前的某一行，形如 '2026年10月12日'
    date = ""
    for row in rows[:h]:
        m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", " ".join(row))
        if m:
            date = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
            break

    # 楼栋从文件名的前缀取，例如 C16_20261012.xls -> C16
    building = norm_building(path.name.split("_")[0])

    records = []
    for row in rows[h + 1:]:
        if c_room < 0 or c_room >= len(row):
            continue
        room = norm_room(row[c_room])
        if not room or not re.search(r"\d", room):
            continue

        beds = []
        for c in bed_cols:
            beds.append(parse_bed_cell(row[c]) if 0 <= c < len(row) else None)

        score_text = row[c_score] if 0 <= c_score < len(row) else ""
        try:
            score = float(score_text)
        except (TypeError, ValueError):
            score = None

        records.append({"寝室号": room, "寝室得分": score, "床位": beds})

    return building, date, records


def load_week(week: str):
    """加载某一周的全部楼栋评分表。

    返回 {room_key: [ {日期, 寝室得分, 床位}, ... ]}
    同一寝室可能出现在多个文件里（同一周查了两次），所以 value 是列表。
    """
    folder = Path(DATA_ROOT) / WEEKS[week]
    data = {}

    for f in sorted(folder.iterdir()):
        if f.suffix.lower() not in {".xls", ".xlsx"}:
            continue
        # 跳过浏览器重复下载产生的 'xxx (1).xls'
        if re.search(r"\(\d+\)", f.name):
            continue
        building, date, records = read_building_sheet(f)
        for rec in records:
            key = room_key(building, rec["寝室号"])
            data.setdefault(key, []).append({
                "日期": date or f.stem.split("_")[-1],
                "寝室得分": rec["寝室得分"],
                "床位": rec["床位"],
            })

    # 按日期排序，后续“取最新一次”才有意义
    for key in data:
        data[key].sort(key=lambda x: x["日期"])
    return data
