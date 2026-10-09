"""按内容裁掉截图四周的纯背景边距（用于 README 配图）。

用法：python tools/trim-png.py <png> [pad]
"""
import sys
from PIL import Image, ImageChops

path = sys.argv[1]
pad = int(sys.argv[2]) if len(sys.argv) > 2 else 20

image = Image.open(path).convert("RGB")
background = Image.new("RGB", image.size, image.getpixel((0, 0)))
box = ImageChops.difference(image, background).getbbox()
if box is None:
    print(f"{path}: 全图都是背景色，跳过")
    sys.exit(0)

left = max(0, box[0] - pad)
top = max(0, box[1] - pad)
right = min(image.width, box[2] + pad)
bottom = min(image.height, box[3] + pad)
cropped = image.crop((left, top, right, bottom))
cropped.save(path)
print(f"{path}: {image.width}x{image.height} -> {cropped.width}x{cropped.height}")
