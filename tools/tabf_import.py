"""Convert TABF (台灣金融研訓院) past-exam PDFs into a catfight question bank JSON.

Each exam id has three files: <id>-1.pdf (session 1 questions), <id>-2.pdf (session 2 questions),
<id>-3.pdf (answer key with two columns: 第一節 / 第二節).

usage:
  python tools/tabf_import.py --dir <pdf dir> --ids 663415,644264,617843 \
      --category family_trust --name 家族信託規劃顧問 --sort 1 --out data/questions/family_trust.json

Multiple-answer items (e.g. "2、3、4") and items whose text could not be parsed into exactly
four options are skipped and reported, so nothing malformed reaches the game.
"""
import argparse
import json
import os
import re
import sys

import pdfplumber

sys.stdout.reconfigure(encoding="utf-8")

Q_RE = re.compile(r"^(\d{1,2})\.\s*(.*)$")
OPT_RE = re.compile(r"^\((\d)\)\s*(.*)$")
NOISE_RE = re.compile(
    r"^(第\s*\d+\s*部分|注意：|本試卷|鉛筆在|答案卡|選作答|\d+\s*$|台灣金融研訓院|節次：|第\s*\d+\s*期.*測驗試題$)"
)


def page_lines(pdf_path):
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for ln in text.splitlines():
                ln = ln.strip()
                if not ln or NOISE_RE.match(ln):
                    continue
                lines.append(ln)
    return lines


def parse_questions(pdf_path):
    """Return {num: {"text": str, "options": {1..4: str}}}."""
    qs = {}
    cur = None
    cur_opt = None
    for ln in page_lines(pdf_path):
        m = Q_RE.match(ln)
        # a new question starts with "N." where N is the expected next number (guards against "1.5 分" etc.)
        if m and (cur is None and int(m.group(1)) == 1 or cur is not None and int(m.group(1)) == cur + 1):
            cur = int(m.group(1))
            cur_opt = None
            qs[cur] = {"text": m.group(2).strip(), "options": {}}
            continue
        if cur is None:
            continue
        # several options may share one line: "(1)一人 (2)二人 (3)三人 (4)四人"
        parts = re.split(r"(?=\(\d\))", ln)
        parts = [p for p in parts if p.strip()]
        if len(parts) > 1 and all(OPT_RE.match(p.strip()) for p in parts):
            for p in parts:
                mo = OPT_RE.match(p.strip())
                cur_opt = int(mo.group(1))
                qs[cur]["options"][cur_opt] = mo.group(2).strip()
            continue
        mo = OPT_RE.match(ln)
        if mo and 1 <= int(mo.group(1)) <= 4:
            cur_opt = int(mo.group(1))
            qs[cur]["options"][cur_opt] = mo.group(2).strip()
            continue
        # continuation line
        if cur_opt is None:
            qs[cur]["text"] += ln
        else:
            qs[cur]["options"][cur_opt] += ln
    return qs


def parse_answers(pdf_path):
    """Return {session(1|2): {num: answer_or_None}}; None for multi-answer / 送分 items."""
    out = {1: {}, 2: {}}
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join((p.extract_text() or "") for p in pdf.pages)
    for ln in text.splitlines():
        m = re.match(r"^(\d{1,2})\s+(\S+)\s+(\S+)\s*$", ln.strip())
        if not m:
            continue
        n = int(m.group(1))
        if not 1 <= n <= 60:
            continue
        for s, tok in ((1, m.group(2)), (2, m.group(3))):
            out[s][n] = int(tok) if re.fullmatch(r"[1-4]", tok) else None
    return out


def clean(s):
    s = re.sub(r"\s+", " ", s).strip()
    # a page-break header such as "第二部分" occasionally leaks a lone trailing "第"
    s = re.sub(r"第$", "", s).strip()
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--ids", required=True)
    ap.add_argument("--category", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--sort", type=int, default=0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    questions = []
    skipped = []
    for exam in a.ids.split(","):
        answers = parse_answers(os.path.join(a.dir, f"{exam}-3.pdf"))
        for session in (1, 2):
            qs = parse_questions(os.path.join(a.dir, f"{exam}-{session}.pdf"))
            for n in range(1, 61):
                q = qs.get(n)
                ans = answers[session].get(n)
                tag = f"{exam}-{session}#{n}"
                if q is None:
                    skipped.append((tag, "題目未解析到"))
                    continue
                if len(q["options"]) != 4 or any(not q["options"].get(i) for i in range(1, 5)):
                    skipped.append((tag, f"選項數 {len(q['options'])}"))
                    continue
                if ans is None:
                    skipped.append((tag, "答案為複選或無答案"))
                    continue
                text = clean(q["text"])
                if len(text) < 4:
                    skipped.append((tag, "題目太短"))
                    continue
                questions.append(
                    {
                        "text": text,
                        "options": [clean(q["options"][i]) for i in range(1, 5)],
                        "answerIndex": ans - 1,
                        "source": f"金研院 {exam} 第{session}節 第{n}題",
                    }
                )
    bank = {"category": {"id": a.category, "name": a.name, "sortOrder": a.sort}, "questions": questions}
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(bank, f, ensure_ascii=False, indent=1)
    print(f"wrote {len(questions)} questions to {a.out}; skipped {len(skipped)}")
    for tag, why in skipped:
        print(f"  skip {tag}: {why}")


if __name__ == "__main__":
    main()
