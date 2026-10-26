"""公开前检查：阻止常见密钥、本机路径、私有文件和真实名单进入仓库。"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {".py", ".js", ".html", ".md", ".json", ".txt", ".gitignore", ".gitattributes"}
SKIP_PARTS = {".git", "node_modules", "out", "dist", "__pycache__"}
VENDORED = {"vendor.bundle.js", "xlsx.full.min.js"}
PATTERNS = {
    "GitHub 令牌": re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    "本机私有路径": re.compile(r"[A-Za-z]:[\\/](?:Users|学生宿舍管理得分|编写宿舍得分统计程序)"),
    "真实名单文件名": re.compile(r"26计科信安学生信息表"),
}


def public_files():
    try:
        result = subprocess.run(["git", "ls-files"], cwd=ROOT, check=True,
                                capture_output=True, text=True, encoding="utf-8")
        names = [line for line in result.stdout.splitlines() if line]
        if names:
            return [ROOT / name for name in names]
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass
    return [p for p in ROOT.rglob("*") if p.is_file() and not SKIP_PARTS.intersection(p.parts)]


def main():
    errors = []
    files = public_files()
    for path in files:
        # 本脚本包含用于拦截敏感词的规则本身，不扫描自身，避免误报。
        if path.resolve() == Path(__file__).resolve():
            continue
        if path.name in VENDORED or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8")
        for label, pattern in PATTERNS.items():
            if pattern.search(text):
                errors.append(f"{path.relative_to(ROOT)}：疑似{label}")

    roster_path = ROOT / "web" / "roster.js"
    match = re.search(r"window\.ROSTER\s*=\s*(\[.*\]);\s*$",
                      roster_path.read_text(encoding="utf-8"), re.S)
    if not match:
        errors.append("web/roster.js：无法识别名单格式")
    else:
        roster = json.loads(match.group(1))
        bad_names = [s.get("n", "") for s in roster if not s.get("n", "").startswith("示例学生")]
        if bad_names:
            errors.append("web/roster.js：发现非演示姓名，公开版只允许“示例学生”前缀")
        if any(set(s) != {"n", "b", "r", "d", "c"} for s in roster):
            errors.append("web/roster.js：名单字段异常，不应包含学号等额外信息")

    for path in files:
        if path.suffix.lower() in {".xls", ".xlsx", ".zip"}:
            relative = path.relative_to(ROOT)
            if relative.parts[0] not in {"data", "web"}:
                errors.append(f"{relative}：二进制数据文件不在脱敏数据目录")

    if errors:
        print("公开前检查失败：")
        for error in errors:
            print(" -", error)
        return 1
    print(f"公开前检查通过：{len(files)} 个文件，未发现常见密钥、本机路径或非演示网页名单。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
