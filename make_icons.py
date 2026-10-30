from PIL import Image, ImageDraw, ImageFilter
import os

os.makedirs("icons", exist_ok=True)
S = 1024


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(size):
            px[x, y] = c
    return img


def master():
    bg = Image.new("RGB", (S, S), (6, 7, 12))
    # soft violet/blue glow behind the mark
    glow = Image.new("RGB", (S, S), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((172, 232, 852, 912), fill=(70, 90, 255))
    glow = glow.filter(ImageFilter.GaussianBlur(150))
    bg = Image.blend(bg, Image.composite(glow, bg, glow.convert("L")), 0.55)

    # two rising chevrons = "level up"
    def chevrons(width):
        m = Image.new("L", (S, S), 0)
        d = ImageDraw.Draw(m)
        for dy, alpha in ((0, 255), (190, 130)):
            pts = [(318, 470 + dy), (512, 290 + dy), (706, 470 + dy)]
            d.line(pts, fill=alpha, width=width, joint="curve")
            for p in (pts[0], pts[2]):
                r = width // 2
                d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=alpha)
        return m

    mark = chevrons(78)
    halo = mark.filter(ImageFilter.GaussianBlur(34))
    halo_col = Image.new("RGB", (S, S), (80, 150, 255))
    bg = Image.composite(halo_col, bg, halo.point(lambda v: int(v * 0.9)))

    fill = gradient(S, (120, 225, 255), (120, 110, 255))
    bg = Image.composite(fill, bg, mark)
    return bg


m = master()
for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    m.resize((size, size), Image.LANCZOS).save(os.path.join("icons", name))
print("ok")
