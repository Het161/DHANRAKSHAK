#!/usr/bin/env python3
"""Generate isometric, SMIL-animated 'technical 3D' SVG diagrams for the README.

Pure isometric projection (2:1). Every box is drawn back-to-front as three shaded
faces (top lightest, right mid, front darkest) so it reads as a solid 3D slab.
Self-contained: gradients, filters, SMIL animations only — GitHub renders it as an
<img> and plays the motion. No script, no external assets, theme-neutral dark bg.
"""
import math
from pathlib import Path

DOCS = Path(__file__).resolve().parent

COS = math.cos(math.radians(30))  # 0.866
SIN = math.sin(math.radians(30))  # 0.5


def iso(x, y, z, ox, oy, s):
    """Grid (x,y,z) -> screen. z is up."""
    return (ox + (x - y) * COS * s, oy + (x + y) * SIN * s - z * s)


def pts(coords):
    return " ".join(f"{px:.1f},{py:.1f}" for px, py in coords)


def box(x, y, z, w, d, h, ox, oy, s, top, right, front, stroke, opacity=1.0, extra=""):
    """One iso box. Returns svg string (top drawn last = on top)."""
    A = iso(x, y, z + h, ox, oy, s)
    B = iso(x + w, y, z + h, ox, oy, s)
    C = iso(x + w, y + d, z + h, ox, oy, s)
    D = iso(x, y + d, z + h, ox, oy, s)
    Bl = iso(x + w, y, z, ox, oy, s)
    Cl = iso(x + w, y + d, z, ox, oy, s)
    Dl = iso(x, y + d, z, ox, oy, s)
    right_face = pts([B, C, Cl, Bl])
    front_face = pts([D, C, Cl, Dl])
    top_face = pts([A, B, C, D])
    sw = f'stroke="{stroke}" stroke-width="1.2" stroke-linejoin="round"'
    return (
        f'<g opacity="{opacity}">{extra}'
        f'<polygon points="{right_face}" fill="{right}" {sw}/>'
        f'<polygon points="{front_face}" fill="{front}" {sw}/>'
        f'<polygon points="{top_face}" fill="{top}" {sw}/>'
        f"</g>"
    )


def top_center(x, y, z, w, d, h, ox, oy, s):
    return iso(x + w / 2, y + d / 2, z + h, ox, oy, s)


def face_label_pos(x, y, z, w, d, h, ox, oy, s):
    """Center of the FRONT face, for a label that sits on the visible slab side."""
    return iso(x + w / 2, y + d, z + h / 2, ox, oy, s)


# ---------------------------------------------------------------------------
HEADER = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" '
    'height="{h}" font-family="Verdana,Geneva,sans-serif" role="img" aria-label="{alt}">'
)

DEFS = """
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#04211a"/><stop offset="0.55" stop-color="#062b21"/>
    <stop offset="1" stop-color="#0a3a2b"/>
  </linearGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#5eead4" stop-opacity="0"/>
    <stop offset="0.5" stop-color="#5eead4" stop-opacity="1"/>
    <stop offset="1" stop-color="#5eead4" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="core" cx="0.5" cy="0.4" r="0.6">
    <stop offset="0" stop-color="#eafff8"/><stop offset="0.35" stop-color="#5eead4"/>
    <stop offset="1" stop-color="#0e7c5a"/>
  </radialGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#10b981" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#10b981" stop-opacity="0"/>
  </radialGradient>
  <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
    <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000" flood-opacity="0.45"/>
  </filter>
  <filter id="blur"><feGaussianBlur stdDeviation="3"/></filter>
</defs>
"""


def dot_grid(w, h):
    g = ['<g fill="#5eead4" opacity="0.05">']
    for gx in range(40, w, 46):
        for gy in range(30, h, 46):
            g.append(f'<circle cx="{gx}" cy="{gy}" r="2"/>')
    g.append("</g>")
    return "".join(g)


def label(px, py, text, size=13, weight="600", fill="#eafff8", anchor="middle"):
    return (f'<text x="{px:.1f}" y="{py:.1f}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}">{text}</text>')


def moving_dot(path_d, dur, begin="0s", r=4.5, color="#eafff8"):
    return (f'<circle r="{r}" fill="{color}">'
            f'<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" '
            f'dur="{dur}" begin="{begin}" repeatCount="indefinite"/>'
            f'<animateMotion dur="{dur}" begin="{begin}" repeatCount="indefinite" '
            f'path="{path_d}" rotate="0"/></circle>')


# === Diagram 1: isometric architecture ====================================
def build_arch():
    W, H = 1200, 430
    s = 25
    out = [HEADER.format(w=W, h=H, alt="DhanRakshak architecture, isometric"), DEFS,
           f'<rect width="{W}" height="{H}" rx="22" fill="url(#bg)"/>', dot_grid(W, H)]

    # a stack of labelled slabs, returns list of (screen_top_center) per slab
    def stack(ox, oy, slabs, top, right, front, glow_idx=None):
        w, d, h, gap = 7.6, 4.4, 1.05, 0.75
        centers = []
        for i, name in enumerate(slabs):  # bottom -> top, draw bottom first
            z = i * (h + gap)
            hot = (glow_idx is not None and i == glow_idx)
            t = "#34d399" if hot else top
            extra = ""
            if hot:
                gx, gy = iso(w/2, d/2, z + h/2, ox, oy, s)
                extra = f'<ellipse cx="{gx:.0f}" cy="{gy:.0f}" rx="120" ry="70" fill="url(#glow)"/>'
            out.append(box(0, 0, z, w, d, h, ox, oy, s, t, right, front, "#5eead4",
                           extra=extra))
            cx, cy = top_center(0, 0, z, w, d, h, ox, oy, s)
            centers.append((cx, cy))
        return centers

    # phone stack (offline-first) — bottom: SW cache ... top: verdict card
    phone = ["Service Worker cache", "On-device engine", "Web Worker", "Verdict card · UI"]
    pc = stack(360, 300, phone, "#0e9c73", "#0c7f5d", "#08553f", glow_idx=1)
    # server stack (optional) — FastAPI ... template
    srv = ["FastAPI", "Same detection engine", "BM25 advisories", "Groq LLM → template"]
    sc = stack(880, 300, srv, "#1f8f6f", "#166b54", "#0c4736")

    # labels beside each slab (phone -> left, server -> right)
    for (cx, cy), name in zip(pc, phone):
        out.append(f'<line x1="{cx-95:.0f}" y1="{cy:.0f}" x2="{cx-8:.0f}" y2="{cy:.0f}" stroke="#5eead4" stroke-opacity="0.35" stroke-width="1"/>')
        out.append(label(cx-100, cy+4, name, 13, "600", anchor="end"))
    for (cx, cy), name in zip(sc, srv):
        out.append(f'<line x1="{cx+8:.0f}" y1="{cy:.0f}" x2="{cx+95:.0f}" y2="{cy:.0f}" stroke="#5eead4" stroke-opacity="0.35" stroke-width="1"/>')
        out.append(label(cx+100, cy+4, name, 13, "600", anchor="start"))

    # headings
    out.append(label(pc[0][0], 388, "THE PHONE", 16, "800", "#5eead4"))
    out.append(label(pc[0][0], 407, "runs the real detector · offline-first", 12, "500", "#a7cabb"))
    out.append(label(sc[0][0], 388, "THE SERVER", 16, "800", "#7fe8c6"))
    out.append(label(sc[0][0], 407, "optional · richer explanation", 12, "500", "#a7cabb"))

    # data flow: verdict rising in the phone (bottom engine -> top card)
    p_up = f"M {pc[1][0]:.0f},{pc[1][1]:.0f} L {pc[3][0]:.0f},{pc[3][1]:.0f}"
    out.append(f'<path d="{p_up}" fill="none" stroke="#5eead4" stroke-width="2" stroke-opacity="0.25" stroke-dasharray="4 5"/>')
    out.append(moving_dot(p_up, "1.8s"))
    out.append(label((pc[1][0]+pc[3][0])/2 - 6, (pc[1][1]+pc[3][1])/2 - 60, "verdict &lt; 100ms", 12, "700", "#eafff8"))

    # optional link phone <-> server (dashed, animated), at engine height
    a, b = pc[1], sc[1]
    midx, midy = (a[0]+b[0])/2, min(a[1], b[1]) - 40
    link = f"M {a[0]+70:.0f},{a[1]:.0f} Q {midx:.0f},{midy:.0f} {b[0]-70:.0f},{b[1]:.0f}"
    out.append(f'<path d="{link}" fill="none" stroke="#34d399" stroke-width="1.6" stroke-opacity="0.5" stroke-dasharray="6 6"><animate attributeName="stroke-dashoffset" values="0;-24" dur="1.2s" repeatCount="indefinite"/></path>')
    out.append(moving_dot(link, "2.4s", begin="0.2s", color="#5eead4"))
    # return beam
    link2 = f"M {b[0]-70:.0f},{b[1]+14:.0f} Q {midx:.0f},{midy+34:.0f} {a[0]+70:.0f},{a[1]+14:.0f}"
    out.append(moving_dot(link2, "2.4s", begin="1.4s", color="#7fe8c6", r=3.5))
    out.append(label(midx, midy - 6, "optional · if online", 12, "600", "#a7cabb"))

    out.append("</svg>")
    (DOCS / "arch-3d.svg").write_text("".join(out), encoding="utf-8")
    print("wrote arch-3d.svg", len("".join(out)), "bytes")


# === Diagram 2: isometric detection pipeline ==============================
def build_pipeline():
    W, H = 1200, 512
    s = 22
    out = [HEADER.format(w=W, h=H, alt="DhanRakshak detection pipeline, isometric"), DEFS,
           f'<rect width="{W}" height="{H}" rx="22" fill="url(#bg)"/>', dot_grid(W, H)]
    out.append(label(60, 40, "FOUR INDEPENDENT CHECKS, FUSED BY NOISY-OR", 14, "800", "#5eead4", anchor="start"))

    # four signal platforms, stacked vertically in screen space (each its own hue)
    sigs = [
        ("Rule lexicons", "7 tactics · gu / hi / en", "#22c55e", "#16a34a", "#0f7a34"),
        ("URL heuristics", "look-alike · .apk · bare-IP", "#f59e0b", "#d97706", "#9a5b05"),
        ("UPI-PIN trap", "pay-to-receive inversion", "#fb7185", "#e11d48", "#9f1239"),
        ("TF-IDF + LightGBM", "300-tree classifier", "#818cf8", "#6366f1", "#4338ca"),
    ]
    ox = 360
    w, d, h = 5.0, 3.4, 0.95
    plat = []  # (top-center cx, cy, right-edge rx, ry)
    for i, (name, sub, top, right, front) in enumerate(sigs):
        oy = 122 + i * 92
        out.append(box(0, 0, 0, w, d, h, ox, oy, s, top, right, front, "#eafff8"))
        cx, cy = top_center(0, 0, 0, w, d, h, ox, oy, s)
        lx, ly = iso(0, d / 2, h / 2, ox, oy, s)   # left face mid (label anchor)
        rx, ry = iso(w, d / 2, h, ox, oy, s)       # right edge (beam start)
        plat.append((cx, cy, rx, ry))
        out.append(f'<line x1="{lx-70:.0f}" y1="{ly:.0f}" x2="{lx-6:.0f}" y2="{ly:.0f}" stroke="{top}" stroke-opacity="0.7" stroke-width="1.5"/>')
        out.append(f'<circle cx="{lx-6:.0f}" cy="{ly:.0f}" r="3" fill="{top}"/>')
        out.append(label(lx - 78, ly - 4, name, 13, "700", "#eafff8", anchor="end"))
        out.append(label(lx - 78, ly + 12, sub, 10, "600", "#9fc7b8", anchor="end"))

    # central glowing fusion core
    cox, coy, cw = 640, 250, 3.6
    core_c = iso(cw / 2, cw / 2, cw / 2, cox, coy, s)
    out.append(f'<ellipse cx="{core_c[0]:.0f}" cy="{core_c[1]:.0f}" rx="150" ry="120" fill="url(#glow)"><animate attributeName="opacity" values="0.9;0.45;0.9" dur="3s" repeatCount="indefinite"/></ellipse>')

    # beams: each signal -> core
    for i, (cx, cy, rx, ry) in enumerate(plat):
        ex, ey = core_c[0] - 42, core_c[1]
        mx, my = (rx + ex) / 2, (ry + ey) / 2 - 26
        beam = f"M {rx:.0f},{ry:.0f} Q {mx:.0f},{my:.0f} {ex:.0f},{ey:.0f}"
        out.append(f'<path d="{beam}" fill="none" stroke="url(#beam)" stroke-width="2.2" stroke-opacity="0.5"/>')
        out.append(moving_dot(beam, "1.6s", begin=f"{i*0.32:.2f}s", r=4, color="#eafff8"))

    out.append(box(0, 0, 0, cw, cw, cw, cox, coy, s, "url(#core)", "#0e7c5a", "#0a5b42", "#eafff8",
                   extra='<animateTransform attributeName="transform" type="scale" values="1;1.05;1" additive="sum" dur="3s" repeatCount="indefinite"/>'))
    out.append(label(core_c[0], core_c[1] - 3, "noisy-OR", 13, "800", "#04211a"))
    out.append(label(core_c[0], core_c[1] + 14, "fusion", 12, "700", "#04211a"))

    # transaction-alert veto — taps the classifier beam (precision detail)
    vx, vy = 486, 420
    vw, vd, vh = 6.2, 3.0, 0.7
    out.append(box(0, 0, 0, vw, vd, vh, vx, vy, s, "#0c4536", "#0a3327", "#07271e", "#5eead4", opacity=0.97))
    vc = top_center(0, 0, 0, vw, vd, vh, vx, vy, s)
    out.append(label(vc[0], vc[1] - 2, "transaction-alert veto", 11, "700", "#5eead4"))
    out.append(label(vc[0], vc[1] + 12, "mutes the classifier on real bank SMS", 9, "600", "#a7cabb"))
    ml = plat[3]
    tapx, tapy = (ml[2] + core_c[0]) / 2 + 14, (ml[3] + core_c[1]) / 2 + 2
    out.append(f'<line x1="{vc[0]:.0f}" y1="{vc[1]-20:.0f}" x2="{tapx:.0f}" y2="{tapy:.0f}" stroke="#5eead4" stroke-opacity="0.5" stroke-width="1.3" stroke-dasharray="3 4"/>')

    # ----- risk gauge (right): a filled iso meter with 0/35/65/100 ticks -----
    gx, gbase, gw, max_h = 985, 372, 2.8, 6.2
    # output beam core -> meter
    beam_end = iso(gw / 2, gw / 2, max_h * 0.5, gx, gbase, s)
    gbeam = f"M {core_c[0]+40:.0f},{core_c[1]:.0f} Q {(core_c[0]+beam_end[0])/2:.0f},{core_c[1]-30:.0f} {beam_end[0]-34:.0f},{core_c[1]:.0f}"
    out.append(f'<path d="{gbeam}" fill="none" stroke="url(#beam)" stroke-width="2.4" stroke-opacity="0.6"/>')
    out.append(moving_dot(gbeam, "1.5s", r=4.5))
    # shell + filled segments (green -> red, full: our demo scam scores 100)
    out.append(box(0, 0, 0, gw, gw, max_h, gx, gbase, s, "#0a2b21", "#082018", "#06170f", "#2f6f5a", opacity=0.5))
    seg = max_h / 5
    cols = ["#22c55e", "#22c55e", "#eab308", "#f97316", "#ef4444"]
    for i in range(5):
        z = i * seg
        out.append(box(0, 0, z + 0.06, gw, gw, seg * 0.9, gx, gbase, s, cols[i], cols[i], "#0a3327", "#0a2b21", opacity=0.96))
    # rising scan glow up the meter
    lo = iso(gw / 2, gw / 2, 0.2, gx, gbase, s)
    hi = iso(gw / 2, gw / 2, max_h - 0.2, gx, gbase, s)
    out.append(f'<ellipse rx="30" ry="12" fill="#ffffff"><animate attributeName="opacity" values="0;0.55;0" dur="2.6s" repeatCount="indefinite"/>'
               f'<animateMotion dur="2.6s" repeatCount="indefinite" path="M {lo[0]:.0f},{lo[1]:.0f} L {hi[0]:.0f},{hi[1]:.0f}"/></ellipse>')
    # tick labels on the right edge
    for val, frac in [("0", 0.0), ("35", 0.35), ("65", 0.65), ("100", 1.0)]:
        tp = iso(gw, gw / 2, frac * max_h, gx, gbase, s)
        out.append(f'<line x1="{tp[0]:.0f}" y1="{tp[1]:.0f}" x2="{tp[0]+12:.0f}" y2="{tp[1]:.0f}" stroke="#5eead4" stroke-opacity="0.5" stroke-width="1"/>')
        out.append(label(tp[0] + 16, tp[1] + 4, val, 10, "700", "#cdeee2", anchor="start"))
    top_c = iso(gw / 2, gw / 2, max_h, gx, gbase, s)
    out.append(label(top_c[0], top_c[1] - 30, "RISK", 13, "800", "#eafff8"))
    out.append(label(top_c[0], top_c[1] - 14, "safe · suspicious · scam", 9.5, "600", "#a7cabb"))
    out.append(label(iso(gw / 2, gw / 2, 0, gx, gbase, s)[0], gbase + 42, "+ highlighted evidence", 10.5, "700", "#7fe8c6"))

    out.append("</svg>")
    (DOCS / "pipeline-3d.svg").write_text("".join(out), encoding="utf-8")
    print("wrote pipeline-3d.svg", len("".join(out)), "bytes")


if __name__ == "__main__":
    DOCS.mkdir(exist_ok=True)
    build_arch()
    build_pipeline()
