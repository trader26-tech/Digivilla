"""Digivilla app icon — a detailed isometric modern villa with pool, trees & fence.

Recreates the reference render: a two-storey off-white house with a flat
overhanging roof and blue windows, a swimming pool, two hedge/trees, a wooden
perimeter fence, on a green grassy plot with soil sides. Isometric, on the app's
dark ground. Rendered with Pillow at 4x supersampling.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 4


def shade(c, f):
    return tuple(max(0, min(255, round(x * f))) for x in c)


def draw_icon(px):
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))

    # ---- dark ground (matches the app --paper #0E1116) ----
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, px, px], fill=(0x11, 0x16, 0x1F))
    # subtle radial vignette lighter in the middle
    glow = Image.new("L", (px, px), 0)
    ImageDraw.Draw(glow).ellipse([px*0.1, px*0.02, px*0.9, px*0.75], fill=60)
    glow = glow.filter(ImageFilter.GaussianBlur(px*0.18))
    img.paste(Image.new("RGBA", (px, px), (0x20, 0x27, 0x33, 255)), (0, 0), glow)
    d = ImageDraw.Draw(img)

    # ---------- isometric plot ----------
    cx, cy = px*0.5, px*0.56
    W = px*0.40          # half-width of the plot diamond
    H = W*0.5
    depth = px*0.10

    def dia(cx, cy, w, h):
        return [(cx, cy-h), (cx+w, cy), (cx, cy+h), (cx-w, cy)]

    top = dia(cx, cy, W, H)
    # soil sides
    left_face = [(cx-W, cy), (cx, cy+H), (cx, cy+H+depth), (cx-W, cy+depth)]
    right_face = [(cx+W, cy), (cx, cy+H), (cx, cy+H+depth), (cx+W, cy+depth)]

    # soft shadow beneath the plot
    sh = Image.new("L", (px, px), 0)
    ImageDraw.Draw(sh).polygon(dia(cx, cy+depth*1.4, W*1.02, H*1.02), fill=120)
    sh = sh.filter(ImageFilter.GaussianBlur(px*0.045))
    img.paste(Image.new("RGBA", (px, px), (0, 0, 0, 255)), (0, 0), sh)
    d = ImageDraw.Draw(img)

    SOIL_L = (0x8A, 0x5A, 0x33)
    SOIL_R = (0x6D, 0x45, 0x27)
    GRASS = (0x6C, 0xC0, 0x4B)
    d.polygon(left_face, fill=SOIL_L)
    d.polygon(right_face, fill=SOIL_R)
    d.polygon(top, fill=GRASS)

    # helper: map a plot-space (u,v) in [-1,1] to screen, u→right-down, v→left-down
    def P(u, v, lift=0.0):
        # u along the +x iso axis (toward right corner), v along +y (toward bottom)
        sx = cx + (u - v) * (W/2)
        sy = cy + (u + v) * (H/2) - lift
        return (sx, sy)

    # ---------- perimeter fence (back two edges drawn first) ----------
    FENCE = (0x9A, 0x63, 0x33)
    FENCE_D = (0x7A, 0x4B, 0x25)
    def fence_run(a_u, a_v, b_u, b_v, posts=6):
        # rail
        p0 = P(a_u, a_v, lift=px*0.045); p1 = P(b_u, b_v, lift=px*0.045)
        p0b = P(a_u, a_v, lift=px*0.005); p1b = P(b_u, b_v, lift=px*0.005)
        d.line([p0, p1], fill=FENCE, width=max(1, int(px*0.008)))
        d.line([(p0[0], p0[1]+px*0.02), (p1[0], p1[1]+px*0.02)], fill=FENCE_D, width=max(1, int(px*0.006)))
        for i in range(posts+1):
            t = i/posts
            uu = a_u+(b_u-a_u)*t; vv=a_v+(b_v-a_v)*t
            top_p = P(uu, vv, lift=px*0.05); bot_p = P(uu, vv, lift=0)
            d.line([top_p, bot_p], fill=FENCE_D, width=max(1, int(px*0.008)))
    m = 0.92
    # back-left edge and back-right edge (drawn before house)
    fence_run(-m, -m,  m, -m)   # back-right
    fence_run(-m, -m, -m,  m)   # back-left

    # ---------- pool (front-left of the plot) ----------
    POOL = (0x4F, 0xB0, 0xD8)
    POOL_D = (0x2E, 0x8C, 0xB8)
    pool = [P(-0.30, 0.28), P(0.12, 0.28), P(0.12, 0.70), P(-0.30, 0.70)]
    d.polygon(pool, fill=POOL)
    d.polygon([pool[0], pool[1], (pool[1][0], pool[1][1]+px*0.012), (pool[0][0], pool[0][1]+px*0.012)], fill=POOL_D)
    # pool deck rim
    d.line(pool+[pool[0]], fill=(0xEA, 0xE4, 0xD5), width=max(1, int(px*0.006)))

    # ---------- trees / hedges ----------
    def tree(u, v, r):
        base = P(u, v)
        # shadow
        d.ellipse([base[0]-r, base[1]-r*0.4, base[0]+r, base[1]+r*0.4], fill=shade(GRASS, 0.7))
        cxx, cyy = base[0], base[1]-r*1.1
        d.ellipse([cxx-r, cyy-r, cxx+r, cyy+r], fill=(0x3E, 0x8E, 0x3B))
        d.ellipse([cxx-r, cyy-r, cxx+r*0.4, cyy+r*0.2], fill=(0x53, 0xA8, 0x4A))
    tree(0.66, -0.10, px*0.058)   # right of house
    tree(0.30, 0.45, px*0.032)    # hedge front-right
    tree(-0.42, 0.10, px*0.028)   # hedge by pool

    # ---------- the modern villa (centre-back) ----------
    WALL = (0xEE, 0xE7, 0xD6)
    WALL_L = WALL
    WALL_R = shade(WALL, 0.82)
    ROOF = (0xEA, 0xE3, 0xCF)
    ROOF_TOP = shade(ROOF, 1.05)
    GLASS = (0x3E, 0x5A, 0x74)
    GLASS_L = (0x4A, 0x6A, 0x86)
    DOOR = (0x8A, 0x5A, 0x33)

    # ground-floor cuboid: a WIDE low rectangle toward the back of the plot
    gu0, gv0, gu1, gv1 = -0.55, -0.62, 0.42, 0.02
    g_h = px*0.115   # ground floor height (low)
    # top face corners
    A = P(gu0, gv0); B = P(gu1, gv0); C = P(gu1, gv1); D_ = P(gu0, gv1)
    # lifted (roof of ground floor) corners
    At = P(gu0, gv0, g_h); Bt = P(gu1, gv0, g_h); Ct = P(gu1, gv1, g_h); Dt = P(gu0, gv1, g_h)
    # visible walls: front-left (D_→C) and front-right? In iso, front faces are
    # the two lower edges: left wall (A→D_) and right wall (D_→C).
    d.polygon([P(gu0, gv0), P(gu0, gv1), P(gu0, gv1, g_h), P(gu0, gv0, g_h)], fill=WALL_L)      # left wall
    d.polygon([P(gu0, gv1), P(gu1, gv1), P(gu1, gv1, g_h), P(gu0, gv1, g_h)], fill=WALL_R)      # front wall
    d.polygon([At, Bt, Ct, Dt], fill=ROOF_TOP)   # ground-floor rooftop terrace

    # ground-floor windows (blue), on the front wall
    def wall_window(u0, v, u1, y0f, y1f, wall_h, base_lift, col, face='front', uconst=None):
        if face == 'front':
            p0 = P(u0, v, base_lift + wall_h*y1f); p1 = P(u1, v, base_lift + wall_h*y1f)
            p2 = P(u1, v, base_lift + wall_h*y0f); p3 = P(u0, v, base_lift + wall_h*y0f)
        else:  # left face, u constant, vary v (u0,u1 are v range)
            p0 = P(uconst, u0, base_lift + wall_h*y1f); p1 = P(uconst, u1, base_lift + wall_h*y1f)
            p2 = P(uconst, u1, base_lift + wall_h*y0f); p3 = P(uconst, u0, base_lift + wall_h*y0f)
        d.polygon([p0, p1, p2, p3], fill=col)
    # front-wall glazing: a tall glass strip + a couple of windows + a door
    wall_window(-0.40, gv1, -0.20, 0.16, 0.86, g_h, 0, GLASS)     # tall glass entry
    wall_window(-0.12, gv1, 0.06, 0.30, 0.72, g_h, 0, GLASS)      # window
    wall_window(0.16, gv1, 0.30, 0.30, 0.72, g_h, 0, GLASS)       # window
    wall_window(0.33, gv1, 0.42, 0.12, 0.66, g_h, 0, DOOR)        # side door
    # windows on the left wall
    wall_window(-0.52, -0.30, 0.0, 0.30, 0.78, g_h, 0, GLASS_L, face='left', uconst=gu0)

    # ---- upper storey: set toward the LEFT, wide, low ----
    uu0, uv0, uu1, uv1 = -0.52, -0.60, 0.02, -0.16
    u_h = px*0.11
    base = g_h
    d.polygon([P(uu0, uv0, base), P(uu0, uv1, base), P(uu0, uv1, base+u_h), P(uu0, uv0, base+u_h)], fill=WALL_L)  # left
    d.polygon([P(uu0, uv1, base), P(uu1, uv1, base), P(uu1, uv1, base+u_h), P(uu0, uv1, base+u_h)], fill=WALL_R)  # front
    # upper windows (front + left)
    wall_window(-0.44, uv1, -0.24, 0.2, 0.82, u_h, base, GLASS)
    wall_window(-0.16, uv1, 0.0, 0.2, 0.82, u_h, base, GLASS)
    wall_window(-0.50, -0.44, -0.20, 0.25, 0.8, u_h, base, GLASS_L, face='left', uconst=uu0)

    # ---- flat overhanging roof on top of the upper storey ----
    over = 0.12
    rt = base + u_h
    r0 = P(uu0-over, uv0-over, rt); r1 = P(uu1+over, uv0-over, rt)
    r2 = P(uu1+over, uv1+over, rt); r3 = P(uu0-over, uv1+over, rt)
    # roof slab thickness
    slab = px*0.022
    d.polygon([r3, r2, (r2[0], r2[1]+slab), (r3[0], r3[1]+slab)], fill=shade(ROOF, 0.8))
    d.polygon([r1, r2, (r2[0], r2[1]+slab), (r1[0], r1[1]+slab)], fill=shade(ROOF, 0.7))
    d.polygon([r0, r1, r2, r3], fill=ROOF_TOP)

    # ---------- front fence edges (drawn last, in front of the house) ----------
    fence_run(m, -m,  m,  m)   # front-right
    fence_run(-m, m,  m,  m)   # front-left

    return img


def main():
    MASTER = 512*SS
    master = draw_icon(MASTER)
    for s in [72, 96, 128, 144, 152, 192, 384, 512]:
        master.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f"v2-icon-{s}x{s}.png"))
        print("wrote", f"v2-icon-{s}x{s}.png")


if __name__ == "__main__":
    main()
