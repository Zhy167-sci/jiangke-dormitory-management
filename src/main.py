"""
main.py —— 主流程：一次跑完，从原始文件到成品表。

流程（也是本项目的六层结构）
--------------------------
    reader      读文件         -> 二维行
    normalize   归一化         -> 统一写法
    aggregate   匹配 + 聚合    -> 班级表 / 楼栋表
    writer      出 Excel       -> 带格式的文件
    audit       自检           -> 问题清单

运行：
    python main.py            # 跑第 7、8 两周
    python main.py 第7周       # 只跑一周
"""

import sys
import time
from pathlib import Path

from config import WEEKS, OUT_DIR, BUILDING_PAD
from reader import read_roster, load_week
from aggregate import build_class_rows, build_building_rows
from writer import save_class_sheet, save_building_sheet
from report import save_full_table, save_master
from audit import audit, print_report

# 周次 -> 顶层文件夹名（目录用中文数字，文件名用阿拉伯数字）
WEEK_DIR = {"第7周": "第七周", "第8周": "第八周"}


def building_dir_name(bld: str) -> str:
    """C6 -> C06楼。补零只为排序，表内标题仍用真实楼号。"""
    head, num = bld[0], bld[1:]
    return f"{head}{num.zfill(BUILDING_PAD)}楼"


def run(weeks):
    t0 = time.time()

    print("① 读取学生名单 …")
    students = read_roster()
    classes = sorted(
        {s["班级"] for s in students},
        key=lambda c: (0 if c.startswith("计科") else 1,
                       int("".join(filter(str.isdigit, c.split("级")[1].split("班")[0])) or 0)),
    )
    buildings = sorted({s["楼栋"] for s in students},
                       key=lambda b: int("".join(filter(str.isdigit, b)) or 9999))
    print(f"   {len(students)} 人 / {len({(s['楼栋'], s['寝室号']) for s in students})} 间寝室"
          f" / {len(classes)} 个班 / {len(buildings)} 栋楼")

    all_issues = []
    week_results = {}          # {周次: {'class':…, 'building':…, '_raw': week_data}}

    for week in weeks:
        print(f"\n② 读取 {week} 的楼栋评分表 …")
        week_data = load_week(week)
        print(f"   解析到 {len(week_data)} 间寝室有检查记录")

        print("③ 聚合 …")
        class_tables = {}
        for cls in classes:
            class_tables[cls] = build_class_rows(students, cls, week_data)

        building_tables = {}
        for bld in buildings:
            building_tables[bld] = build_building_rows(students, bld, week_data)

        week_results[week] = {
            "class": class_tables,
            "building": building_tables,
            "_raw": week_data,
        }

        print("④ 自检 …")
        issues = audit(students, week_data, class_tables, building_tables)
        ok = print_report(issues)
        all_issues.extend([(week,) + i for i in issues])

        print("\n⑤ 写出文件 …")
        week_dir = Path(OUT_DIR) / WEEK_DIR.get(week, week)

        for cls, rows in class_tables.items():
            no = "".join(filter(str.isdigit, cls.split("级")[1].split("班")[0]))
            major = "计科" if cls.startswith("计科") else "信安"
            path = week_dir / "按班级分类" / cls / f"{major}{no}班_{week}.xlsx"
            save_class_sheet(path, cls, week, rows)

        for bld, rows in building_tables.items():
            dir_name = building_dir_name(bld)
            path = week_dir / "按寝室楼分类" / dir_name / f"{dir_name}_{week}.xlsx"
            save_building_sheet(path, bld, week, rows)

        # 全表：本周所有寝室串成一张长表（放在周目录根部）
        save_full_table(week_dir / f"查寝全表_{week}.xlsx", week, students, week_data)

        print(f"   已输出到 {week_dir}")

        if not ok:
            print(f"\n⚠ {week} 存在严重问题，请先处理再交付")

    # 总表：跨周对比，放输出根目录（不属于任何单一周）
    if len(week_results) >= 1:
        print("\n⑥ 生成总表 …")
        master = save_master(Path(OUT_DIR) / "查寝得分总表.xlsx",
                             [w for w in weeks if w in week_results],
                             students, week_results)
        print(f"   已输出到 {master}")

    print(f"\n完成，用时 {time.time() - t0:.1f} 秒")
    return all_issues


if __name__ == "__main__":
    target = sys.argv[1:] or list(WEEKS.keys())
    bad = run(target)
    sys.exit(1 if any(i[1] == "严重" for i in bad) else 0)
