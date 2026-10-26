"""
audit.py —— 自检层：交付前必须全部通过。

为什么单独一层
--------------
“数据看起来对”是最危险的状态。所以要有一套不依赖生成逻辑的检查：

  * 守恒：人数、寝室数必须和名单对得上，多一个少一个都算失败
  * 自洽：每行“个人均分”必须真的等于该行 4 个分数的平均
  * 追溯：每个分数必须能在原始评分表里找到出处
  * 唯一：同一个人不能在两处被算两次

检查结果分两级：
  [严重] 必须修，修不好不许交付
  [提示] 需要人看一眼（比如重名），不一定是错
"""

from aggregate import avg, student_score, room_score
from normalize import room_key

SEVERE = "严重"
INFO = "提示"


def _room_weeks(data):
    """把 {key: [检查记录]} 展开成 {'key|日期': 记录}，便于追溯。"""
    out = {}
    for key, checks in data.items():
        for chk in checks:
            out[f"{key}|{chk['日期']}"] = chk
    return out


def audit(students, week_data, class_tables, building_tables):
    """执行全部检查，返回 [(级别, 说明), ...]。

    class_tables    : {班级: rows}
    building_tables : {楼栋: rows}
    """
    issues = []
    add = lambda lv, msg: issues.append((lv, msg))

    # ---------------------------------------------------------- 1. 人数守恒
    total_people = 0
    seen = {}
    for cls, rows in class_tables.items():
        people = 0
        for r in rows:
            for b in r["床位"]:
                if b and b.get("姓名"):
                    people += 1
                    seen.setdefault(b["姓名"], []).append(f"{r['楼栋']}-{r['寝室号']}")
        total_people += people
        expect = sum(1 for s in students if s["班级"] == cls)
        if people != expect:
            add(SEVERE, f"{cls}：表内 {people} 人，名单 {expect} 人")

    if total_people != len(students):
        add(SEVERE, f"全部班级表人数合计 {total_people}，名单 {len(students)} 人")

    # 同一个人出现在两张不同的班级表 -> 重复计人
    # 但“同名”有两种完全不同的情况，混在一起报会让人麻木：
    #   A. 两个不同学号的学生恰好同名（合法，如两个「黄依依」）
    #   B. 同一个学生被算进两间寝室（真错，会重复计人）
    name_to_sids = {}
    name_to_rooms = {}
    for s in students:
        name_to_sids.setdefault(s["姓名"], set()).add(s["学号"])
        name_to_rooms.setdefault(s["姓名"], set()).add(room_key(s["楼栋"], s["寝室号"]))

    for name, places in seen.items():
        rooms = sorted(set(places))
        sids = name_to_sids.get(name, set())

        if len(sids) > 1:
            # 同名不同人。真正危险的是“同名且同住”——按姓名匹配必然串分数
            if len(name_to_rooms.get(name, set())) < len(sids):
                add(SEVERE, f"「{name}」有 {len(sids)} 名学生同名且同住一室，"
                            f"按姓名匹配会串分数，必须改用学号区分")
            else:
                add(INFO, f"「{name}」有 {len(sids)} 名学生同名（不同学号），"
                          f"分住 {'、'.join(rooms)}，已按不同人处理，仅备查")
        elif len(rooms) > 1:
            add(SEVERE, f"「{name}」出现在 {len(rooms)} 间寝室："
                        f"{'、'.join(rooms)}，疑似重复计人")

    # ---------------------------------------------------------- 2. 寝室守恒
    roster_rooms = {room_key(s["楼栋"], s["寝室号"]) for s in students}
    table_rooms = set()
    for rows in building_tables.values():
        for r in rows:
            table_rooms.add(room_key(r["楼栋"], r["寝室号"]))
    if len(table_rooms) != len(roster_rooms):
        add(SEVERE, f"楼栋表覆盖 {len(table_rooms)} 间，名单中 {len(roster_rooms)} 间")
    miss = roster_rooms - table_rooms
    for key in sorted(miss):
        add(SEVERE, f"名单有、楼栋表没有：{key}")

    # ---------------------------------------------------------- 3. 算术自洽
    for cls, rows in class_tables.items():
        for r in rows:
            got = [b["得分"] for b in r["床位"] if b and b["得分"] is not None]
            expect = avg(got)
            if expect is not None and (r["个人均分"] is None or abs(r["个人均分"] - expect) > 0.011):
                add(SEVERE, f"{cls} {r['楼栋']}-{r['寝室号']}：个人均分 {r['个人均分']} ≠ {expect}")

    for bld, rows in building_tables.items():
        for r in rows:
            got = [b["得分"] for b in r["床位"] if b and b["得分"] is not None]
            expect = avg(got)
            if expect is not None and (r["个人均分"] is None or abs(r["个人均分"] - expect) > 0.011):
                add(SEVERE, f"{bld} {r['寝室号']}：个人均分 {r['个人均分']} ≠ {expect}")

    # ---------------------------------------------------------- 4. 可追溯
    untraced = 0
    for rows in building_tables.values():
        for r in rows:
            key = room_key(r["楼栋"], r["寝室号"])
            checks = week_data.get(key, [])
            if not checks:
                add(SEVERE, f"{key} 原始表无记录")
                continue
            expect = room_score(checks)
            if r["寝室得分"] is None or abs(r["寝室得分"] - (expect or 0)) > 0.011:
                add(SEVERE, f"{key} 寝室得分 {r['寝室得分']} ≠ 原始重算 {expect}")

            for b in r["床位"]:
                if not b or not b["姓名"] or b["得分"] is None:
                    continue
                pool = []
                for chk in checks:
                    for bed in chk["床位"]:
                        if bed and bed["姓名"] == b["姓名"] and bed["得分"] is not None:
                            pool.append(bed["得分"])
                if not pool:
                    add(SEVERE, f"{key}「{b['姓名']}」原始表查无此人")
                    untraced += 1
                elif b["得分"] not in pool and abs(b["得分"] - avg(pool)) > 0.011:
                    add(SEVERE, f"{key}「{b['姓名']}」{b['得分']} 既不是原值也不是平均 {avg(pool)}")
                    untraced += 1

    # ---------------------------------------------------------- 5. 空床核对
    for rows in building_tables.values():
        for r in rows:
            key = room_key(r["楼栋"], r["寝室号"])
            checks = week_data.get(key, [])
            if not checks:
                continue
            last = checks[-1]["床位"]
            filled = len([b for b in last if b])
            table_filled = len([b for b in r["床位"] if b])
            if filled != table_filled:
                add(SEVERE, f"{key}：原始 {filled} 个床位有数据，表内 {table_filled} 个")

    return issues


def print_report(issues):
    """把检查结果打印成可读的报告。"""
    severe = [i for i in issues if i[0] == SEVERE]
    info = [i for i in issues if i[0] == INFO]

    print("=" * 60)
    print(f"自检结果：严重 {len(severe)} 处　提示 {len(info)} 处")
    print("=" * 60)

    if severe:
        print("\n[严重] 必须处理：")
        for _, msg in severe[:30]:
            print("  ✗", msg)
        if len(severe) > 30:
            print(f"  … 另有 {len(severe) - 30} 处")

    if info:
        print("\n[提示] 请人工看一眼：")
        for _, msg in info[:15]:
            print("  ·", msg)

    if not issues:
        print("\n✓ 全部通过")

    return len(severe) == 0
