#!/usr/bin/env python3
"""Generate the toolbar icons (a progress ring on a dark rounded square).

Pure Python, no dependencies: python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")

BG = (17, 24, 39)
TRACK = (75, 85, 99)
ARC = (74, 222, 128)
SWEEP = 0.70  # fraction of the ring that is "done"


def write_png(path, w, h, px):
    raw = b"".join(b"\x00" + bytes(px[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def in_round_rect(x, y, n, r):
    cx = min(max(x, r), n - r)
    cy = min(max(y, r), n - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def sample(x, y, n):
    """Colour (r, g, b, a) of one sub-pixel sample."""
    if not in_round_rect(x, y, n, 0.22 * n):
        return (0, 0, 0, 0)
    c = n / 2
    rad = 0.30 * n
    thick = 0.15 * n
    d = math.hypot(x - c, y - c)
    if abs(d - rad) <= thick / 2:
        # angle clockwise from 12 o'clock, 0..1
        a = (math.atan2(x - c, -(y - c)) / (2 * math.pi)) % 1.0
        col = ARC if a <= SWEEP else TRACK
        return col + (255,)
    return BG + (255,)


def render(n, ss=6):
    px = bytearray(n * n * 4)
    for py in range(n):
        for pxl in range(n):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    r, g, b, a = sample(pxl + (sx + 0.5) / ss, py + (sy + 0.5) / ss, n)
                    acc[0] += r * a
                    acc[1] += g * a
                    acc[2] += b * a
                    acc[3] += a
            i = (py * n + pxl) * 4
            if acc[3]:
                px[i:i + 3] = bytes(round(v / acc[3]) for v in acc[:3])
            px[i + 3] = round(acc[3] / (ss * ss))
    return px


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for n in (16, 32, 48, 128):
        write_png(os.path.join(OUT, f"icon{n}.png"), n, n, render(n))
        print("wrote", f"icons/icon{n}.png")
