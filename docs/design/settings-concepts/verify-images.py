"""只读验证本目录设计原图，记录尺寸及摘要，不重采样或改写图片。"""
import hashlib
import json
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent
results = []
for path in sorted(root.glob('*.png')):
    with Image.open(path) as image:
        image.load()
        width, height = image.size
    results.append({
        'file': path.name,
        'width': width,
        'height': height,
        'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    })
print(json.dumps(results, ensure_ascii=False, indent=2))
