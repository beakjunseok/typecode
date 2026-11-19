import json, sys
from PIL import Image, ImageDraw
mode = sys.argv[1]
data = json.load(open(f'/tmp/guide/{mode}.json'))
tiles = []
for sid, shot in data.items():
    im = Image.open(f'/tmp/guide/{sid}.png').convert('RGB'); W, H = im.size; d = ImageDraw.Draw(im)
    for i, m in enumerate(shot['marks']):
        x, y, w, h = m['x']*W/100, m['y']*H/100, m['w']*W/100, m['h']*H/100
        d.rectangle([x, y, x+w, y+h], outline=(255, 181, 71), width=3); d.text((x+3, y+2), str(i+1), fill=(255, 255, 0))
    s = 489 / W; tiles.append(im.resize((489, int(H * s))))
cols = 2; tw = 489; th = max(t.size[1] for t in tiles); rows = (len(tiles)+1)//2
sheet = Image.new('RGB', (tw*cols, th*rows))
for i, t in enumerate(tiles): sheet.paste(t, ((i % cols)*tw, (i//cols)*th))
sheet.save(f'/tmp/guide/preview-{mode}.png')
