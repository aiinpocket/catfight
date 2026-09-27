"""Generate game art with a local ComfyUI (Z-Image Turbo) and key out a flat magenta background.

usage: python tools/gen_art.py [--only tank,archer] [--out packages/web/public/assets]
"""
import argparse
import io
import json
import os
import sys
import time
import urllib.request
import uuid

from PIL import Image

COMFY = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
STYLE = (
    "cute chibi cartoon cat character, game sprite, side view facing right, full body, "
    "thick clean outlines, flat cel shading, vibrant colors, centered, "
    "isolated on a solid flat magenta background (#FF00FF), no shadow, no text"
)
NEG = "photo, realistic, blurry, text, watermark, multiple characters, cropped, gradient background"

SPRITES = {
    "tank": "chubby orange tabby cat wearing a piggy-bank shaped helmet and holding a big round shield with a coin symbol, sturdy, brave",
    "archer": "slim grey cat in a green banker vest holding a bow made of a rolled-up bond certificate, focused",
    "mage": "black cat in a purple wizard hat with a stock-chart pattern, holding a glowing candlestick-chart staff, mystical",
    "scholar": "white cat with round glasses holding a clipboard and a calculator, wearing a tie, clever",
    "runner": "sleek cream cat in a red racing jacket with lightning bolt marks, running pose, speed lines",
    "medic": "calico cat in a nurse cap with a heart-shaped first aid bag, gentle smile",
}
SCENERY = {
    "tower_player": "a cute cartoon bank building tower, blue and gold, coin sign on top, game asset, front view, isolated on a solid flat magenta background (#FF00FF), thick outlines, flat cel shading, no text",
    "tower_enemy": "a cute cartoon dark stock-exchange tower, red and black, bear statue on top, game asset, front view, isolated on a solid flat magenta background (#FF00FF), thick outlines, flat cel shading, no text",
}
BACKGROUND = "wide cartoon landscape of a financial district skyline at daytime, flat cel shading, clean vector style, soft pastel sky, empty flat ground in the foreground, no characters, no text, game background"


def workflow(prompt, neg, w, h, seed):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "lumina2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3.0}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": neg}},
        "7": {"class_type": "EmptySD3LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["4", 0], "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["7", 0],
                "seed": seed, "steps": 8, "cfg": 1.0, "sampler_name": "res_multistep", "scheduler": "simple", "denoise": 1.0,
            },
        },
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": "catfight"}},
    }


def submit(wf):
    cid = str(uuid.uuid4())
    data = json.dumps({"prompt": wf, "client_id": cid}).encode()
    req = urllib.request.Request(f"{COMFY}/prompt", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["prompt_id"]


def wait(pid, timeout=600):
    t0 = time.time()
    while time.time() - t0 < timeout:
        with urllib.request.urlopen(f"{COMFY}/history/{pid}") as r:
            h = json.load(r)
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                raise RuntimeError(json.dumps(st)[:2000])
            for node in h[pid]["outputs"].values():
                for img in node.get("images", []):
                    return img
        time.sleep(1.5)
    raise TimeoutError(pid)


def fetch(img):
    q = urllib.parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img.get("type", "output")})
    with urllib.request.urlopen(f"{COMFY}/view?{q}") as r:
        return Image.open(io.BytesIO(r.read())).convert("RGBA")


def key_magenta(im, tol=70):
    """Sample the corners for the background colour, make similar pixels transparent, crop to content."""
    px = im.load()
    w, h = im.size
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    br = sum(c[0] for c in corners) / 4
    bg = sum(c[1] for c in corners) / 4
    bb = sum(c[2] for c in corners) / 4
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            d = ((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2) ** 0.5
            if d < tol:
                px[x, y] = (r, g, b, 0)
            elif d < tol * 1.6:
                f = (d - tol) / (tol * 0.6)
                px[x, y] = (r, g, b, int(255 * f))
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def fit(im, box):
    im.thumbnail(box, Image.LANCZOS)
    return im


def main():
    import urllib.parse  # noqa
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default="packages/web/public/assets")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    only = set(filter(None, args.only.split(",")))

    jobs = []
    for k, desc in SPRITES.items():
        if not only or k in only:
            jobs.append((k, f"{desc}, {STYLE}", 768, 768, (256, 256), True))
    for k, desc in SCENERY.items():
        if not only or k in only:
            jobs.append((k, desc, 768, 1024, (256, 340), True))
    if not only or "background" in only:
        jobs.append(("background", BACKGROUND, 1536, 768, (1536, 768), False))

    for i, (name, prompt, w, h, box, key) in enumerate(jobs):
        print(f"[{i+1}/{len(jobs)}] {name} ...", flush=True)
        pid = submit(workflow(prompt, NEG, w, h, args.seed + i * 11))
        img = fetch(wait(pid))
        if key:
            img = key_magenta(img)
        img = fit(img, box)
        path = os.path.join(args.out, f"{name}.png")
        img.save(path)
        print(f"   saved {path} {img.size}", flush=True)


if __name__ == "__main__":
    import urllib.parse
    main()
