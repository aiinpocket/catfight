"""Generate the 100 boss sprites from a JSON list [{id, name, look, profile}] using local ComfyUI.

usage: python tools/gen_bosses.py <bosses.json> [--out packages/web/public/assets/boss] [--only boss_1,boss_2]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from gen_art import NEG, fetch, fit, key_magenta, submit, wait, workflow  # noqa: E402

STYLE = (
    "cute chibi cartoon cat character dressed as a Japanese Sengoku-era samurai warlord, {look}, "
    "game boss sprite, side view facing left, full body, thick clean outlines, flat cel shading, vibrant colors, "
    "centered, isolated on a solid flat magenta background (#FF00FF), no shadow, no text"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("list")
    ap.add_argument("--out", default="packages/web/public/assets/boss")
    ap.add_argument("--only", default="")
    ap.add_argument("--seed", type=int, default=101)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    only = set(filter(None, args.only.split(",")))
    bosses = json.load(open(args.list, encoding="utf-8"))
    for i, b in enumerate(bosses):
        if only and b["id"] not in only:
            continue
        path = os.path.join(args.out, f"{b['id']}.png")
        if os.path.exists(path) and not only:
            continue
        print(f"[{i+1}/{len(bosses)}] {b['id']} {b['name']} ...", flush=True)
        prompt = STYLE.format(look=b["look"])
        pid = submit(workflow(prompt, NEG, 768, 768, args.seed + i * 7))
        img = key_magenta(fetch(wait(pid)))
        img = fit(img, (300, 300))
        img.save(path)
        print(f"   saved {path} {img.size}", flush=True)


if __name__ == "__main__":
    main()
