"""
normalize.py —— 归一化层：把“人写的各种写法”变成“程序能比的统一形式”。

学习要点（这是整个项目最关键的一层）
------------------------------------
数据对不上，99% 不是算法错，而是写法不一致：
    C6-104 / C6-104室 / ６-１０４ / c6_104 / C6 104
这五种写法指的是同一个床位。如果不先统一，后面怎么算都是错的。

原则：
  * 归一化函数必须是“纯函数”——同样的输入永远同样的输出，不依赖外部状态。
  * 只做“形式”统一，不做“语义”猜测。猜不准的宁可对不上（会被异常清单抓出来），
    也不要自作聪明地硬配——那是上报事故的源头。
"""

import re

# 全角字符所在的 Unicode 区间与半角相差 0xFEE0
_FULLWIDTH_OFFSET = 0xFEE0
_FULLWIDTH_RE = re.compile(r"[\uFF01-\uFF5E]")

# 中文数字（够用到 99）
_CN_DIGITS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
              "六": 6, "七": 7, "八": 8, "九": 9}
_CN_RE = re.compile(r"[一二三四五六七八九十]+(?=[号栋楼座#\-])")


def to_text(value) -> str:
    """把任意单元格值变成干净的字符串：全角转半角、去首尾空白。

    为什么先做这一步：Excel 里看不见的空格、全角数字，
    会让 '301' != '３０１'，肉眼完全看不出来。

    特别注意：xlrd 读 .xls 时，数字会被读成浮点数（104 -> 104.0）。
    如果不处理，寝室号会变成 '104.0'，和名单里的 '104' 永远对不上。
    """
    if value is None:
        return ""

    # 浮点整数还原成整数，避免 104.0 这种尾巴
    if isinstance(value, float) and value.is_integer():
        s = str(int(value))
    else:
        s = str(value)

    s = _FULLWIDTH_RE.sub(
        lambda m: chr(ord(m.group()) - _FULLWIDTH_OFFSET), s
    )
    # 全角空格 U+3000 也当普通空格处理
    s = s.replace("\u3000", " ")
    return s.strip()


def cn_to_int(text: str):
    """中文数字转整数，支持 1~99：'三'->3, '十二'->12, '二十'->20, '二十一'->21。

    为什么需要：学校文件里 '3号楼' 和 '三号楼' 会混着出现。
    """
    if not text:
        return None
    if text == "十":
        return 10
    if len(text) == 1:
        return _CN_DIGITS.get(text)
    if len(text) == 2:
        if text[0] == "十":                      # 十二
            return 10 + _CN_DIGITS.get(text[1], 0)
        if text[1] == "十":                      # 二十
            return _CN_DIGITS.get(text[0], 0) * 10
    if len(text) == 3 and text[1] == "十":       # 二十一
        return _CN_DIGITS.get(text[0], 0) * 10 + _CN_DIGITS.get(text[2], 0)
    return None


def norm_building(value) -> str:
    """楼栋归一：'3号楼' '三号楼' '3栋' '12号楼' '３号楼' -> '3' / '12'

    规则：
      1. 全角转半角、去空白
      2. 中文数字转阿拉伯数字
      3. 取第一段连续数字；没有数字就退回去掉“号楼栋座#”
    """
    s = to_text(value).replace(" ", "")

    def _cn_repl(m):
        n = cn_to_int(m.group())
        return str(n) if n is not None else m.group()

    s = _CN_RE.sub(_cn_repl, s)

    m = re.search(r"\d+", s)
    if m:
        return str(int(m.group()))
    # 'B栋' 这种没有数字的，去掉后缀保留字母
    return re.sub(r"[号楼栋座#]", "", s)


def norm_room(value) -> str:
    """寝室号归一：'301' '3-301' '301室' 'Ａ－２０１' ' 301 ' -> '301' / 'A201'

    规则：
      1. 全角转半角、去空白、字母转大写（a201 和 A201 是同一间）
      2. 破折号统一成 '-'
      3. 去掉结尾的“寝室/房间/室”
      4. 去掉开头的楼栋前缀（'3-301' 里的 '3-'）
    """
    s = to_text(value).replace(" ", "").upper()
    s = re.sub(r"[－—–_]", "-", s)
    s = re.sub(r"(寝室|房间|室)$", "", s)
    s = re.sub(r"^\d+-", "", s)      # 3-301 -> 301（数字楼栋前缀整个删掉）
    s = s.replace("-", "")           # A-201 -> A201（字母前缀只去连字符）
    return s


def norm_name(value) -> str:
    """姓名归一：去掉所有空格（含全角空格）。

    '张 明' 与 '张明' 是同一个人；少数民族名里的 '·' 要保留。
    """
    return to_text(value).replace(" ", "")


def room_key(building, room) -> str:
    """寝室的唯一键：楼栋 + '#' + 寝室号。

    为什么要带楼栋：C6-104 和 C8-104 是两个完全不同的寝室。
    （这个坑我真踩过：只按寝室号判重，会误报几十处重复。）
    """
    return f"{norm_building(building)}#{norm_room(room)}"


# ---------------------------------------------------------------- 学号
def parse_sid(sid) -> dict:
    """解析学号，返回 年级 / 专业 / 班号 / 班内序号。

    262210701131 -> 年级 26，专业 计科，班号 11->1，序号 31
    返回班号时已经按专业换算成“显示班号”（计科 11~16 => 1~6）。
    """
    from config import SID_MAJOR_DIGIT, SID_CLASS_RANGE, MAJOR_NAMES, CLASS_OFFSET

    s = to_text(sid).replace(" ", "")
    if len(s) < 12 or not s.isdigit():
        return {"grade": "", "major": "", "class_no": None, "seq": "", "raw": s}

    grade = s[:2]
    major_digit = s[SID_MAJOR_DIGIT]
    major = MAJOR_NAMES.get(major_digit, "未知")

    # 学号里的“学号班号”，例如 11、16、01
    sid_class = int(s[SID_CLASS_RANGE]) if s[SID_CLASS_RANGE].isdigit() else None
    class_no = None if sid_class is None else sid_class - CLASS_OFFSET.get(major, 0)

    return {
        "grade": grade,
        "major": major,
        "class_no": class_no,        # 显示班号：计科 1~6，信安 1~4
        "sid_class": sid_class,      # 学号里的原始班号：计科 11~16，信安 01~04
        "seq": s[-2:],
        "raw": s,
    }


def class_name(sid) -> str:
    """学号 -> 班级全名，例如 '计科26级1班'。"""
    p = parse_sid(sid)
    if not p["major"] or p["class_no"] is None:
        return "未知班级"
    return f"{p['major']}{p['grade']}级{p['class_no']}班"
