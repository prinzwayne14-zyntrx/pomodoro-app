from PIL import Image, ImageDraw
import os

os.makedirs("icons", exist_ok=True)

def draw(size):
    S = size * 4  # supersample for smooth edges
    img = Image.new("RGB", (S, S), "#14110f")
    d = ImageDraw.Draw(img)
    cx = cy = S // 2
    # tomato body
    r = int(S * 0.30)
    d.ellipse((cx - r, cy - r + S * 0.04, cx + r, cy + r + S * 0.04), fill="#ff6b4a")
    # highlight
    hr = int(S * 0.07)
    d.ellipse((cx - r * 0.55, cy - r * 0.45, cx - r * 0.55 + hr * 2, cy - r * 0.45 + hr * 1.2), fill="#ff9a80")
    # leaves
    leaf = "#4ecb9a"
    top = cy - r + S * 0.04
    d.polygon([(cx, top + S * 0.02), (cx - S * 0.13, top - S * 0.04), (cx - S * 0.05, top + S * 0.05)], fill=leaf)
    d.polygon([(cx, top + S * 0.02), (cx + S * 0.13, top - S * 0.04), (cx + S * 0.05, top + S * 0.05)], fill=leaf)
    d.rectangle((cx - S * 0.012, top - S * 0.09, cx + S * 0.012, top + S * 0.02), fill=leaf)
    return img.resize((size, size), Image.LANCZOS)

for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    draw(size).save(os.path.join("icons", name))
print("ok")
