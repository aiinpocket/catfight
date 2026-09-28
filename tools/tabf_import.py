"""Convert TABF (台灣金融研訓院) past-exam PDFs into a catfight question bank JSON.

Layout "two-session" (default): each exam id has three files: <id>-1.pdf (session 1 questions),
<id>-2.pdf (session 2 questions), <id>-3.pdf (answer key with two columns: 第一節 / 第二節).

Layout "single2col": one session; <id>-1.pdf holds all 60 questions in a two-column landscape page
(each column is extracted separately), <id>-2.pdf is a one-column answer key.

usage:
  python tools/tabf_import.py --dir <pdf dir> --ids 663415,644264,617843 \
      --category family_trust --name 家族信託規劃顧問 --sort 1 --out data/questions/family_trust.json
  python tools/tabf_import.py --dir <pdf dir> --ids 663416,644266,617844 --layout single2col       --category fintech --name 金融科技力 --sort 2 --out data/questions/fintech.json
  python tools/tabf_import.py --dir data/pdf/esg --ids 666084,647398,644267 --layout single2col --count 80       --category esg --name 永續發展基礎能力 --sort 3 --out data/questions/esg.json

--count is the number of questions per session (60 for most TABF exams, 80 for 永續發展基礎能力).

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

# "55「. 題目」" — an opening quote sometimes lands between the number and the dot; keep the quote with the text
Q_RE = re.compile(r"^(\d{1,2})(「?)\.\s*(.*)$")
OPT_RE = re.compile(r"^\((\d)\)\s*(.*)$")
NOISE_RE = re.compile(
    r"^(第\s*[\d一二三四]+\s*部分|注意：|本試卷|鉛筆在|答案卡|選作答|\d+\s*$|台灣金融研訓院|節次：|第\s*\d+\s*期.*測驗試題$)"
)


def page_lines(pdf_path, columns=1):
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            regions = [page]
            if columns > 1:
                w = page.width / columns
                regions = [page.crop((i * w, 0, (i + 1) * w, page.height)) for i in range(columns)]
            for region in regions:
                text = region.extract_text() or ""
                for ln in text.splitlines():
                    ln = ln.strip()
                    if not ln or NOISE_RE.match(ln):
                        continue
                    lines.append(ln)
    return lines


def parse_questions(pdf_path, columns=1):
    """Return {num: {"text": str, "options": {1..4: str}}}."""
    qs = {}
    cur = None
    cur_opt = None
    for ln in page_lines(pdf_path, columns):
        m = Q_RE.match(ln)
        # a new question starts with "N." where N is the expected next number (guards against "1.5 分" etc.)
        if m and (cur is None and int(m.group(1)) == 1 or cur is not None and int(m.group(1)) == cur + 1):
            cur = int(m.group(1))
            cur_opt = None
            qs[cur] = {"text": (m.group(2) + m.group(3)).strip(), "options": {}}
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


def parse_answers(pdf_path, count=60):
    """Return {session(1|2): {num: answer_or_None}}; None for multi-answer / 送分 items."""
    out = {1: {}, 2: {}}
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join((p.extract_text() or "") for p in pdf.pages)
    for ln in text.splitlines():
        m = re.match(r"^(\d{1,2})\s+(\S+)\s+(\S+)\s*$", ln.strip())
        if not m:
            continue
        n = int(m.group(1))
        if not 1 <= n <= count:
            continue
        for s, tok in ((1, m.group(2)), (2, m.group(3))):
            out[s][n] = int(tok) if re.fullmatch(r"[1-4]", tok) else None
    return out


def parse_answers_single(pdf_path, count=60):
    """One-column key "N A" -> {num: answer_or_None}."""
    out = {}
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join((p.extract_text() or "") for p in pdf.pages)
    for ln in text.splitlines():
        m = re.match(r"^(\d{1,2})\s+(\S+)\s*$", ln.strip())
        if not m:
            continue
        n = int(m.group(1))
        if 1 <= n <= count:
            out[n] = int(m.group(2)) if re.fullmatch(r"[1-4]", m.group(2)) else None
    return out


def clean(s):
    s = re.sub(r"\s+", " ", s).strip()
    # a page-break header such as "第二部分" occasionally leaks a lone trailing "第"
    s = re.sub(r"第$", "", s).strip()
    # a closing quote with no opening one is a layout artifact (e.g. a stray 」 on its own line)
    if "」" in s and "「" not in s:
        s = s.replace("」", "").strip()
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--ids", required=True)
    ap.add_argument("--category", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--sort", type=int, default=0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--layout", choices=["two-session", "single2col"], default="two-session")
    ap.add_argument("--count", type=int, default=60, help="questions per session (60, or 80 for 永續發展基礎能力)")
    a = ap.parse_args()

    questions = []
    skipped = []
    for exam in a.ids.split(","):
        if a.layout == "single2col":
            answers = {1: parse_answers_single(os.path.join(a.dir, f"{exam}-2.pdf"), a.count)}
            sessions = [(1, parse_questions(os.path.join(a.dir, f"{exam}-1.pdf"), columns=2))]
        else:
            answers = parse_answers(os.path.join(a.dir, f"{exam}-3.pdf"), a.count)
            sessions = [(s, parse_questions(os.path.join(a.dir, f"{exam}-{s}.pdf"))) for s in (1, 2)]
        for session, qs in sessions:
            for n in range(1, a.count + 1):
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
                        "source": f"金研院 {exam} 第{session}節 第{n}題" if a.layout != "single2col" else f"金研院 {exam} 第{n}題",
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
