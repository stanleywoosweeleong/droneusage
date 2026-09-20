"""Generate DroneDose app icons: a spray drone seen from above, no text.

Drawn at 8x and downsampled for clean edges.
Run:  python3 make_icons.py
"""
from PIL import Image, ImageDraw

NAVY = (14, 34, 51)
HULL = (233, 240, 245)
ARM = (150, 173, 190)
ROTOR = (110, 138, 160)
MIST = (95, 208, 160)
TANK = (242, 193, 78)

S = 8  # supersample


def rounded(d, box, r, fill):
    d.rounded_rectangle(box, radius=r, fill=fill)


def draw_drone(size, pad_ratio, maskable=False):
    n = size * S
    img = Image.new("RGBA", (n, n), NAVY + (255,))
    d = ImageDraw.Draw(img)

    # safe area: maskable icons keep art inside the middle 80%
    pad = n * pad_ratio
    box = (pad, pad, n - pad, n - pad)
    w = box[2] - box[0]
    cx = n / 2
    cy = box[1] + w * 0.42

    arm = w * 0.30          # arm half-length
    rr = w * 0.155          # rotor disc radius

    # --- arms (X frame) ---
    lw = int(w * 0.055)
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        d.line(
            [cx, cy, cx + sx * arm, cy + sy * arm * 0.78],
            fill=ARM, width=lw,
        )

    # --- rotor discs ---
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        rx, ry = cx + sx * arm, cy + sy * arm * 0.78
        d.ellipse([rx - rr, ry - rr, rx + rr, ry + rr],
                  outline=ROTOR, width=int(w * 0.035))
        d.ellipse([rx - rr * 0.16, ry - rr * 0.16, rx + rr * 0.16, ry + rr * 0.16],
                  fill=ROTOR)

    # --- body / spray tank ---
    bw, bh = w * 0.30, w * 0.34
    rounded(d, [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2],
            int(w * 0.055), HULL)
    # liquid level inside the tank
    rounded(d, [cx - bw * 0.32, cy - bh * 0.04, cx + bw * 0.32, cy + bh * 0.33],
            int(w * 0.030), TANK)

    # --- spray plume: two widening fans of mist below the outer rotors ---
    jitter = [0.00, 0.22, -0.18, 0.12, -0.26, 0.30, -0.08, 0.18,
              -0.30, 0.06, 0.26, -0.14, 0.34, -0.22, 0.10, -0.34]
    k = 0
    for side in (-1, 1):
        ox = cx + side * arm * 0.74
        oy = cy + arm * 0.78 + rr * 0.72
        for row in range(5):
            t = row / 4.0
            y = oy + w * (0.035 + t * 0.200)
            spread = w * (0.030 + t * 0.150)
            count = 2 + row
            drop = w * (0.029 - t * 0.013)
            for i in range(count):
                f = 0 if count == 1 else i / (count - 1.0) - 0.5
                jx = jitter[k % len(jitter)] * spread * 0.55
                jy = jitter[(k + 5) % len(jitter)] * w * 0.022
                k += 1
                x = ox + f * spread * 2 + jx
                yy = y + jy
                d.ellipse([x - drop, yy - drop, x + drop, yy + drop], fill=MIST)

    return img.resize((size, size), Image.LANCZOS)


draw_drone(192, 0.11).save("icon-192.png")
draw_drone(512, 0.11).save("icon-512.png")
draw_drone(512, 0.20, maskable=True).save("icon-512-maskable.png")
print("icons written")
