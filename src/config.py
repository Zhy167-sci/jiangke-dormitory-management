"""项目配置：路径、表头别名、学号规则与显示文字。

默认只读取仓库内的脱敏演示数据。真实数据请放在本机，并用环境变量
DORM_DATA_ROOT 指定目录；不要修改本文件后把真实路径提交到 Git。
"""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("DORM_DATA_ROOT", str(PROJECT_ROOT / "data")))
OUT_DIR = Path(os.environ.get("DORM_OUT_DIR", str(PROJECT_ROOT / "out")))
DELIVER_DIR = Path(os.environ.get("DORM_DELIVER_DIR", str(PROJECT_ROOT / "delivered")))
ROSTER_FILE = os.environ.get("DORM_ROSTER_FILE", "roster.example.xlsx")

WEEKS = {
    "第7周": "第7周宿舍卫生得分",
    "第8周": "第8周宿舍卫生得分",
}
BUILDING_PAD = 2

FIELD_ALIASES = {
    "姓名": ["姓名", "学生姓名", "学生"],
    "楼栋": ["楼栋", "楼号", "宿舍楼", "楼"],
    "寝室号": ["寝室号", "宿舍号", "房间号", "寝室", "宿舍"],
    "床号": ["床位", "床号", "床位号"],
    "寝室得分": ["寝室得分", "宿舍得分", "寝室分数"],
    "床位得分": ["床位得分", "个人得分", "床位分数"],
}
HEADER_KEYWORDS = ("寝室号", "床位")

# 示例学号仅用于说明切片位置，不对应真实学生。
SID_MAJOR_DIGIT = 7
SID_CLASS_RANGE = slice(8, 10)
MAJOR_NAMES = {"0": "计科", "1": "信安"}
CLASS_OFFSET = {"计科": 10, "信安": 0}

# 真实并班规则属于本校业务数据，请通过本地私有配置维护。
MERGE_RULES = {}

EMPTY_BED_TEXT = "空床"
OTHER_BED_TEXT = "—"
UNNAMED_TEXT = "未署名"
NOT_FOUND_TEXT = "未查到"
