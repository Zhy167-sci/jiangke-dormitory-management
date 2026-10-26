"""
report.py —— 跨周汇总层：全表 与 总表。

和 writer.py 的分工
-------------------
    writer.py  只管“一张表怎么长”（单个班 / 单栋楼）
    report.py  管“多张表怎么汇总”（一周全部寝室、两周对比排名）

这样分的原因：单表格式会随学校模板改，汇总口径会随领导要求改，
两件事改的频率不同，放一个文件里会互相牵扯。

两种产物
--------
    全表  ：一周一张，90 间寝室排成一张长表，按楼栋号 → 门牌号排序
    总表  ：跨周，班级排名 + 楼栋对比 + 寝室明细，用来回答“哪个班最差”
"""

from pathlib import Path

from openpyxl import Workbook

from aggregate import avg, full_room_beds, room_score, fmt_num
from normalize import room_key
from writer import write_table, COLOR_WARN
from config import EMPTY_BED_TEXT


def _bed_cells(beds):
    """把 4 个床位渲染成 4 段文字（整间视角，空床也写出来）。"""
    out = []
    for b in beds:
        if b is None:
            out.append(EMPTY_BED_TEXT)
        elif not b["姓名"]:
            out.append(f"未署名 {fmt_num(b['得分'])}" if b["得分"] is not None else "未署名")
        elif b["得分"] is None:
            out.append(f"{b['姓名']} 未查到")
        else:
            out.append(f"{b['姓名']} {fmt_num(b['得分'])}")
    return out


def _sort_key_building(bld):
    return (int("".join(filter(str.isdigit, bld)) or 9999), bld)


def _sort_key_room(rno):
    return (int("".join(filter(str.isdigit, rno)) or 9999), rno)


# ---------------------------------------------------------------- 全表
def save_full_table(path, week, students, week_data):
    """一周一张全表：她名下所有寝室，按楼栋号 → 门牌号排。

    与“按楼栋表”的区别：这里不分楼栋，全部串成一张长表，
    适合打印出来整册翻，或者贴到总结材料里。
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    rooms = {}
    for s in students:
        rooms.setdefault(room_key(s["楼栋"], s["寝室号"]), []).append(s)

    keys = sorted(rooms, key=lambda k: (_sort_key_building(k.split("#")[0]),
                                        _sort_key_room(k.split("#")[1])))

    wb = Workbook()
    ws = wb.active
    ws.title = "查寝全表"

    headers = ["序号", "楼栋", "寝室号", "专业", "班级",
               "床位1", "床位2", "床位3", "床位4", "个人均分", "寝室得分"]
    body = []
    total_beds = 0

    for i, key in enumerate(keys, start=1):
        rno = key.split("#")[1]
        members = rooms[key]
        # 楼栋取名单里的原始写法（C6），不用 room_key 里的归一化值（6）：
        # 表里给人看的应该是「C6」，归一化后的「6」只用于内部匹配。
        bld = members[0]["楼栋"]
        checks = week_data.get(key, [])
        beds = full_room_beds(checks)
        total_beds += sum(1 for b in beds if b and b["姓名"])

        body.append([
            i,
            bld,
            rno,
            "+".join(sorted({m["专业"] for m in members})),
            "+".join(sorted({m["班级"] for m in members})),
            *_bed_cells(beds),
            avg([b["得分"] for b in beds if b]) if any(b for b in beds) else "—",
            room_score(checks) if checks else "未查到",
        ])

    subtitle = (f"{week}　共 {len(keys)} 间寝室 / {total_beds} 人"
                f"　按楼栋号、寝室门牌号排序　寝室均分 "
                f"{avg([room_score(week_data.get(k, [])) for k in keys])}")

    write_table(ws, f"查寝全表（{week}）", subtitle, headers, body,
                widths=[6, 7, 9, 9, 26, 17, 17, 17, 17, 11, 11],
                landscape=True)

    wb.save(str(path))
    return path


# ---------------------------------------------------------------- 总表
def save_master(path, weeks, students, week_results):
    """跨周总表：班级排名 / 楼栋对比 / 寝室明细。

    参数
    ----
    weeks        : 参与汇总的周次列表，如 ['第7周', '第8周']
    week_results : {周次: {'class': {班级: rows}, 'building': {楼栋: rows}}}
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    wb = Workbook()

    # ---------- 1. 班级汇总 ----------
    ws = wb.active
    ws.title = "班级汇总"

    classes = sorted({s["班级"] for s in students},
                     key=lambda c: (0 if c.startswith("计科") else 1,
                                    int("".join(filter(str.isdigit,
                                                         c.split("级")[1].split("班")[0])) or 0)))

    rows = []
    for cls in classes:
        people = sum(1 for s in students if s["班级"] == cls)
        per_week = {}
        room_count = 0
        for w in weeks:
            table = week_results.get(w, {}).get("class", {}).get(cls, [])
            room_count = max(room_count, len(table))
            per_week[w] = avg([r["寝室得分"] for r in table])
        week_avgs = [v for v in per_week.values() if v is not None]
        overall = avg(week_avgs) if week_avgs else None
        major = "计科" if cls.startswith("计科") else "信安"
        rows.append([cls, major, people, room_count, overall, per_week])

    # 按两周平均排名（None 排最后）
    rows.sort(key=lambda r: (r[4] is None, -(r[4] or 0)))

    headers = ["名次", "班级", "专业", "人数", "寝室"] + \
              [f"{w}寝室均分" for w in weeks] + ["两周平均"]
    body = []
    for i, (cls, major, people, room_count, overall, per_week) in enumerate(rows, start=1):
        body.append([i, cls, major, people, room_count] +
                    [(per_week[w] if per_week[w] is not None else "—") for w in weeks] +
                    [overall if overall is not None else "—"])

    subtitle = (f"{'、'.join(weeks)}　{len(classes)} 个班　"
                f"学生 {len(students)} 人　按两周平均分排序")
    write_table(ws, "查寝得分　班级汇总", subtitle, headers, body,
                widths=[7, 18, 8, 8, 8] + [15] * len(weeks) + [12],
                landscape=False)

    # 前三名换个底色，方便一眼看到
    from openpyxl.styles import PatternFill
    for r in range(4, min(7, 4 + len(body))):
        for c in range(1, len(headers) + 1):
            ws.cell(row=r, column=c).fill = PatternFill(fill_type="solid",
                                                        fgColor="FFFFF3E0")

    # ---------- 2. 楼栋汇总 ----------
    ws2 = wb.create_sheet("楼栋汇总")
    buildings = sorted({s["楼栋"] for s in students}, key=_sort_key_building)

    body2 = []
    for bld in buildings:
        people = sum(1 for s in students if s["楼栋"] == bld)
        rooms = len({s["寝室号"] for s in students if s["楼栋"] == bld})
        vals = []
        for w in weeks:
            table = week_results.get(w, {}).get("building", {}).get(bld, [])
            vals.append(avg([r["寝室得分"] for r in table]))
        body2.append([bld, rooms, people] +
                     [(v if v is not None else "—") for v in vals])

    write_table(ws2, "查寝得分　楼栋汇总",
                f"{'、'.join(weeks)}　{len(buildings)} 栋楼",
                ["楼栋", "寝室", "在册人数"] + [f"{w}" for w in weeks],
                body2, widths=[10, 9, 11] + [13] * len(weeks), landscape=False)

    # ---------- 3. 寝室明细 ----------
    ws3 = wb.create_sheet("寝室明细")
    room_classes = {}
    for s in students:
        room_classes.setdefault((s["楼栋"], s["寝室号"]), set()).add(s["班级"])

    body3 = []
    for (bld, rno) in sorted(room_classes, key=lambda x: (_sort_key_building(x[0]),
                                                         _sort_key_room(x[1]))):
        vals = []
        for w in weeks:
            checks = week_results.get(w, {}).get("_raw", {}).get(room_key(bld, rno), [])
            vals.append(room_score(checks) if checks else None)
        change = None
        if len(vals) >= 2 and vals[0] is not None and vals[-1] is not None:
            change = round(vals[-1] - vals[0], 2)
        body3.append([bld, rno, "+".join(sorted(room_classes[(bld, rno)]))] +
                     [(v if v is not None else "—") for v in vals] +
                     [f"{change:+.2f}" if change is not None else "—"])

    write_table(ws3, "查寝得分　寝室明细",
                f"{'、'.join(weeks)}　共 {len(body3)} 间　变化 = 最后一周 − 第一周",
                ["楼栋", "寝室号", "班级"] + [f"{w}" for w in weeks] + ["变化"],
                body3, widths=[9, 10, 30] + [11] * len(weeks) + [10], landscape=True)

    wb.save(str(path))
    return path
