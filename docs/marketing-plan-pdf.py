"""Metwork go-to-market plan — branded PDF (Metwork design system).

Regenerate: python3 docs/marketing-plan-pdf.py  →  docs/Metwork-Marketing-Plan.pdf
"""
import sys
# Needs reportlab: pip install reportlab==4.2.5

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, NextPageTemplate, Paragraph, Spacer,
                                Table, TableStyle, PageBreak, Flowable, KeepTogether, CondPageBreak)

import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = f'{ROOT}/src/server/pdf/fonts'
pdfmetrics.registerFont(TTFont('M', f'{FONTS}/Montserrat-Regular.ttf'))
pdfmetrics.registerFont(TTFont('M-Med', f'{FONTS}/Montserrat-Medium.ttf'))
pdfmetrics.registerFont(TTFont('M-Bold', f'{FONTS}/Montserrat-Bold.ttf'))
from reportlab.lib.fonts import addMapping
addMapping('M', 0, 0, 'M'); addMapping('M', 1, 0, 'M-Bold'); addMapping('M', 0, 1, 'M'); addMapping('M', 1, 1, 'M-Bold')
LOGO = f'{ROOT}/public/assets/metworklogo.png'          # 1314 × 273
LOGO_W = f'{ROOT}/public/assets/Metworkwhitelogo.png'   # 1621 × 343

# ── Metwork design tokens ────────────────────────────────────────────────
BRAND = colors.HexColor('#00A550')   # logo green
PRIMARY = colors.HexColor('#1A7F37') # UI primary (hsl 142 65% 30%)
DEEP = colors.HexColor('#0E3B1E')    # hero cards
DEEP2 = colors.HexColor('#194B2A')
MINT = colors.HexColor('#E5F4E9')
MINT2 = colors.HexColor('#F4FAF5')
SOFT = colors.HexColor('#B9DDC3')
INK = colors.HexColor('#0F1A14')
GRAY = colors.HexColor('#4B5B52')
RULE = colors.HexColor('#E3E9E5')
BG = colors.HexColor('#F6F8F6')
GOLD = colors.HexColor('#C99A1E')
AMBER_BG = colors.HexColor('#FDF0DC')
AMBER = colors.HexColor('#8A5300')
WHITE = colors.white

PAGE_W, PAGE_H = A4
MX = 18 * mm
W = PAGE_W - 2 * MX

def st(name, **kw):
    base = dict(fontName='M', fontSize=9.6, leading=14.2, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
    'eyebrow': st('eyebrow', fontName='M-Bold', fontSize=8, leading=10, textColor=BRAND),
    'h1': st('h1', fontName='M-Bold', fontSize=21, leading=26, textColor=DEEP, spaceAfter=4),
    'lead': st('lead', fontSize=10.6, leading=16, textColor=GRAY, spaceAfter=8),
    'h3': st('h3', fontName='M-Bold', fontSize=10.6, leading=14, textColor=DEEP, spaceBefore=8, spaceAfter=3),
    'p': st('p', spaceAfter=5),
    'small': st('small', fontSize=8, leading=11, textColor=GRAY),
    'li': st('li', leftIndent=12, bulletIndent=1, spaceAfter=3.5, bulletFontName='M-Bold', bulletFontSize=11, bulletColor=BRAND),
    'cell': st('cell', fontSize=8.5, leading=11.6),
    'cellb': st('cellb', fontName='M-Bold', fontSize=8.5, leading=11.6, textColor=DEEP),
    'cellh': st('cellh', fontName='M-Bold', fontSize=8, leading=10.5, textColor=WHITE),
    'callout': st('callout', fontSize=10, leading=15, textColor=WHITE),
    'tileN': st('tileN', fontName='M-Bold', fontSize=17, leading=20, textColor=DEEP),
    'tileL': st('tileL', fontSize=7.8, leading=10, textColor=GRAY),
}

def P(t, s='p'): return Paragraph(t, S[s])
def bullets(items): return [Paragraph(i, S['li'], bulletText='•') for i in items]

# ── Components ───────────────────────────────────────────────────────────
class SectionHead(Flowable):
    """Number badge + eyebrow + title, the page's anchor."""
    def __init__(self, num, eyebrow, title):
        super().__init__(); self.num, self.eyebrow, self.title = num, eyebrow, title
        self.height = 20 * mm
    def wrap(self, aw, ah): self.width = aw; return aw, self.height
    def draw(self):
        c = self.canv
        c.setFillColor(BRAND); c.roundRect(0, self.height - 12 * mm, 12 * mm, 12 * mm, 3.2 * mm, stroke=0, fill=1)
        c.setFillColor(WHITE); c.setFont('M-Bold', 13); c.drawCentredString(6 * mm, self.height - 7.9 * mm, self.num)
        c.setFillColor(BRAND); c.setFont('M-Bold', 7.6); c.drawString(16 * mm, self.height - 4 * mm, self.eyebrow.upper())
        c.setFillColor(DEEP); c.setFont('M-Bold', 17); c.drawString(16 * mm, self.height - 11 * mm, self.title)

class Rule(Flowable):
    def __init__(self, space=4 * mm): super().__init__(); self.space = space
    def wrap(self, aw, ah): self.width = aw; return aw, self.space
    def draw(self):
        self.canv.setStrokeColor(RULE); self.canv.setLineWidth(0.8); self.canv.line(0, self.space / 2, self.width, self.space / 2)

def card(flowables, bg=WHITE, border=RULE, pad=10, accent=None, width=W):
    t = Table([[flowables]], colWidths=[width])
    cmds = [('BACKGROUND', (0, 0), (-1, -1), bg), ('BOX', (0, 0), (-1, -1), 0.8, border),
            ('ROUNDEDCORNERS', [10, 10, 10, 10]), ('LEFTPADDING', (0, 0), (-1, -1), pad),
            ('RIGHTPADDING', (0, 0), (-1, -1), pad), ('TOPPADDING', (0, 0), (-1, -1), pad), ('BOTTOMPADDING', (0, 0), (-1, -1), pad)]
    t.setStyle(TableStyle(cmds)); return t

def hero(html, width=W):
    """Deep-green card like the dashboard wallet card."""
    return card([Paragraph(html, S['callout'])], bg=DEEP, border=DEEP, pad=13, width=width)

def note(html):
    return card([Paragraph(html, st('n', fontSize=9.2, leading=13.6, textColor=DEEP))], bg=MINT, border=MINT, pad=10, accent=BRAND)

def tiles(items, cols=None):
    """KPI tiles: [(value, label)]."""
    cols = cols or len(items)
    gap = 3 * mm
    cw = (W - gap * (cols - 1)) / cols
    cells = [card([Paragraph(v, S['tileN']), Spacer(1, 2), Paragraph(l, S['tileL'])], bg=WHITE, border=RULE, pad=8, width=cw) for v, l in items]
    row = []
    for i, c in enumerate(cells):
        row.append(c)
        if i < len(cells) - 1: row.append('')
    widths = []
    for i in range(len(cells)):
        widths.append(cw)
        if i < len(cells) - 1: widths.append(gap)
    t = Table([row], colWidths=widths)
    t.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                           ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0), ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
    return t

def table(rows, widths, first_bold=True):
    data = [[Paragraph(str(c), S['cellh'] if r == 0 else (S['cellb'] if (ci == 0 and first_bold) else S['cell']))
             for ci, c in enumerate(row)] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1)
    cmds = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), DEEP),
            ('ROUNDEDCORNERS', [8, 8, 8, 8]), ('BOX', (0, 0), (-1, -1), 0.6, RULE),
            ('LINEBELOW', (0, 1), (-1, -2), 0.5, RULE),
            ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]
    for r in range(1, len(rows)):
        if r % 2 == 0: cmds.append(('BACKGROUND', (0, r), (-1, r), MINT2))
    t.setStyle(TableStyle(cmds)); return t

class PhaseBanner(Flowable):
    """Phase header strip: big number, title, timeframe chip, goal line."""
    def __init__(self, n, title, when, goal):
        super().__init__(); self.n, self.title, self.when, self.goal = n, title, when, goal
        self.height = 30 * mm
    def wrap(self, aw, ah): self.width = aw; return aw, self.height
    def draw(self):
        c = self.canv; h = self.height
        c.setFillColor(DEEP); c.roundRect(0, 0, self.width, h, 4.5 * mm, stroke=0, fill=1)
        # watermark number
        c.setFillColor(DEEP2); c.setFont('M-Bold', 54); c.drawRightString(self.width - 8 * mm, 4 * mm, self.n)
        c.setFillColor(BRAND); c.roundRect(7 * mm, h - 9.5 * mm, 22 * mm, 5.6 * mm, 2.8 * mm, stroke=0, fill=1)
        c.setFillColor(WHITE); c.setFont('M-Bold', 7.4); c.drawCentredString(18 * mm, h - 7.7 * mm, f'PHASE {self.n}')
        c.setFillColor(SOFT); c.setFont('M-Med', 8); c.drawString(32 * mm, h - 7.8 * mm, self.when)
        c.setFillColor(WHITE); c.setFont('M-Bold', 17); c.drawString(7 * mm, h - 18 * mm, self.title)
        c.setFillColor(SOFT); c.setFont('M', 8.8); c.drawString(7 * mm, h - 24.5 * mm, self.goal)

class Timeline(Flowable):
    """Five-phase roadmap across 12 months."""
    PH = [('0', 'Ready', 0, 1), ('1', 'Freelancers', 1, 3), ('2', 'Founders', 3, 6), ('3', 'Convert', 5, 9), ('4', 'Scale', 9, 12)]
    def __init__(self): super().__init__(); self.height = 46 * mm
    def wrap(self, aw, ah): self.width = aw; return aw, self.height
    def draw(self):
        c = self.canv; x0 = 22 * mm; span = self.width - x0; mw = span / 12
        c.setFont('M-Med', 7); c.setFillColor(GRAY)
        for m in range(13):
            x = x0 + m * mw
            c.setStrokeColor(RULE); c.setLineWidth(0.5); c.line(x, 0, x, self.height - 7 * mm)
            if m < 12: c.drawCentredString(x + mw / 2, self.height - 5 * mm, f'M{m + 1}')
        shades = [SOFT, BRAND, PRIMARY, DEEP2, DEEP]
        for i, (n, name, a, b) in enumerate(self.PH):
            y = self.height - 14 * mm - i * 7.2 * mm
            c.setFillColor(INK); c.setFont('M-Bold', 8); c.drawString(0, y + 1.6 * mm, f'{n} · {name}')
            c.setFillColor(shades[i]); c.roundRect(x0 + a * mw + 1, y, (b - a) * mw - 2, 5.2 * mm, 2.6 * mm, stroke=0, fill=1)

# ── Page chrome ──────────────────────────────────────────────────────────
def cover(c, doc):
    c.saveState()
    c.setFillColor(DEEP); c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    # soft green orbs
    c.setFillColor(DEEP2); c.circle(PAGE_W - 10 * mm, PAGE_H - 40 * mm, 70 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor('#123F22')); c.circle(PAGE_W - 30 * mm, 70 * mm, 48 * mm, stroke=0, fill=1)
    lw = 58 * mm; c.drawImage(LOGO_W, MX, PAGE_H - 34 * mm, width=lw, height=lw * 343 / 1621, mask='auto')
    c.setFillColor(BRAND); c.roundRect(MX, PAGE_H - 108 * mm, 46 * mm, 7 * mm, 3.5 * mm, stroke=0, fill=1)
    c.setFillColor(WHITE); c.setFont('M-Bold', 8); c.drawCentredString(MX + 23 * mm, PAGE_H - 105.6 * mm, 'GO-TO-MARKET PLAN')
    c.setFont('M-Bold', 38)
    for i, line in enumerate(['Metwork', 'growth plan', '2026–2027']):
        c.setFillColor(WHITE if i < 2 else colors.HexColor('#2ECC71'))
        c.drawString(MX, PAGE_H - 126 * mm - i * 15 * mm, line)
    c.setFillColor(SOFT); c.setFont('M', 11.5)
    c.drawString(MX, PAGE_H - 178 * mm, 'Acquire freelancers and founders in Algeria,')
    c.drawString(MX, PAGE_H - 185 * mm, 'then convert them to Premium. Phase by phase, over 12 months.')
    # stat strip
    stats = [('5', 'phases'), ('12', 'months'), ('600+', 'paying users'), ('1.4 M DA', 'MRR target')]
    bw = (PAGE_W - 2 * MX - 3 * 4 * mm) / 4
    for i, (v, l) in enumerate(stats):
        x = MX + i * (bw + 4 * mm); y = 34 * mm
        c.setFillColor(DEEP2); c.roundRect(x, y, bw, 24 * mm, 4 * mm, stroke=0, fill=1)
        c.setFillColor(WHITE); c.setFont('M-Bold', 16); c.drawString(x + 5 * mm, y + 12 * mm, v)
        c.setFillColor(SOFT); c.setFont('M', 8); c.drawString(x + 5 * mm, y + 6 * mm, l)
    c.setFillColor(SOFT); c.setFont('M', 8)
    c.drawString(MX, 18 * mm, 'metwork.dz  ·  October 2026  ·  Internal strategy document')
    c.restoreState()

def inner(c, doc):
    c.saveState()
    c.setFillColor(BG); c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    lw = 26 * mm; c.drawImage(LOGO, MX, PAGE_H - 15 * mm, width=lw, height=lw * 273 / 1314, mask='auto')
    c.setFillColor(GRAY); c.setFont('M-Med', 7.5); c.drawRightString(PAGE_W - MX, PAGE_H - 12.6 * mm, 'Go-to-market & growth plan')
    c.setStrokeColor(RULE); c.setLineWidth(0.8); c.line(MX, PAGE_H - 18.5 * mm, PAGE_W - MX, PAGE_H - 18.5 * mm)
    # page pill
    c.setFillColor(MINT); c.roundRect(PAGE_W - MX - 12 * mm, 8 * mm, 12 * mm, 6 * mm, 3 * mm, stroke=0, fill=1)
    c.setFillColor(PRIMARY); c.setFont('M-Bold', 7.5); c.drawCentredString(PAGE_W - MX - 6 * mm, 10 * mm, str(doc.page))
    c.setFillColor(GRAY); c.setFont('M', 7); c.drawString(MX, 10 * mm, 'metwork.dz')
    c.restoreState()

doc = BaseDocTemplate(f'{ROOT}/docs/Metwork-Marketing-Plan.pdf', pagesize=A4, leftMargin=MX, rightMargin=MX,
                      topMargin=26 * mm, bottomMargin=20 * mm, title='Metwork — Go-to-market & growth plan', author='Metwork')
doc.addPageTemplates([
    PageTemplate('cover', [Frame(MX, 20 * mm, W, PAGE_H - 46 * mm, id='c')], onPage=cover),
    PageTemplate('inner', [Frame(MX, 20 * mm, W, PAGE_H - 46 * mm, id='i')], onPage=inner),
])

s = [NextPageTemplate('inner'), PageBreak()]

# ── 1 · Summary ─────────────────────────────────────────────────────────
s += [SectionHead('1', 'Executive summary', 'Freelancers first, founders next'),
      P('Win freelancers with tools they use every day. Use their clients and the creation guides to win founders. '
        'Turn both into Premium users by showing, in DZD, what Premium saves them.', 'lead'),
      hero('<font name="M-Bold" size="12">Recommendation</font><br/><br/>'
           'Start with <b>freelancers</b>. They get value on day one (invoices, DZD payment links, the tax center, the copilot), '
           'before any network exists, and every link or invoice they send shows Metwork to a paying client, often an entrepreneur. '
           'Once the directory is full, the <b>Recruter</b> tab and the business-creation guides bring founders in.'),
      Spacer(1, 7 * mm),
      P('The 12-month roadmap', 'h3'), Timeline(), Spacer(1, 3 * mm),
      table([
          ['Phase', 'When', 'Job', 'Exit target'],
          ['0 · Ready', 'Weeks 0–4', 'Deploy, measure the funnel, prepare content and offers', 'Funnel tracked end to end · 20 pieces of content'],
          ['1 · Freelancers', 'Months 1–3', 'Freelancers who invoice and get paid through Metwork', '1,500 sign-ups · 600 complete · 250 active'],
          ['2 · Founders', 'Months 3–6', 'Turn freelancer supply into founder demand', '1,000 founders · 150 hiring orders'],
          ['3 · Convert', 'Months 5–9', 'Make Premium the obvious choice', '7–10 % of active users paying'],
          ['4 · Scale', 'Months 9–12', 'More cities, B2B deals, ads that pay back', '8,000 users · 600+ paying'],
      ], [27 * mm, 22 * mm, 66 * mm, W - 115 * mm]),
      Spacer(1, 3), P('Targets are planning targets to re-set after the first six weeks of real data, not market statistics.', 'small'),
      PageBreak()]

# ── 2 · Positioning ─────────────────────────────────────────────────────
s += [SectionHead('2', 'Positioning', 'One app to run your work'),
      P('Metwork is the business app for Algerian freelancers and founders. You get paid in DZD, invoice legally, stay in order '
        'with the tax office, and find clients, talent or a cofounder, all in one place.', 'lead')]
seg = [
    ('Freelancers & auto-entrepreneurs', '« Facturez, encaissez, déclarez. Sans stress. »',
     'Clients pay late or in cash · invoices on Word · fear of the tax office (IFU, G12, CASNOS) · no steady clients',
     'Payment links (CIB, Edahabia) · legal invoices and quotes · tax calendar and copilot · orders from founders'),
    ('Founders & entrepreneurs', '« Créez, recrutez, avancez. »',
     "Don't know where to start (SARL or personne physique?) · can't find reliable freelancers · building alone",
     'Step-by-step creation guides · hiring tab with 50/50 payments · cofounder matching · copilot'),
    ('Incubators & coworkings', '« Vos membres sur Metwork. »',
     'Need members, full programs and simple payments',
     'Already served by Metwork (spaces, programs, contracts, invoices) → become a distribution channel'),
]
for name, head, pain, answer in seg:
    s += [card([Paragraph(f'<font name="M-Bold" color="#00A550" size="7.6">{name.upper()}</font>', S['p']),
                Paragraph(f'<font name="M-Bold" size="13" color="#0E3B1E">{head}</font>', st('hh', leading=17, spaceAfter=6)),
                Table([[Paragraph('<font name="M-Bold" size="7.5" color="#8A5300">THEIR PAIN</font><br/>' + pain, S['cell']),
                        Paragraph('<font name="M-Bold" size="7.5" color="#1A7F37">METWORK ANSWERS</font><br/>' + answer, S['cell'])]],
                      colWidths=[(W - 24) / 2] * 2,
                      style=TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (0, -1), 10)]))],
               bg=WHITE, border=RULE, pad=12), Spacer(1, 3 * mm)]
s += [note('<b>Brand voice:</b> concrete, local and reassuring. French for the product, Darija for social media, Arabic on every page. '
           'Every message ends with one action: create a profile, send a payment link, ask the copilot.'),
      PageBreak(),
      SectionHead('3', 'Who first', 'Why freelancers come first'),
      table([
          ['Criterion', 'Freelancers', 'Founders'],
          ['Value with no network yet', 'High: invoices, links, tax and copilot work on day one', 'Medium: hiring needs freelancers first'],
          ['Reachability', 'Very online: Facebook groups, Instagram, LinkedIn, TikTok', 'Scattered: incubators, events, guides'],
          ['Built-in virality', 'Every payment link and invoice is seen by a client', 'Cofounder likes, quote requests'],
          ['Premium ROI', 'Easy to prove in DZD (fees and commission)', 'Discounts, priority, unlimited requests'],
          ['Unblocks the other side', 'Yes: they are the supply founders hire', 'Brings orders to freelancers in phase 2'],
      ], [40 * mm, (W - 40 * mm) / 2, (W - 40 * mm) / 2]),
      Spacer(1, 4 * mm),
      hero('<font name="M-Bold" size="11">The Premium maths to show freelancers</font><br/><br/>'
           'On Free, payment links cost <b>3 %</b>. Above about <font name="M-Bold" color="#2ECC71">83,000 DA a month</font> through links, '
           'Premium (<b>2,500 DA</b>) costs less than the fees it removes, and sourced missions drop from <b>10 % to 7 %</b>. '
           'Put this calculator on the pricing page and in the wallet.'),
      PageBreak()]

# ── Phases ──────────────────────────────────────────────────────────────
def phase(n, title, when, goal, body):
    return [PhaseBanner(n, title, when, goal), Spacer(1, 5 * mm)] + body

s += phase('0', 'Ready', 'WEEKS 0–4', 'Nothing gets marketed before the funnel is measured and the first experience is smooth.',
           bullets([
               '<b>Deploy</b> phases A–E and test on real phones: notifications, copilot, freelancer contract, payment link paid end to end.',
               '<b>Track the funnel</b> in PostHog: sign-up → phone verified → profile 100 % → contract signed → first invoice or link → first payment → Premium. One dashboard, every Monday.',
               '<b>Two landing pages</b>: /freelancers (live) and a founders page built on the creation guides, each with one call to action and a 60-second video (Darija voice, French subtitles).',
               '<b>Onboarding messages</b> (email, WhatsApp, push) on days 0, 1, 3, 7 and 14, each pushing the next step: finish your profile for 1 free Premium month, send your first link, ask the copilot.',
               '<b>Referral rules</b>: when a referred freelancer reaches 100 %, both sides get 1 Premium month. Founders get the same when a referral creates a venture.',
               '<b>Content bank</b>: 20 short videos and 20 carousels ready before launch.',
               '<b>WhatsApp channel</b> « Metwork Freelance DZ » for tax reminders and opportunities.',
           ]) + [Spacer(1, 3 * mm), note('<b>Exit criteria:</b> funnel dashboard live · sign-up to 100 % in under 15 minutes on a phone · 20 pieces of content scheduled.'),
                 Spacer(1, 8 * mm)])

s += phase('1', 'Freelancers first', 'MONTHS 1–3', 'Get the first 1,500 freelancers. Make 250 active, sending an invoice or link each month.', [
    card([Paragraph('<font name="M-Bold" color="#00A550" size="7.6">LAUNCH CAMPAIGN</font>', S['p']),
          Paragraph('<font name="M-Bold" size="14" color="#0E3B1E">« Les 500 fondateurs »</font>', st('c1', leading=18, spaceAfter=5)),
          Paragraph('The first 500 freelancers at 100 % get a <b>Founding Member badge</b> for life, <b>2 Premium months</b> instead of 1, '
                    'and priority in the hiring tab in phase 2. A public counter (« 312 / 500 places prises ») creates urgency without spending on discounts.', S['p'])],
         bg=WHITE, border=RULE, pad=12, accent=BRAND),
    PageBreak()])

s += [P('Phase 1 · Channels, in order of priority', 'h3'),
      table([
          ['Channel', 'What to do', 'Cadence'],
          ['Facebook groups (freelance, design, dev, translation, e-commerce DZ)', 'Useful posts, not ads: « Comment se faire payer par CIB sans site », « IFU 0,5 % expliqué », linking to the copilot', '5 / week'],
          ['Instagram + TikTok (Darija)', 'Tax deadlines, a 30-second payment-link demo, freelancer stories, myth-busting (« la carte AE c\'est compliqué ? »)', '4–5 videos / week'],
          ["LinkedIn (founder's account)", 'Build in public: numbers, lessons, features shipped. Where B2B clients and founders look', '3 / week'],
          ['Micro-influencers (5k–50k)', '10 Algerian freelancers and creators: free Premium + a referral code, paid per active referral, never per post', '10 partners'],
          ['Universities & clubs', 'Workshops « Devenir freelancer légalement en 2026 » in Oran, Alger, Constantine and Tizi; clubs as ambassadors', '2 / month'],
          ['Incubators on Metwork', 'Their members first: co-branded sessions, a Metwork corner, QR posters', 'All partners'],
      ], [46 * mm, W - 46 * mm - 26 * mm, 26 * mm]),
      Spacer(1, 4 * mm),
      P('Moments to own: the tax calendar', 'h3')]
s += bullets([
    'Every deadline is a campaign: <b>G12</b> (before 30 June), <b>IFU instalments</b> (September and December), <b>CASNOS</b>, and the yearly ceiling check. Two weeks before each one: « Votre échéance arrive. Le copilote vous explique tout en 2 min. »',
    'Ramadan and the end of the year: « bilan freelance » content built on the tax center\'s yearly figures.',
])
s += [Spacer(1, 4 * mm), P('Targets · end of month 3', 'h3'),
      tiles([('1,500', 'freelancer sign-ups'), ('600', 'profiles at 100 %'), ('250', 'active each month'), ('60–90', 'paying Premium'), ('≥ 25 %', 'from referrals')]),
      PageBreak()]

s += phase('2', 'Founders', 'MONTHS 3–6', 'Bring founders in through three doors, then make the first hiring orders happen.', [])
doors = [
    ('DOOR 1', "The freelancers' clients",
     ['On every payment page and invoice: « Vous aussi, recrutez des freelancers vérifiés sur Metwork », with the freelancer\'s referral code.',
      'Freelancers earn a free Premium month when a client they invited places an order.']),
    ('DOOR 2', '« Créer son entreprise en Algérie »',
     ['Turn the copilot guides (SARL, EURL, personne physique, carte AE) into public SEO articles and a FR/AR checklist; sign-up unlocks the saved tracker.',
      'Weekly videos: « Personne physique ou morale ? », « Registre de commerce en 24 h », « Le NIF en ligne ».',
      'A monthly live « Créer sa boîte » with a platform consultant, which also promotes your consultants.']),
    ('DOOR 3', 'Incubators, programs and events',
     ['A <b>cohort pack</b> for partner incubators: the Founder plan for every startup in a cohort, billed to the incubator.',
      'Startup events and hackathons: demo hiring, guides and copilot together.',
      'Cofounder matching for solo founders: « Trouve ton cofondateur » campaigns.']),
]
for tag, title, items in doors:
    s += [KeepTogether(card([Paragraph(f'<font name="M-Bold" color="#00A550" size="7.6">{tag}</font>', S['p']),
                             Paragraph(f'<font name="M-Bold" size="12" color="#0E3B1E">{title}</font>', st('d', leading=16, spaceAfter=4))] + bullets(items),
                            bg=WHITE, border=RULE, pad=11)), Spacer(1, 3 * mm)]
s += [note('<b>Do things that don\'t scale:</b> for the first 100 orders, a team member matches each quote request with 3 freelancers within 24 h. '
           'Publish the stories: the logo designed, the site delivered, the deposit and balance paid safely.'),
      Spacer(1, 4 * mm), P('Targets · end of month 6', 'h3'),
      tiles([('1,000', 'founder sign-ups'), ('400', 'ventures created'), ('150', 'hiring orders paid'), ('3,500', 'total users'), ('200–250', 'paying')]),
      PageBreak()]

s += phase('3', 'Convert to Premium', 'MONTHS 5–9', 'Conversion should come from moments in the product, not from discounts.', [
    table([
        ['Upgrade moment', 'What the user sees'],
        ['Payment-link fee', 'In the wallet: « Ce mois-ci vous avez payé 3 450 DA de frais. Avec Premium : 0 DA. »'],
        ['Quota reached', '3rd gig, 6th invoice, 16th copilot question, 11th client: a friendly paywall with the exact benefit and a 1-tap upgrade'],
        ['Sourced commission', 'On each order: « Commission 10 % → 7 % avec Premium : vous auriez gardé 1 350 DA. »'],
        ['Tax deadline', 'Pre-filled amounts are Premium: « Votre G12 pré-remplie vous attend. »'],
        ['End of the free months', '7, 3 and 1 day before: what Premium saved them, then the annual offer (−20 %)'],
        ['Founder plan', 'Consultation and space discounts shown at checkout · unlimited quote requests · cofounder chat'],
    ], [42 * mm, W - 42 * mm]),
    Spacer(1, 4 * mm)] + bullets([
        '<b>Annual billing first</b>: push semester and yearly plans (−20 % / −30 %) to cut churn and bring cash in early.',
        '<b>Win-back</b>: on cancel, ask why and show their month in numbers; offer one free month after 30 days of inactivity.',
        '<b>Ambassadors</b>: the top 50 referrers get lifetime Premium, a badge, early access and a WhatsApp group with the team.',
    ]) + [Spacer(1, 3 * mm), tiles([('7–10 %', 'of active users paying'), ('< 6 %', 'monthly churn'), ('≥ 40 %', 'new plans billed by semester or year')]),
          PageBreak()])

s += phase('4', 'Scale', 'MONTHS 9–12', 'More cities, B2B deals, and paid ads only where they pay back.', bullets([
    '<b>Metwork Tour</b>: Constantine, Sétif, Tizi Ouzou, Béjaïa, Annaba, Blida. One university workshop and one meetup per city, with local ambassadors.',
    '<b>Paid ads</b> on the best organic videos only. Keep a campaign while its cost per paying user stays under about 3 months of revenue (CAC under about 7,500 DA for a freelancer).',
    '<b>B2B</b>: bulk licences for incubators and universities; training centres (their graduates become freelancers); co-marketing talks with a bank or payment provider on CIB and Edahabia.',
    '<b>Metwork Night</b> every quarter: founders × freelancers, hiring speed-dating, cofounder matching live.',
    '<b>Diaspora</b>, later: Algerian freelancers abroad, and clients in France and Canada hiring Algerian talent.',
]) + [Spacer(1, 3 * mm), tiles([('8,000', 'total users'), ('2,500', 'monthly active'), ('600+', 'paying'), ('~1.4 M DA', 'monthly recurring revenue')]),
      Spacer(1, 8 * mm),
      hero('<font name="M-Bold" size="11">The business model at month 12</font><br/><br/>'
           'About <b>600 paying users</b> at an average of <b>2,300 DA</b> (Freelancer Premium 2,500 DA · Founder 1,900 DA) is '
           '<font name="M-Bold" color="#2ECC71">~1.4 M DA of monthly recurring revenue</font>, before commissions on payment links and hiring orders.'),
      PageBreak()])

# ── Playbook ────────────────────────────────────────────────────────────
s += [SectionHead('4', 'Playbook', 'Content, budget and scorecard'),
      P('Content themes (every phase)', 'h3'),
      table([
          ['Theme', 'Examples', 'Format'],
          ['Get paid', 'Payment link in 30 s · deposit 50/50 · « fini les clients qui ne paient pas »', 'Reels, demos'],
          ['Stay legal', 'IFU 0,5 % · G12 step by step · CASNOS 24,000 DA · AE ceiling · timbre on cash invoices', 'Carousels, lives'],
          ['Start a business', 'SARL vs EURL vs personne physique · CNRC · NIF · déclaration d\'existence G08', 'SEO articles, checklists'],
          ['Stories', 'Freelancer and founder interviews · first order · first 100,000 DA', 'Video interviews'],
          ['Build in public', 'Numbers, features shipped, roadmap votes', 'LinkedIn, WhatsApp'],
      ], [32 * mm, W - 32 * mm - 34 * mm, 34 * mm]),
      Spacer(1, 5 * mm), P('Lean monthly budget (DZD)', 'h3'),
      P('Organic and partnerships come first. Ads only get money once a video has proven itself organically.', 'small'), Spacer(1, 2 * mm),
      table([
          ['Item', 'Phases 0–1', 'Phases 2–3', 'Phase 4'],
          ['Content (editor, designer, part-time)', '60–90k', '90–120k', '120–150k'],
          ['Micro-influencers (per active referral)', '30–50k', '50–80k', '80–120k'],
          ['Workshops & events', '20–40k', '40–60k', '80–120k'],
          ['Paid ads (Meta / TikTok)', '0–20k', '40–80k', '150–300k'],
          ['Free Premium months', 'No cash, tracked as acquisition cost', '', ''],
      ], [W - 3 * 30 * mm, 30 * mm, 30 * mm, 30 * mm]),
      Spacer(1, 5 * mm), P('The weekly scorecard: Mondays, 30 minutes, one owner per number', 'h3'),
      table([
          ['Stage', 'Metric', 'Healthy level'],
          ['Acquire', 'Sign-ups per week · share from referrals', 'Growing week on week · ≥ 25 %'],
          ['Activate', 'Sign-up → 100 % profile', '≥ 40 % within 7 days'],
          ['Activate', '100 % → first invoice or link', '≥ 50 % within 14 days'],
          ['Engage', 'Monthly active ÷ total', '≥ 30 %'],
          ['Convert', 'Active → paying', '7–10 %'],
          ['Retain', 'Paying churn per month', '< 6 %'],
          ['Marketplace', 'Quote requests → paid orders', '≥ 25 %'],
      ], [26 * mm, W - 26 * mm - 56 * mm, 56 * mm]),
      PageBreak()]

s += [SectionHead('5', 'Execution', 'Your first 90 days'),
      table([
          ['Weeks', 'Actions'],
          ['1–2', 'Deploy and test on phones · PostHog funnel · referral rules live · onboarding messages · record 10 videos'],
          ['3–4', 'Founders landing page from the guides · WhatsApp channel · sign 10 micro-influencers · book 2 workshops · brief partner incubators'],
          ['5–6', 'Launch « Les 500 fondateurs » · daily posts in Facebook groups · first workshop · first ambassador group'],
          ['7–8', 'First 5 freelancer stories · first tax-deadline campaign · fix the 3 biggest funnel drop-offs'],
          ['9–10', 'Open hiring to founders once 300+ freelancers are listed · banner on payment pages · hand-match the first quote requests'],
          ['11–12', 'Upgrade moments live (fee savings, quotas) · first annual-plan push · decide on ads using which videos did best organically'],
          ['13', 'Review against targets: continue, adjust the offer, or double the channel that works'],
      ], [18 * mm, W - 18 * mm]),
      Spacer(1, 6 * mm), P('Risks and answers', 'h3'),
      table([
          ['Risk', 'Answer'],
          ['Freelancers sign up but never get paid through Metwork', 'Onboard around the first payment link, not the profile; celebrate the first payment (push + badge)'],
          ['Founders find too few good freelancers', 'Open founders only at 300+ listed; curate categories; hand-match the first orders'],
          ['Free months that never convert', 'Free months only at 100 %; show savings before they end; push annual billing'],
          ['Trust in payments', 'Signed freelancer contract, 50/50 orders, verified documents and reviews: say it loudly'],
          ['SMS delivery in Algeria is unreliable', 'WhatsApp and push first, email as the backup'],
      ], [62 * mm, W - 62 * mm]),
      Spacer(1, 8 * mm),
      hero('<font name="M-Bold" size="12">In one sentence</font><br/><br/>'
           'Win freelancers with tools they use every day, use their clients and the creation guides to win founders, '
           'and turn both into Premium users by showing, in DZD, what Premium saves them.')]

doc.build(s)
print('ok')
