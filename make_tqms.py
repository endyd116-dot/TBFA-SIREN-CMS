"""아워홈 TQMS 통합품질검수시스템 목업 스크린샷 생성"""
from PIL import Image, ImageDraw, ImageFont
import os, math

W, H = 1280, 800
font_path = r"C:\Users\Administrator\Desktop\작업\dev\tbfa-mis\assets\fonts\NotoSansKR-Regular.ttf"

def fnt(size):
    try:
        return ImageFont.truetype(font_path, size)
    except:
        return ImageFont.load_default()

def text_w(d, txt, f):
    bb = d.textbbox((0,0), txt, font=f)
    return bb[2]-bb[0]

img = Image.new("RGB", (W, H), "#f1f5f9")
d = ImageDraw.Draw(img)

# ── Sidebar ──
d.rectangle([0, 0, 200, H], fill="#1e293b")
# Logo area
d.rectangle([0, 0, 200, 60], fill="#0f172a")
d.text((14, 14), "OURHOME", font=fnt(15), fill="#60a5fa")
d.text((14, 34), "TQMS", font=fnt(11), fill="#94a3b8")

# Sidebar menu
menus = [("📊 대시보드", True), ("🔍 검사 관리", False), ("📦 LOT 추적", False),
         ("⚠ CAPA 관리", False), ("📋 원료 입고", False), ("🏭 생산 라인", False),
         ("📈 품질 리포트", False), ("⚙ 시스템 설정", False)]
for i, (name, active) in enumerate(menus):
    y = 80 + i * 44
    if active:
        d.rectangle([0, y-2, 200, y+38], fill="#1d4ed8")
        d.rectangle([0, y-2, 3, y+38], fill="#60a5fa")
    d.text((20, y+10), name, font=fnt(13), fill="#fff" if active else "#94a3b8")

d.text((14, H-36), "v2.3.1  아워홈㈜", font=fnt(10), fill="#475569")

# ── Header ──
d.rectangle([200, 0, W, 56], fill="#ffffff")
d.line([200, 56, W, 56], fill="#e2e8f0", width=1)
d.text((224, 18), "통합품질검수시스템 — 대시보드", font=fnt(16), fill="#1e293b")
# 날짜
d.text((W-260, 20), "2025-01-15  09:24  |  김철수 품질관리팀장", font=fnt(11), fill="#64748b")

# ── KPI Cards row ──
cards = [
    ("#ffffff", "#059669", "오늘 합격률", "97.3%", "▲ 0.8% vs 어제", "#059669"),
    ("#ffffff", "#ef4444", "불량 발생", "14건", "▼ 3건 vs 어제", "#059669"),
    ("#ffffff", "#f59e0b", "CAPA 진행 중", "7건", "신규 2건 추가", "#f59e0b"),
    ("#ffffff", "#2563EB", "검사 대기 LOT", "23건", "평균 대기 18분", "#64748b"),
]
for i, (bg, accent, label, val, sub, sub_clr) in enumerate(cards):
    x = 224 + i * 258
    d.rounded_rectangle([x, 76, x+242, 160], radius=10, fill=bg, outline="#e2e8f0")
    d.rounded_rectangle([x, 76, x+242, 83], radius=3, fill=accent)
    d.text((x+16, 92), label, font=fnt(11), fill="#64748b")
    d.text((x+16, 112), val, font=fnt(26), fill="#1e293b")
    d.text((x+16, 144), sub, font=fnt(11), fill=sub_clr)

# ── Quality Trend Chart ──
cx, cy, cw, ch = 224, 176, 596, 248
d.rounded_rectangle([cx, cy, cx+cw, cy+ch], radius=10, fill="#ffffff", outline="#e2e8f0")
d.text((cx+16, cy+14), "일별 품질 합격률 추이  (최근 14일)", font=fnt(13), fill="#1e293b")
d.text((cx+cw-80, cy+14), "● 합격률", font=fnt(10), fill="#2563EB")

# Chart grid
gx, gy, gw, gh = cx+30, cy+44, cw-50, ch-60
for row in range(5):
    yy = gy + row * (gh//4)
    d.line([gx, yy, gx+gw, yy], fill="#f1f5f9", width=1)
    pct = 100 - row*2
    d.text((gx-34, yy-6), f"{pct}%", font=fnt(9), fill="#94a3b8")

# Line chart data
data = [94.2, 95.8, 96.1, 94.7, 97.0, 97.3, 96.8, 95.4, 97.1, 97.8, 96.5, 97.0, 97.2, 97.3]
points = []
for i, v in enumerate(data):
    px = gx + int(i * gw / (len(data)-1))
    py = gy + int(gh - (v - 93) / 7 * gh)
    points.append((px, py))

# Area fill
area_pts = [(points[0][0], gy+gh)] + points + [(points[-1][0], gy+gh)]
d.polygon(area_pts, fill="#dbeafe")
# Line
for i in range(len(points)-1):
    d.line([points[i], points[i+1]], fill="#2563EB", width=2)
# Dots
for px, py in points:
    d.ellipse([px-3, py-3, px+3, py+3], fill="#2563EB", outline="#fff")

# X labels (dates)
labels = ["1/2","1/3","1/4","1/5","1/6","1/7","1/8","1/9","1/10","1/11","1/12","1/13","1/14","1/15"]
for i, (px, py) in enumerate(points):
    if i % 2 == 0:
        d.text((px-10, gy+gh+6), labels[i], font=fnt(9), fill="#94a3b8")

# ── LOT 현황 테이블 ──
tx, ty, tw, th = 224, 440, 596, 320
d.rounded_rectangle([tx, ty, tx+tw, ty+th], radius=10, fill="#ffffff", outline="#e2e8f0")
d.text((tx+16, ty+14), "LOT별 품질 검사 현황", font=fnt(13), fill="#1e293b")
d.text((tx+tw-100, ty+14), "전체보기 →", font=fnt(10), fill="#2563EB")

cols = ["LOT번호", "원료명", "입고량(kg)", "검사수량", "합격", "불량", "합격률", "상태"]
col_x = [tx+12, tx+90, tx+190, tx+280, tx+360, tx+420, tx+480, tx+548]
# Header
d.rectangle([tx, ty+38, tx+tw, ty+58], fill="#f8fafc")
for i, (cx_, lbl) in enumerate(zip(col_x, cols)):
    d.text((cx_, ty+44), lbl, font=fnt(10), fill="#64748b")

rows = [
    ("LOT-250115-001", "밀가루 1등급", "2,000", "200", "198", "2", "99.0%", "합격", "#059669"),
    ("LOT-250115-002", "설탕 정제당", "1,500", "150", "149", "1", "99.3%", "합격", "#059669"),
    ("LOT-250115-003", "식용유 대두", "800",  "80",  "75",  "5", "93.8%", "검토", "#f59e0b"),
    ("LOT-250115-004", "소금 정제염", "500",  "50",  "50",  "0","100.0%", "합격", "#059669"),
    ("LOT-250115-005", "전분 옥수수", "1,200","120", "110","10", "91.7%", "불합격","#ef4444"),
]
for ri, row in enumerate(rows):
    ry = ty + 62 + ri * 48
    if ri % 2 == 0:
        d.rectangle([tx+1, ry, tx+tw-1, ry+46], fill="#fafafa")
    cells = list(row[:8])
    clr = row[8]
    for ci, (cx_, cell) in enumerate(zip(col_x, cells)):
        if ci == 7:  # 상태 badge
            bw = text_w(d, cell, fnt(10)) + 14
            d.rounded_rectangle([cx_-2, ry+14, cx_+bw, ry+32], radius=6,
                fill=clr+"22", outline=clr)
            d.text((cx_+5, ry+16), cell, font=fnt(10), fill=clr)
        else:
            d.text((cx_, ry+17), cell, font=fnt(11), fill="#1e293b")

# ── Right Panel: CAPA + 라인 현황 ──
rx, ry2, rw = 840, 176, 420

# CAPA panel
d.rounded_rectangle([rx, ry2, rx+rw, ry2+248], radius=10, fill="#ffffff", outline="#e2e8f0")
d.text((rx+16, ry2+14), "CAPA 조치 현황", font=fnt(13), fill="#1e293b")
capa_items = [
    ("C-2501-007", "식용유 이물 혼입 의심", "조치 중", "#f59e0b", "품질팀"),
    ("C-2501-006", "LOT-250114-003 재검사", "검토 중", "#2563EB", "생산팀"),
    ("C-2501-005", "밀가루 수분 초과 (2.1%)", "완료",   "#059669", "협력업체"),
    ("C-2501-004", "소금 입자 편차 기준 초과", "완료",  "#059669", "품질팀"),
]
for i, (code, title, status, sc, owner) in enumerate(capa_items):
    iy = ry2 + 46 + i * 48
    d.line([rx+16, iy+44, rx+rw-16, iy+44], fill="#f1f5f9", width=1)
    d.text((rx+16, iy+4), code, font=fnt(9), fill="#94a3b8")
    d.text((rx+16, iy+20), title, font=fnt(11), fill="#1e293b")
    bw2 = text_w(d, status, fnt(9)) + 12
    d.rounded_rectangle([rx+rw-bw2-60, iy+2, rx+rw-60, iy+20], radius=6,
        fill=sc+"22", outline=sc)
    d.text((rx+rw-bw2-54, iy+4), status, font=fnt(9), fill=sc)
    d.text((rx+rw-50, iy+4), owner, font=fnt(9), fill="#64748b")

# 라인별 합격률
d.rounded_rectangle([rx, ry2+260, rx+rw, ry2+500], radius=10, fill="#ffffff", outline="#e2e8f0")
d.text((rx+16, ry2+274), "생산 라인별 합격률 (오늘)", font=fnt(13), fill="#1e293b")
lines = [("1라인 (밀가루가공)", 98.5, "#059669"),
         ("2라인 (소스 생산)", 96.2, "#059669"),
         ("3라인 (즉석식품)", 94.1, "#f59e0b"),
         ("4라인 (냉동식품)", 97.8, "#059669"),
         ("5라인 (포장 완제)", 91.3, "#ef4444")]
for i, (name, pct, clr) in enumerate(lines):
    by = ry2 + 304 + i*36
    d.text((rx+16, by), name, font=fnt(11), fill="#1e293b")
    d.text((rx+rw-60, by), f"{pct}%", font=fnt(11), fill=clr)
    bar_w = int((pct-88)/12*(rw-32))
    d.rounded_rectangle([rx+16, by+16, rx+rw-68, by+26], radius=4, fill="#f1f5f9")
    d.rounded_rectangle([rx+16, by+16, rx+16+bar_w, by+26], radius=4, fill=clr)

out = r"C:\Users\Administrator\Desktop\작업\dev\tbfa-mis\public\img\a1.png"
img.save(out, "PNG", optimize=True)
print(f"저장 완료: {out}  ({os.path.getsize(out)//1024} KB)")
