# Vergelijkt de app met het oude Tailwind-script (CDN) en met het nieuwe gebouwde CSS-bestand.
import os, re, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

shutil.copytree('dist', 'dist-oud')
p = 'dist-oud/app/index.html'
s = open(p).read()
s = re.sub(r'<link rel="stylesheet"[^>]*assets/[^>]*\.css"[^>]*>', '', s)
cfg = open('tailwind.config.js').read()
theme = cfg[cfg.index('theme:'):cfg.rindex('plugins')]
extra = '''<script src="https://cdn.tailwindcss.com/3.4.17"></script><script>tailwind.config = {%s}</script>
<style>body { background-color: #F5F7F4; color: #5D6E76; } .no-scrollbar::-webkit-scrollbar { display: none; } .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }</style>''' % theme
s = s.replace('</head>', extra + '</head>')
open(p, 'w').write(s)

subprocess.Popen([sys.executable, '-m', 'http.server', '8000', '-d', 'dist'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.Popen([sys.executable, '-m', 'http.server', '8001', '-d', 'dist-oud'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
os.makedirs('vergelijk', exist_ok=True)
worst = 0
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for vp in [(390, 844), (1280, 900)]:
        for scen in ['start', 'onboarding']:
            shots = {}
            for name, port in [('oud', 8001), ('nieuw', 8000)]:
                pg = b.new_page(viewport={'width': vp[0], 'height': vp[1]})
                pg.route('**/api/**', lambda r: r.fulfill(status=404, content_type='application/json', body='{}'))
                pg.goto(f'http://localhost:{port}/app/')
                pg.wait_for_timeout(2500)
                if scen == 'onboarding':
                    pg.locator('button.group').first.click()
                    pg.wait_for_timeout(1500)
                f = f'vergelijk/{scen}-{vp[0]}-{name}.png'
                pg.screenshot(path=f, full_page=True)
                shots[name] = f
                pg.close()
            a, c = Image.open(shots['oud']).convert('RGB'), Image.open(shots['nieuw']).convert('RGB')
            if a.size != c.size:
                print(scen, vp, 'ANDERE GROOTTE', a.size, c.size); worst = 100; continue
            d = ImageChops.difference(a, c).convert('L').point(lambda x: 255 if x > 24 else 0)
            pct = sum(1 for x in d.getdata() if x) / (a.size[0] * a.size[1]) * 100
            worst = max(worst, pct)
            print(scen, vp, f'{pct:.3f}% pixels anders')
    b.close()
print('grootste verschil', round(worst, 3))
