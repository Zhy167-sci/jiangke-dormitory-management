"""生成完全虚构的名单和评分表，供开发、测试与公开演示使用。"""

import json
import shutil
import zipfile
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
WEB_DATA = ROOT / "web" / "testdata"

STUDENTS = [
    {"sid": "269990701101", "name": "示例学生01", "building": "C1", "room": "101", "bed": 1, "cls": "计科26级1班"},
    {"sid": "269990701102", "name": "示例学生02", "building": "C1", "room": "101", "bed": 2, "cls": "计科26级1班"},
    {"sid": "269990701103", "name": "示例学生03", "building": "C1", "room": "101", "bed": 3, "cls": "计科26级1班"},
    {"sid": "269990701104", "name": "示例学生04", "building": "C1", "room": "101", "bed": 4, "cls": "计科26级1班"},
    {"sid": "269990710101", "name": "示例学生05", "building": "C2", "room": "201", "bed": 1, "cls": "信安26级1班"},
    {"sid": "269990710102", "name": "示例学生06", "building": "C2", "room": "201", "bed": 2, "cls": "信安26级1班"},
    {"sid": "269990710103", "name": "示例学生07", "building": "C2", "room": "201", "bed": 3, "cls": "信安26级1班"},
    {"sid": "269990710104", "name": "示例学生08", "building": "C2", "room": "201", "bed": 4, "cls": "信安26级1班"},
]


def save_roster(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "脱敏名单"
    ws.append(["姓名", "学号", "寝室号", "床号"])
    for s in STUDENTS:
        ws.append([s["name"], s["sid"], f"{s['building']}-{s['room']}", s["bed"]])
    wb.save(path)


def save_scores(path, building, room, date, room_scores, person_scores):
    wb = Workbook()
    ws = wb.active
    ws.title = "脱敏评分表"
    ws.append(["宿舍卫生检查评分表（虚构演示数据）"])
    ws.append([f"检查日期：{date}"])
    ws.append(["寝室号", "寝室得分", "床位1", "床位2", "床位3", "床位4"])
    members = [s for s in STUDENTS if s["building"] == building]
    beds = [f"{s['name']} {person_scores[s['bed'] - 1]}" for s in members]
    for index, room_score in enumerate(room_scores):
        ws.append([room if index == 0 else f"{room}室", room_score, *beds])
        break
    wb.save(path)


def main():
    if DATA.exists():
        shutil.rmtree(DATA)
    if WEB_DATA.exists():
        shutil.rmtree(WEB_DATA)
    DATA.mkdir()
    WEB_DATA.mkdir(parents=True)
    save_roster(DATA / "roster.example.xlsx")

    fixtures = {
        "第7周": [("C1", "101", "2026年10月12日", [83.13], [80, 81, 82, 83]),
                  ("C2", "201", "2026年10月12日", [88], [85, 86, 87, 88])],
        "第8周": [("C1", "101", "2026年10月19日", [77.5], [78, 79, 80, 81]),
                  ("C2", "201", "2026年10月19日", [90], [89, 90, 91, 92])],
    }
    for week, sheets in fixtures.items():
        folder_name = f"{week}宿舍卫生得分"
        data_folder = DATA / folder_name
        test_folder = WEB_DATA / ("w7" if week == "第7周" else "w8")
        data_folder.mkdir()
        test_folder.mkdir()
        for building, room, date, room_scores, person_scores in sheets:
            name = f"{building}_202610{'12' if week == '第7周' else '19'}.xlsx"
            save_scores(data_folder / name, building, room, date, room_scores, person_scores)
            shutil.copy2(data_folder / name, test_folder / name)
        with zipfile.ZipFile(WEB_DATA / f"{folder_name}.zip", "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(test_folder.glob("*.xlsx")):
                zf.write(path, path.name)

    # 复制一份内容完全相同的表，验证网页会识别并跳过重复数据。
    duplicate = WEB_DATA / "w7" / "C1_20261012 (1).xlsx"
    shutil.copy2(WEB_DATA / "w7" / "C1_20261012.xlsx", duplicate)
    with zipfile.ZipFile(WEB_DATA / "第7周宿舍卫生得分.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted((WEB_DATA / "w7").glob("*.xlsx")):
            zf.write(path, path.name)

    roster = [{"n": s["name"], "b": s["building"], "r": s["room"], "d": s["bed"], "c": s["cls"]} for s in STUDENTS]
    payload = json.dumps(roster, ensure_ascii=False, separators=(",", ":"))
    (ROOT / "web" / "roster.js").write_text(
        "// 本文件由 scripts/generate_demo_data.py 生成；全部是虚构演示数据。\n"
        f"window.ROSTER = {payload};\n", encoding="utf-8")
    print("已生成：8 名虚构学生、2 间寝室、2 周评分表和网页测试 ZIP。")


if __name__ == "__main__":
    main()
