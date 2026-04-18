"""
Synthetic Users — Meliá Hotels Pitch Deck
Generates a premium dark-theme slide-deck PDF in Spanish.
"""

from reportlab.lib.pagesizes import landscape
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfgen import canvas
from reportlab.lib.units import inch, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, Circle, Rect, Line, Polygon
import os

# ---------- PAGE / COLOR TOKENS ----------
# 16:9 landscape slide: 13.33in x 7.5in (standard PowerPoint)
PAGE_W, PAGE_H = 13.33 * inch, 7.5 * inch

# Brand palette — dark enterprise theme
C_BG        = HexColor("#0a0a0f")   # primary background
C_SURFACE   = HexColor("#12121a")   # surface 800
C_SURFACE_2 = HexColor("#1a1a25")   # surface 700
C_SURFACE_3 = HexColor("#242430")   # surface 600
C_BORDER    = HexColor("#2a2a38")
C_ACCENT    = HexColor("#6366f1")   # violet primary
C_ACCENT_L  = HexColor("#818cf8")   # violet light
C_ACCENT_D  = HexColor("#4f46e5")   # indigo
C_TEXT      = HexColor("#ffffff")
C_TEXT_2    = HexColor("#e5e5e5")
C_MUTED     = HexColor("#a1a1aa")
C_MUTED_2   = HexColor("#71717a")
C_EMERALD   = HexColor("#10b981")
C_AMBER     = HexColor("#f59e0b")
C_RED       = HexColor("#ef4444")

OUTPUT_PATH = r"C:\Users\win\Desktop\Nueva carpeta (6)\MiroFish-main\Synthetic_Users_Melia_Pitch.pdf"

# ---------- HELPERS ----------

def draw_background(c):
    """Fill page with dark background."""
    c.setFillColor(C_BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

def draw_page_frame(c, page_num, total_pages, section_label=""):
    """Top bar + footer with page numbers and branding."""
    # Top-left: brand mark
    c.setFillColor(C_ACCENT)
    c.circle(0.55 * inch, PAGE_H - 0.5 * inch, 0.08 * inch, fill=1, stroke=0)
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.75 * inch, PAGE_H - 0.53 * inch, "SYNTHETIC USERS")
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(2.25 * inch, PAGE_H - 0.53 * inch, "· Enterprise Launch Validation")

    # Top-right: section label
    if section_label:
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 9)
        c.drawRightString(PAGE_W - 0.55 * inch, PAGE_H - 0.53 * inch, section_label.upper())

    # Bottom border line
    c.setStrokeColor(C_BORDER)
    c.setLineWidth(0.5)
    c.line(0.55 * inch, 0.55 * inch, PAGE_W - 0.55 * inch, 0.55 * inch)

    # Bottom-left: confidential
    c.setFillColor(C_MUTED_2)
    c.setFont("Helvetica", 8)
    c.drawString(0.55 * inch, 0.35 * inch, "Confidencial · Preparado para Meliá Hotels International")

    # Bottom-right: page num
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica-Bold", 9)
    c.drawRightString(PAGE_W - 0.55 * inch, 0.35 * inch, f"{page_num:02d} / {total_pages:02d}")

def rounded_box(c, x, y, w, h, fill_color, stroke_color=None, radius=8, stroke_width=0.5):
    """Draws a rounded rectangle."""
    c.setFillColor(fill_color)
    if stroke_color:
        c.setStrokeColor(stroke_color)
        c.setLineWidth(stroke_width)
        c.roundRect(x, y, w, h, radius, fill=1, stroke=1)
    else:
        c.roundRect(x, y, w, h, radius, fill=1, stroke=0)

def draw_accent_bar(c, x, y, w=0.04 * inch, h=0.4 * inch):
    """Vertical violet accent bar used before section titles."""
    c.setFillColor(C_ACCENT)
    c.rect(x, y, w, h, fill=1, stroke=0)

def draw_section_title(c, title, subtitle=None, y=PAGE_H - 1.2 * inch):
    """Big section title with violet accent bar."""
    x_bar = 0.6 * inch
    draw_accent_bar(c, x_bar, y - 0.05 * inch, h=0.5 * inch)
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(x_bar + 0.22 * inch, y + 0.1 * inch, title)
    if subtitle:
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 11)
        c.drawString(x_bar + 0.22 * inch, y - 0.15 * inch, subtitle)

def draw_subtitle(c, text, y=PAGE_H - 1.85 * inch, max_chars=110, x=0.82 * inch):
    """Page subtitle with wrapping to avoid overlap with panels."""
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 12)
    for j, line in enumerate(wrap_text(text, max_chars)):
        c.drawString(x, y - j * 0.22 * inch, line)

def wrap_text(text, max_chars):
    """Simple word-wrap by char count."""
    words = text.split()
    lines, current = [], ""
    for w in words:
        if len(current) + len(w) + 1 <= max_chars:
            current = (current + " " + w).strip()
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    return lines

# =============================================================
# PAGE 1 — COVER
# =============================================================
def page_cover(c):
    draw_background(c)

    # Decorative gradient glow (simulated with overlapping circles)
    for i, r in enumerate([3.0, 2.4, 1.8, 1.2]):
        alpha = 0.05 + i * 0.02
        c.setFillColor(Color(0.39, 0.4, 0.95, alpha=alpha))
        c.circle(PAGE_W - 2.5 * inch, PAGE_H - 3 * inch, r * inch, fill=1, stroke=0)

    # Small brand row
    c.setFillColor(C_ACCENT)
    c.circle(0.9 * inch, PAGE_H - 0.9 * inch, 0.1 * inch, fill=1, stroke=0)
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(1.15 * inch, PAGE_H - 0.94 * inch, "SYNTHETIC USERS")
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 10)
    c.drawString(3.05 * inch, PAGE_H - 0.94 * inch, "by MiroFish")

    # Eyebrow
    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.9 * inch, PAGE_H - 2.5 * inch, "PROPUESTA CONFIDENCIAL · ABRIL 2026")

    # Title
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 54)
    c.drawString(0.9 * inch, PAGE_H - 3.5 * inch, "Synthetic Users")

    # Subtitle line 1
    c.setFillColor(C_ACCENT)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(0.9 * inch, PAGE_H - 4.2 * inch, "Validación Pre-Launch para Meliá")

    # Tagline
    c.setFillColor(C_TEXT_2)
    c.setFont("Helvetica", 16)
    c.drawString(0.9 * inch, PAGE_H - 4.8 * inch,
                 "Ensayo digital a escala antes de cada relanzamiento web,")
    c.drawString(0.9 * inch, PAGE_H - 5.1 * inch,
                 "campaña de tarifa o rediseño de experiencia MeliáRewards.")

    # Key numbers row at bottom
    nums = [
        ("500", "huéspedes sintéticos"),
        ("72h", "de kickoff a informe"),
        ("8", "arquetipos de huésped"),
        ("12", "dimensiones sensoriales"),
    ]
    box_w = 2.5 * inch
    start_x = 0.9 * inch
    y = 1.1 * inch
    for i, (n, label) in enumerate(nums):
        x = start_x + i * box_w
        c.setFillColor(C_ACCENT)
        c.setFont("Helvetica-Bold", 38)
        c.drawString(x, y + 0.25 * inch, n)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 10)
        c.drawString(x, y, label)

    # Footer tagline
    c.setFillColor(C_MUTED_2)
    c.setFont("Helvetica", 9)
    c.drawString(0.9 * inch, 0.5 * inch, "Confidencial · Preparado para Meliá Hotels International · Abril 2026")

# =============================================================
# PAGE 2 — EL PROBLEMA
# =============================================================
def page_problem(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "01 · El problema")
    draw_section_title(c, "Cada apuesta digital se lanza sin ensayo")

    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 12)
    c.drawString(0.82 * inch, PAGE_H - 1.85 * inch,
                 "Meliá está en plena transformación digital — y cada rediseño web, plan tarifario y campaña llega al aire a ciegas.")

    # Three problem cards
    cards = [
        {
            "icon": "A/B",
            "title": "A/B testing en vivo",
            "pain": "Quemar 30% del tráfico antes de detectar el problema.",
            "color": C_RED,
        },
        {
            "icon": "UX",
            "title": "User research tradicional",
            "pain": "8–12 semanas y €80K–€250K por estudio. 15–40 participantes.",
            "color": C_AMBER,
        },
        {
            "icon": "OTA",
            "title": "Fuga a OTAs",
            "pain": "Cada fricción oculta empuja al huésped a Booking.com.",
            "color": C_ACCENT,
        },
    ]

    card_w = 3.85 * inch
    card_h = 3.5 * inch
    gap = 0.22 * inch
    total_w = len(cards) * card_w + (len(cards) - 1) * gap
    start_x = (PAGE_W - total_w) / 2
    y = 1.5 * inch

    for i, card in enumerate(cards):
        x = start_x + i * (card_w + gap)
        rounded_box(c, x, y, card_w, card_h, C_SURFACE, C_BORDER, radius=14)
        # Accent stripe
        c.setFillColor(card["color"])
        c.rect(x, y + card_h - 0.1 * inch, card_w, 0.1 * inch, fill=1, stroke=0)
        # Icon label
        c.setFillColor(card["color"])
        c.setFont("Helvetica-Bold", 14)
        c.drawString(x + 0.4 * inch, y + card_h - 0.7 * inch, card["icon"])
        # Title
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(x + 0.4 * inch, y + card_h - 1.2 * inch, card["title"])
        # Body
        c.setFillColor(C_TEXT_2)
        c.setFont("Helvetica", 12)
        lines = wrap_text(card["pain"], 35)
        for j, line in enumerate(lines):
            c.drawString(x + 0.4 * inch, y + card_h - 1.7 * inch - j * 0.22 * inch, line)

    # Bottom callout
    callout_y = 0.85 * inch
    c.setFillColor(C_SURFACE_2)
    c.roundRect(0.82 * inch, callout_y, PAGE_W - 1.64 * inch, 0.6 * inch, 6, fill=1, stroke=0)
    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(1.05 * inch, callout_y + 0.2 * inch,
                 "El resultado:  feedback cualitativo post-launch, no evidencia cuantitativa pre-launch. Y para entonces, el daño ya está hecho.")

# =============================================================
# PAGE 3 — LA SOLUCIÓN
# =============================================================
def page_solution(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "02 · La solución")
    draw_section_title(c, "500 huéspedes sintéticos. 72 horas. Evidencia auditable.")

    draw_subtitle(c, "Antes del próximo relanzamiento de melia.com, ejecutamos un ensayo completo con huéspedes sintéticos.", max_chars=65)

    # Left side: 4 pillars
    pillars = [
        ("Navegador real", "Agentes en Chromium con Playwright. Timings, clicks, scroll y formularios indistinguibles de humanos."),
        ("Orquestación LLM", "Claude Sonnet 4 para razonar, decidir y narrar cada paso desde la perspectiva del huésped."),
        ("Evidencia completa", "Screenshot + DOM + razonamiento en primera persona por cada paso de cada agente."),
        ("Impacto cuantificado", "Cada recomendación con rango de impacto en ingresos anuales y esfuerzo de implementación."),
    ]
    x = 0.82 * inch
    y = PAGE_H - 2.4 * inch
    for i, (t, d) in enumerate(pillars):
        py = y - i * 1.0 * inch
        # Numbered circle
        c.setFillColor(C_ACCENT)
        c.circle(x + 0.18 * inch, py - 0.12 * inch, 0.18 * inch, fill=1, stroke=0)
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 12)
        c.drawCentredString(x + 0.18 * inch, py - 0.17 * inch, str(i + 1))
        # Title + desc
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 14)
        c.drawString(x + 0.55 * inch, py - 0.05 * inch, t)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 11)
        for j, line in enumerate(wrap_text(d, 60)):
            c.drawString(x + 0.55 * inch, py - 0.3 * inch - j * 0.2 * inch, line)

    # Right side: visual diagram — pipeline
    panel_x = 7.4 * inch
    panel_y = 1.0 * inch
    panel_w = PAGE_W - panel_x - 0.82 * inch
    panel_h = 5.4 * inch
    rounded_box(c, panel_x, panel_y, panel_w, panel_h, C_SURFACE, C_BORDER, radius=14)

    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(panel_x + 0.3 * inch, panel_y + panel_h - 0.5 * inch, "PIPELINE")
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(panel_x + 1.15 * inch, panel_y + panel_h - 0.5 * inch, "de kickoff a informe en 72h")

    steps = [
        ("Día 0", "Ingesta", "URL + arquetipos + objetivo"),
        ("Día 1", "Calibración", "Reviews reales (TripAdvisor, Booking)"),
        ("Día 1–2", "Simulación", "500 agentes navegando en paralelo"),
        ("Día 2", "Agregación", "Funnel + drop-off + segmentación"),
        ("Día 3", "Informe", "PDF auditable + recomendaciones priorizadas"),
    ]

    step_y_start = panel_y + panel_h - 1.0 * inch
    for i, (day, name, desc) in enumerate(steps):
        sy = step_y_start - i * 0.85 * inch
        # Connector line
        if i < len(steps) - 1:
            c.setStrokeColor(C_ACCENT_D)
            c.setLineWidth(1.2)
            c.line(panel_x + 0.55 * inch, sy - 0.15 * inch,
                   panel_x + 0.55 * inch, sy - 0.65 * inch)
        # Dot
        c.setFillColor(C_ACCENT)
        c.circle(panel_x + 0.55 * inch, sy, 0.1 * inch, fill=1, stroke=0)
        # Day pill
        c.setFillColor(C_SURFACE_3)
        c.roundRect(panel_x + 0.8 * inch, sy - 0.12 * inch, 0.7 * inch, 0.25 * inch, 3, fill=1, stroke=0)
        c.setFillColor(C_ACCENT_L)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(panel_x + 1.15 * inch, sy - 0.05 * inch, day)
        # Name
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(panel_x + 1.6 * inch, sy - 0.02 * inch, name)
        # Desc
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(panel_x + 1.6 * inch, sy - 0.22 * inch, desc)

# =============================================================
# PAGE 4 — POR QUÉ AHORA PARA MELIÁ
# =============================================================
def page_why_melia(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "03 · Por qué ahora para Meliá")
    draw_section_title(c, "El momento que importa para Meliá")

    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 12)
    c.drawString(0.82 * inch, PAGE_H - 1.85 * inch,
                 "Escala global, portfolio heterogéneo y un push agresivo de direct-booking. Cada punto básico cuenta.")

    # Stats row — Meliá scale
    stats = [
        ("400+", "hoteles"),
        ("40", "países"),
        ("7", "marcas"),
        ("~2M", "noches directas / año"),
        ("€165", "ABV medio"),
        ("+€3.3M", "por cada +1pp conversión"),
    ]
    stat_y = PAGE_H - 3.0 * inch
    box_w = (PAGE_W - 1.64 * inch) / len(stats)
    for i, (n, l) in enumerate(stats):
        x = 0.82 * inch + i * box_w
        rounded_box(c, x + 0.08 * inch, stat_y - 0.1 * inch, box_w - 0.16 * inch, 1.1 * inch,
                    C_SURFACE, C_BORDER, radius=10)
        c.setFillColor(C_ACCENT)
        c.setFont("Helvetica-Bold", 22)
        c.drawString(x + 0.3 * inch, stat_y + 0.55 * inch, n)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(x + 0.3 * inch, stat_y + 0.2 * inch, l)

    # Brands portfolio strip (moved up to avoid collision with triggers)
    brands_label_y = PAGE_H - 4.1 * inch
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(0.82 * inch, brands_label_y, "Portfolio multi-marca a validar:")

    brands = [
        ("Gran Meliá", "Luxury", C_ACCENT_L),
        ("Paradisus", "All-Inclusive Premium", C_EMERALD),
        ("ME by Meliá", "Lifestyle", C_ACCENT),
        ("INNSIDE", "Upscale", C_AMBER),
        ("Meliá", "Premium", C_ACCENT_D),
        ("Sol", "Leisure", C_ACCENT_L),
        ("TRYP", "Urban", C_MUTED),
    ]
    bx = 0.82 * inch
    by = brands_label_y - 0.75 * inch
    for brand, tier, color in brands:
        w = 1.65 * inch
        rounded_box(c, bx, by, w, 0.55 * inch, C_SURFACE_2, C_BORDER, radius=6)
        c.setFillColor(color)
        c.rect(bx, by, 0.06 * inch, 0.55 * inch, fill=1, stroke=0)
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(bx + 0.2 * inch, by + 0.32 * inch, brand)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 8)
        c.drawString(bx + 0.2 * inch, by + 0.13 * inch, tier)
        bx += w + 0.08 * inch

    # Bottom: three strategic triggers
    trig_title_y = PAGE_H - 5.15 * inch
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(0.82 * inch, trig_title_y, "Tres disparadores estratégicos en este momento:")

    triggers = [
        ("Push direct-booking", "Reducir dependencia de OTAs exige paridad de experiencia con Booking.com."),
        ("Rediseño MeliáRewards", "Reconocimiento Platinum, auto-aplicación de tarifa miembro, upsell dinámico."),
        ("Gap móvil", "60%+ tráfico es mobile, pero convierte al 42% del desktop. Pérdida latente masiva."),
    ]
    tw = (PAGE_W - 1.64 * inch - 0.4 * inch) / 3
    tx = 0.82 * inch
    ty = 0.85 * inch
    card_h = 1.25 * inch
    for t, d in triggers:
        rounded_box(c, tx, ty, tw, card_h, C_SURFACE, C_BORDER, radius=10)
        c.setFillColor(C_ACCENT)
        c.rect(tx, ty + card_h - 0.05 * inch, tw, 0.05 * inch, fill=1, stroke=0)
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(tx + 0.25 * inch, ty + card_h - 0.4 * inch, t)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 10)
        for j, line in enumerate(wrap_text(d, 42)):
            c.drawString(tx + 0.25 * inch, ty + card_h - 0.65 * inch - j * 0.2 * inch, line)
        tx += tw + 0.2 * inch

# =============================================================
# PAGE 5 — 8 ARQUETIPOS
# =============================================================
def page_archetypes(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "04 · Arquetipos")
    draw_section_title(c, "8 arquetipos de huésped. Cada uno con psicología propia.")

    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 12)
    c.drawString(0.82 * inch, PAGE_H - 1.85 * inch,
                 "Cada arquetipo con rasgos base (paciencia, confianza, sensibilidad al precio) y pain points reales curados desde TripAdvisor, Booking y FlyerTalk.")

    archetypes = [
        ("Business Traveler",   "Corporate policy, speed, reliability",    "Fees ocultos, WiFi lento",               C_ACCENT),
        ("Family Vacationer",   "Conexión de habitaciones, piscina kids",  "Ambigüedad en family rooms",             C_EMERALD),
        ("Luxury Seeker",       "Gran Meliá tier, concierge, spa",         "Positioning diluido por promos",         C_ACCENT_L),
        ("Honeymooner",         "Privacidad, atención, experiencia única", "Sin opciones late checkout visibles",    C_AMBER),
        ("Digital Nomad",       "Wi-Fi premium, coworking, estancia larga","Tarifa long-stay poco clara",            C_ACCENT_D),
        ("Budget Optimizer",    "Precio total all-in, comparativa OTA",    "Resort fees al final → fuga a Booking",  C_RED),
        ("Loyalty Maximizer",   "Platinum recognition, member rate",       "Member rate no se auto-aplica",          C_ACCENT),
        ("Event Attendee",      "Bloqueo grupo, cercanía venue, shuttle",  "Sin código de bloqueo visible",          C_EMERALD),
    ]

    # 4x2 grid
    cols = 4
    rows = 2
    grid_margin = 0.82 * inch
    grid_w = PAGE_W - 2 * grid_margin
    grid_h = PAGE_H - 3.0 * inch
    gap_x = 0.15 * inch
    gap_y = 0.2 * inch
    cell_w = (grid_w - (cols - 1) * gap_x) / cols
    cell_h = (grid_h - (rows - 1) * gap_y) / rows
    start_y = PAGE_H - 2.5 * inch - cell_h

    for i, (name, traits, pain, col) in enumerate(archetypes):
        r = i // cols
        cc = i % cols
        x = grid_margin + cc * (cell_w + gap_x)
        y = start_y - r * (cell_h + gap_y)
        rounded_box(c, x, y, cell_w, cell_h, C_SURFACE, C_BORDER, radius=10)
        # Top color stripe
        c.setFillColor(col)
        c.rect(x, y + cell_h - 0.08 * inch, cell_w, 0.08 * inch, fill=1, stroke=0)
        # Number
        c.setFillColor(col)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x + 0.25 * inch, y + cell_h - 0.4 * inch, f"0{i + 1}")
        # Name
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(x + 0.25 * inch, y + cell_h - 0.7 * inch, name)
        # Traits label
        c.setFillColor(C_MUTED_2)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 0.25 * inch, y + cell_h - 0.95 * inch, "SEÑALES")
        c.setFillColor(C_TEXT_2)
        c.setFont("Helvetica", 9)
        for j, line in enumerate(wrap_text(traits, 30)):
            c.drawString(x + 0.25 * inch, y + cell_h - 1.15 * inch - j * 0.15 * inch, line)
        # Pain label
        c.setFillColor(C_MUTED_2)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 0.25 * inch, y + 0.5 * inch, "PAIN CLAVE")
        c.setFillColor(col)
        c.setFont("Helvetica", 9)
        for j, line in enumerate(wrap_text(pain, 32)):
            c.drawString(x + 0.25 * inch, y + 0.3 * inch - j * 0.15 * inch, line)

# =============================================================
# PAGE 6 — CÓMO FUNCIONA
# =============================================================
def page_how(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "05 · Cómo funciona")
    draw_section_title(c, "Cómo piensa un huésped sintético")

    # Subtitle — single line, kept short to not cross into panels
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 11)
    c.drawString(0.82 * inch, PAGE_H - 1.75 * inch,
                 "Bucle cognitivo con 5 roles LLM + navegador real. No es un script — es un huésped pensando.")

    # Cognitive loop diagram on left
    loop_x = 0.82 * inch
    loop_y = 0.9 * inch
    loop_w = 6.2 * inch
    loop_h = 4.55 * inch
    rounded_box(c, loop_x, loop_y, loop_w, loop_h, C_SURFACE, C_BORDER, radius=14)

    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(loop_x + 0.35 * inch, loop_y + loop_h - 0.5 * inch, "BUCLE COGNITIVO DEL AGENTE")

    roles = [
        ("1", "Percepción",  "Interpreta screenshot + DOM del estado actual"),
        ("2", "Cognición",   "Decide próxima acción según objetivos y arquetipo"),
        ("3", "Afecto",      "Actualiza estado emocional (paciencia, confianza, frustración)"),
        ("4", "Timing",      "Añade pausas estocásticas humanas (0.5–3s por acción)"),
        ("5", "Navegador",   "Ejecuta la acción en Playwright y registra evidencia"),
    ]

    rx = loop_x + 0.35 * inch
    ry_start = loop_y + loop_h - 1.0 * inch
    for i, (num, name, desc) in enumerate(roles):
        ry = ry_start - i * 0.85 * inch
        # Num pill
        c.setFillColor(C_ACCENT)
        c.circle(rx + 0.22 * inch, ry - 0.05 * inch, 0.22 * inch, fill=1, stroke=0)
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 13)
        c.drawCentredString(rx + 0.22 * inch, ry - 0.11 * inch, num)
        # Name
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 14)
        c.drawString(rx + 0.7 * inch, ry + 0.02 * inch, name)
        # Desc
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 11)
        c.drawString(rx + 0.7 * inch, ry - 0.2 * inch, desc)
        # Connector arrow down
        if i < len(roles) - 1:
            c.setStrokeColor(C_ACCENT_D)
            c.setLineWidth(1)
            c.line(rx + 0.22 * inch, ry - 0.3 * inch, rx + 0.22 * inch, ry - 0.55 * inch)

    # Right panel — sensation model
    s_x = 7.3 * inch
    s_y = 0.9 * inch
    s_w = PAGE_W - s_x - 0.82 * inch
    s_h = 4.55 * inch
    rounded_box(c, s_x, s_y, s_w, s_h, C_SURFACE_2, C_BORDER, radius=14)

    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(s_x + 0.3 * inch, s_y + s_h - 0.5 * inch, "MODELO DE 12 DIMENSIONES SENSORIALES")

    dims = [
        "Confort físico",    "Limpieza",       "Calidad servicio",
        "Velocidad",         "Personalización","Valor percibido",
        "Autenticidad",      "Modernidad",     "Usabilidad amenidad",
        "Densidad",          "Gastronomía",    "Seguridad",
    ]

    # 3 cols × 4 rows grid
    cols_d = 3
    rows_d = 4
    grid_start_y = s_y + s_h - 1.0 * inch
    cell_wd = (s_w - 0.6 * inch) / cols_d
    cell_hd = (grid_start_y - s_y - 0.9 * inch) / rows_d
    for i, dim in enumerate(dims):
        r = i // cols_d
        cc = i % cols_d
        dx = s_x + 0.3 * inch + cc * cell_wd
        dy = grid_start_y - (r + 1) * cell_hd
        rounded_box(c, dx, dy, cell_wd - 0.08 * inch, cell_hd - 0.1 * inch, C_SURFACE_3, None, radius=6)
        c.setFillColor(C_ACCENT)
        c.circle(dx + 0.18 * inch, dy + (cell_hd - 0.1 * inch) / 2, 0.05 * inch, fill=1, stroke=0)
        c.setFillColor(C_TEXT_2)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(dx + 0.32 * inch, dy + (cell_hd - 0.1 * inch) / 2 - 0.04 * inch, dim)

    # Small note
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(s_x + 0.3 * inch, s_y + 0.35 * inch, "Cada dimensión se actualiza por etapa")
    c.drawString(s_x + 0.3 * inch, s_y + 0.2 * inch, "y pondera según arquetipo → NPS + stars.")

# =============================================================
# PAGE 7 — HOSPITALITY PACK
# =============================================================
def page_pack(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "06 · Hospitality Pack")
    draw_section_title(c, "Hospitality Pack: conocimiento vertical precargado")

    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 12)
    c.drawString(0.82 * inch, PAGE_H - 1.85 * inch,
                 "No partimos de cero. Cada instalación para Meliá arranca con un pack vertical curado desde datos reales del sector.")

    # 2x3 grid of components
    components = [
        ("40+",  "pain points curados",    "Extraídos de TripAdvisor, Booking.com,\nFlyerTalk y LinkedIn por arquetipo"),
        ("12",   "dimensiones sensoriales","Modelo ponderado por tier de marca\n(Luxury vs Upscale vs Urban)"),
        ("8",    "arquetipos de huésped",  "Cada uno con behavior model y\npatrón de gasto calibrado"),
        ("11",   "plantillas de recomendación", "Cada pain → acción priorizada\ncon rango de impacto en €"),
        ("5",    "plataformas de review",  "TripAdvisor, Booking, Google,\nExpedia, FlyerTalk — tono específico"),
        ("14",   "etapas de estancia",     "Arrival → room → evening → night →\nmorning → checkout → post-stay"),
    ]

    grid_margin = 0.82 * inch
    grid_w = PAGE_W - 2 * grid_margin
    cols = 3
    rows = 2
    gap = 0.18 * inch
    cell_w = (grid_w - (cols - 1) * gap) / cols
    cell_h = 1.55 * inch
    start_y = PAGE_H - 2.4 * inch - cell_h

    for i, (big, label, desc) in enumerate(components):
        r = i // cols
        cc = i % cols
        x = grid_margin + cc * (cell_w + gap)
        y = start_y - r * (cell_h + gap)
        rounded_box(c, x, y, cell_w, cell_h, C_SURFACE, C_BORDER, radius=12)
        # Big number
        c.setFillColor(C_ACCENT)
        c.setFont("Helvetica-Bold", 32)
        c.drawString(x + 0.35 * inch, y + cell_h - 0.75 * inch, big)
        # Label
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(x + 0.35 * inch, y + cell_h - 1.0 * inch, label)
        # Desc
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 9)
        for j, line in enumerate(desc.split("\n")):
            c.drawString(x + 0.35 * inch, y + cell_h - 1.25 * inch - j * 0.16 * inch, line)

    # Bottom pill-row with review platforms (above footer line at y=0.55)
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.82 * inch, 1.35 * inch, "Review Predictor — tono calibrado por plataforma:")

    platforms = [
        ("TripAdvisor", "narrativo, 120–500 palabras"),
        ("Booking.com", "pros/contras, 30–200"),
        ("Google",      "local, 40–250"),
        ("Expedia",     "transactional"),
        ("FlyerTalk",   "program-deep, 400–2000"),
    ]
    total_avail = PAGE_W - 1.64 * inch - 4 * 0.1 * inch
    w = total_avail / 5
    px = 0.82 * inch
    for name, tone in platforms:
        rounded_box(c, px, 0.75 * inch, w, 0.5 * inch, C_SURFACE_2, C_BORDER, radius=8)
        c.setFillColor(C_ACCENT_L)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(px + 0.2 * inch, 1.05 * inch, name)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 8)
        c.drawString(px + 0.2 * inch, 0.88 * inch, tone)
        px += w + 0.1 * inch

# =============================================================
# PAGE 8 — CASOS DE USO MELIÁ
# =============================================================
def page_use_cases(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "07 · Casos de uso")
    draw_section_title(c, "Cinco casos de uso priorizados para Meliá")

    cases = [
        {
            "tag": "01",
            "title": "Validación del booking funnel completo",
            "flow": "melia.com home → búsqueda → rate plan → payment",
            "kpi": "Conversión directa",
            "uplift": "+3–8pp",
            "arch": "8 arquetipos",
        },
        {
            "tag": "02",
            "title": "Experiencia MeliáRewards miembro",
            "flow": "Login Platinum → member rate → upgrade flow",
            "kpi": "Recognition rate",
            "uplift": "+15–30%",
            "arch": "Loyalty Maximizer",
        },
        {
            "tag": "03",
            "title": "Gap móvil vs desktop",
            "flow": "iOS + Android: date-picker, autocompletar, Apple Pay",
            "kpi": "Conv. móvil",
            "uplift": "+15–28%",
            "arch": "Business, Nomad, Family",
        },
        {
            "tag": "04",
            "title": "Claridad de rate plans",
            "flow": "BAR vs Member vs Advance Purchase vs Package",
            "kpi": "Decision confidence",
            "uplift": "−40% paralysis",
            "arch": "Budget, Business",
        },
        {
            "tag": "05",
            "title": "Navegación portfolio multi-marca",
            "flow": "Gran Meliá vs Meliá vs Sol: clarity ladder",
            "kpi": "Brand matching",
            "uplift": "+20% up-tier",
            "arch": "Luxury, Honeymooner",
        },
    ]

    # Column x-anchors (left margin = 0.82", right margin = 0.82")
    # total width ~11.69 inches
    col_x = {
        "tag":   1.0 * inch,
        "title": 1.55 * inch,
        "kpi":   7.6 * inch,
        "uplift": 9.5 * inch,
        "arch":  10.95 * inch,
    }
    table_right = PAGE_W - 0.82 * inch
    table_left = 0.82 * inch
    table_w = table_right - table_left

    start_y = PAGE_H - 2.3 * inch
    row_h = 0.85 * inch
    row_gap = 0.08 * inch

    # Header row
    header_y = start_y + 0.08 * inch
    rounded_box(c, table_left, header_y, table_w, 0.35 * inch, C_SURFACE_2, None, radius=6)
    c.setFillColor(C_MUTED_2)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(col_x["tag"], header_y + 0.11 * inch, "#")
    c.drawString(col_x["title"], header_y + 0.11 * inch, "CASO DE USO · FLUJO CLAVE")
    c.drawString(col_x["kpi"], header_y + 0.11 * inch, "KPI")
    c.drawString(col_x["uplift"], header_y + 0.11 * inch, "UPLIFT")
    c.drawString(col_x["arch"], header_y + 0.11 * inch, "ARQUETIPOS")

    for i, case in enumerate(cases):
        y = start_y - (i + 1) * (row_h + row_gap) + 0.2 * inch
        rounded_box(c, table_left, y, table_w, row_h, C_SURFACE, C_BORDER, radius=8)
        # tag pill
        c.setFillColor(C_ACCENT)
        c.roundRect(col_x["tag"], y + 0.28 * inch, 0.35 * inch, 0.3 * inch, 4, fill=1, stroke=0)
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 11)
        c.drawCentredString(col_x["tag"] + 0.175 * inch, y + 0.37 * inch, case["tag"])
        # Title
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(col_x["title"], y + row_h - 0.3 * inch, case["title"])
        # Flow
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(col_x["title"], y + 0.2 * inch, case["flow"])
        # KPI
        c.setFillColor(C_TEXT_2)
        c.setFont("Helvetica", 10)
        c.drawString(col_x["kpi"], y + row_h / 2, case["kpi"])
        # Uplift
        c.setFillColor(C_EMERALD)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(col_x["uplift"], y + row_h / 2, case["uplift"])
        # Archetypes
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 9)
        for j, line in enumerate(wrap_text(case["arch"], 22)):
            c.drawString(col_x["arch"], y + row_h / 2 + 0.1 * inch - j * 0.17 * inch, line)

# =============================================================
# PAGE 9 — OUTCOME (Example finding)
# =============================================================
def page_outcome(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "08 · Outcome esperado")
    draw_section_title(c, "Qué verás 72 horas después del kickoff")

    draw_subtitle(c, "Ejemplo ilustrativo de un finding real detectado en una simulación piloto sobre un booking funnel hotelero de 5 estrellas.", max_chars=115)

    # Big headline card — the finding
    find_x = 0.82 * inch
    find_y = PAGE_H - 5.0 * inch
    find_w = PAGE_W - 1.64 * inch
    find_h = 2.8 * inch
    rounded_box(c, find_x, find_y, find_w, find_h, C_SURFACE, C_ACCENT, radius=14, stroke_width=1.5)

    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(find_x + 0.4 * inch, find_y + find_h - 0.45 * inch, "FINDING #1 · CRÍTICO · PRIORIDAD P0")

    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(find_x + 0.4 * inch, find_y + find_h - 1.0 * inch,
                 "64% abandonan por resort fees ocultos en step 5")

    body_lines = [
        "Primary driver (7 de 12 arquetipos): la divulgación del resort fee + VAT sólo aparece al 5º paso del booking.",
        "Business Travelers marcan violación de corporate policy. Budget Optimizers cambian a Booking.com, donde",
        "ven el precio all-in upfront. Evidencia: 87 screenshots + 42 decision traces de agentes saliendo del funnel.",
    ]
    c.setFillColor(C_TEXT_2)
    c.setFont("Helvetica", 11)
    for j, line in enumerate(body_lines):
        c.drawString(find_x + 0.4 * inch, find_y + find_h - 1.45 * inch - j * 0.25 * inch, line)

    # Recommendation row inside the finding
    rec_y = find_y + 0.3 * inch
    c.setFillColor(C_SURFACE_2)
    c.roundRect(find_x + 0.4 * inch, rec_y, find_w - 0.8 * inch, 0.45 * inch, 6, fill=1, stroke=0)
    c.setFillColor(C_EMERALD)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(find_x + 0.55 * inch, rec_y + 0.18 * inch, "RECOMENDACIÓN:")
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(find_x + 2.1 * inch, rec_y + 0.18 * inch,
                 "Mover divulgación all-in al step 1 del funnel")
    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(find_x + find_w - 0.5 * inch, rec_y + 0.18 * inch,
                      "Impacto: +€12M – €22M / año · Effort: 2 sprints")

    # Three evidence blocks at bottom
    ev_y = 0.85 * inch
    evidence = [
        ("Screenshots",   "87",  "por cohorte — funnel + drop-off"),
        ("DOM snapshots", "500", "1 por paso, timestamped"),
        ("Decision traces", "42", "razonamiento en primera persona"),
    ]
    ew = (PAGE_W - 1.64 * inch - 0.4 * inch) / 3
    ex = 0.82 * inch
    for name, num, desc in evidence:
        rounded_box(c, ex, ev_y, ew, 1.2 * inch, C_SURFACE, C_BORDER, radius=10)
        c.setFillColor(C_MUTED_2)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(ex + 0.3 * inch, ev_y + 0.9 * inch, name.upper())
        c.setFillColor(C_ACCENT)
        c.setFont("Helvetica-Bold", 30)
        c.drawString(ex + 0.3 * inch, ev_y + 0.45 * inch, num)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 10)
        c.drawString(ex + 0.3 * inch, ev_y + 0.2 * inch, desc)
        ex += ew + 0.2 * inch

# =============================================================
# PAGE 10 — COMPARISON TABLE
# =============================================================
def page_compare(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "09 · Comparación")
    draw_section_title(c, "Synthetic Users vs. las alternativas")

    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 12)
    c.drawString(0.82 * inch, PAGE_H - 1.85 * inch,
                 "Por qué Synthetic Users es la única herramienta pre-launch con evidencia auditable a escala.")

    # Table
    tab_x = 0.82 * inch
    tab_y = 1.2 * inch
    tab_w = PAGE_W - 1.64 * inch
    tab_h = 4.4 * inch

    cols = ["Dimensión",  "UX Research\ntradicional", "A/B Testing\nen producción", "Synthetic Users"]
    col_w = [3.5 * inch, 2.9 * inch, 2.9 * inch, 2.75 * inch]

    # Header row
    header_y = tab_y + tab_h - 0.65 * inch
    c.setFillColor(C_SURFACE_2)
    c.roundRect(tab_x, header_y, tab_w, 0.65 * inch, 8, fill=1, stroke=0)
    cx = tab_x
    for i, col in enumerate(cols):
        c.setFillColor(C_ACCENT_L if i == 3 else C_MUTED)
        c.setFont("Helvetica-Bold", 10)
        for k, line in enumerate(col.split("\n")):
            c.drawString(cx + 0.25 * inch, header_y + 0.38 * inch - k * 0.18 * inch, line)
        cx += col_w[i]

    # Rows
    rows = [
        ["Tiempo al insight",     "8–12 semanas",         "4–8 semanas",           "72 horas"],
        ["Coste por estudio",     "€80K – €250K",         "30% tráfico desperdiciado", "€50K pilot / fijo"],
        ["Tamaño de muestra",     "15–40 participantes",  "Tráfico real (≥50K)",   "500 agentes (escalable)"],
        ["Granularidad segmento", "Post-hoc",             "Post-hoc",              "8 arquetipos × N variantes"],
        ["Evidencia capturada",   "Notas + videos",       "Métricas agregadas",    "Screenshots + DOM + razonamiento"],
        ["Re-run sobre variante", "Nuevo estudio",        "Nueva iteración",       "Mismo cohorte, 1 click"],
        ["Pre-launch posible",    "Parcial (staging)",    "No",                    "Sí — incluso antes de go-live"],
    ]

    row_h = 0.45 * inch
    for i, row in enumerate(rows):
        ry = header_y - (i + 1) * row_h
        # row zebra
        if i % 2 == 0:
            c.setFillColor(C_SURFACE)
            c.rect(tab_x, ry, tab_w, row_h, fill=1, stroke=0)
        # row border
        c.setStrokeColor(C_BORDER)
        c.setLineWidth(0.3)
        c.line(tab_x + 0.2 * inch, ry, tab_x + tab_w - 0.2 * inch, ry)
        cx = tab_x
        for j, cell in enumerate(row):
            if j == 0:
                c.setFillColor(C_TEXT_2)
                c.setFont("Helvetica-Bold", 11)
            elif j == 3:
                c.setFillColor(C_ACCENT_L)
                c.setFont("Helvetica-Bold", 11)
            else:
                c.setFillColor(C_MUTED)
                c.setFont("Helvetica", 11)
            c.drawString(cx + 0.25 * inch, ry + 0.16 * inch, cell)
            cx += col_w[j]

    # Verdict callout
    verdict_y = 0.75 * inch
    rounded_box(c, tab_x, verdict_y, tab_w, 0.4 * inch, C_ACCENT_D, None, radius=6)
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(tab_x + 0.25 * inch, verdict_y + 0.14 * inch,
                 "Es la única manera de validar una decisión de producto a escala poblacional ANTES de exponerla a clientes reales.")

# =============================================================
# PAGE 11 — EVIDENCIA Y SEGURIDAD
# =============================================================
def page_security(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "10 · Seguridad y evidencia")
    draw_section_title(c, "Evidencia auditable. Seguridad enterprise.")

    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 11)
    c.drawString(0.82 * inch, PAGE_H - 1.75 * inch,
                 "Diseñado para el estándar de compliance que Meliá exige a sus proveedores tecnológicos.")

    # Left: Evidence trail
    left_x = 0.82 * inch
    left_y = 0.9 * inch
    left_w = 6.3 * inch
    left_h = 4.7 * inch
    rounded_box(c, left_x, left_y, left_w, left_h, C_SURFACE, C_BORDER, radius=14)
    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left_x + 0.35 * inch, left_y + left_h - 0.5 * inch, "TRAZA DE EVIDENCIA POR AGENTE")

    evidence_items = [
        ("Screenshot",       "PNG por cada paso del funnel"),
        ("DOM snapshot",     "HTML estructurado, reconstruible"),
        ("Decision trace",   "Razonamiento en primera persona del huésped"),
        ("Emotion state",    "Paciencia, confianza, frustración (0–100)"),
        ("Engagement score", "Tiempo en página, scroll depth, interactions"),
        ("Variant tag",      "Link al build de melia.com testeado"),
        ("Timestamp firmado","Hash SHA-256 para auditoría posterior"),
    ]

    for i, (name, desc) in enumerate(evidence_items):
        ey = left_y + left_h - 1.1 * inch - i * 0.56 * inch
        c.setFillColor(C_ACCENT)
        c.circle(left_x + 0.55 * inch, ey + 0.08 * inch, 0.08 * inch, fill=1, stroke=0)
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(left_x + 0.85 * inch, ey + 0.15 * inch, name)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 10)
        c.drawString(left_x + 0.85 * inch, ey - 0.03 * inch, desc)

    # Right: Security posture
    right_x = 7.4 * inch
    right_y = 0.9 * inch
    right_w = PAGE_W - right_x - 0.82 * inch
    right_h = 4.7 * inch
    rounded_box(c, right_x, right_y, right_w, right_h, C_SURFACE_2, C_BORDER, radius=14)
    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(right_x + 0.3 * inch, right_y + right_h - 0.5 * inch, "POSTURA DE SEGURIDAD")

    certs = [
        ("SOC 2 Type II",         "Roadmap — auditoría en curso",       C_AMBER),
        ("GDPR / CCPA",           "Compliance nativo, DPA disponible",  C_EMERALD),
        ("EU Data Residency",     "AWS eu-west-1 (Dublín) por default", C_EMERALD),
        ("Air-gapped mode",       "Ollama on-prem para runs sensibles", C_ACCENT),
        ("SSO / SAML",            "Integrable con Meliá identity",      C_EMERALD),
        ("PII scrubbing",         "No almacenamos datos de huésped real",C_EMERALD),
        ("Audit logs",            "Todo timestamped + firmado",         C_EMERALD),
    ]

    for i, (name, desc, col) in enumerate(certs):
        sy = right_y + right_h - 1.1 * inch - i * 0.55 * inch
        # status dot
        c.setFillColor(col)
        c.circle(right_x + 0.4 * inch, sy + 0.1 * inch, 0.08 * inch, fill=1, stroke=0)
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(right_x + 0.65 * inch, sy + 0.15 * inch, name)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 9)
        c.drawString(right_x + 0.65 * inch, sy, desc)

# =============================================================
# PAGE 12 — PRICING
# =============================================================
def page_pricing(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "11 · Inversión")
    draw_section_title(c, "Tres tiers. Diseñados para escalar con Meliá.",
                        subtitle="El pilot se amortiza con un solo uplift de 3pp en menos de una semana.")

    tiers = [
        {
            "name":  "PILOT",
            "price": "€50K",
            "period":"Factura única",
            "duration": "4 semanas",
            "highlight": False,
            "features": [
                "Hasta 5 simulaciones",
                "Hasta 200 agentes por run",
                "1 readout ejecutivo (half-day)",
                "Evidencia completa + PDF",
                "Soporte Slack compartido",
            ],
        },
        {
            "name":  "YEAR-1 ENTERPRISE",
            "price": "€250K",
            "period":"Facturación trimestral",
            "duration": "12 meses",
            "highlight": True,
            "features": [
                "Simulaciones ilimitadas",
                "Ingesta de personas CRM/CRS",
                "Reportes white-label",
                "SSO vía Meliá identity",
                "CSM dedicado + priority support",
                "API access para CI/CD",
                "Quarterly calibration reviews",
            ],
        },
        {
            "name":  "YEAR-2+ GROWTH",
            "price": "€500K",
            "period":"Facturación trimestral",
            "duration": "12 meses",
            "highlight": False,
            "features": [
                "Todo lo del Year-1 +",
                "Integración OASIS social swarm",
                "Narrative Engine físico",
                "Multi-property benchmarking",
                "Integración CI/CD end-to-end",
                "Roadmap co-diseñado",
            ],
        },
    ]

    tier_w = 3.9 * inch
    tier_h = 4.3 * inch
    gap = 0.2 * inch
    total_w = 3 * tier_w + 2 * gap
    start_x = (PAGE_W - total_w) / 2
    y = 1.55 * inch

    for i, t in enumerate(tiers):
        x = start_x + i * (tier_w + gap)
        bg = C_SURFACE if not t["highlight"] else C_SURFACE_2
        border = C_ACCENT if t["highlight"] else C_BORDER
        lw = 2 if t["highlight"] else 0.5
        rounded_box(c, x, y, tier_w, tier_h, bg, border, radius=14, stroke_width=lw)

        # Recommended badge — drawn ABOVE the card top edge
        if t["highlight"]:
            badge_y = y + tier_h - 0.15 * inch
            c.setFillColor(C_ACCENT)
            c.roundRect(x + tier_w / 2 - 1.1 * inch, badge_y,
                        2.2 * inch, 0.3 * inch, 8, fill=1, stroke=0)
            c.setFillColor(C_TEXT)
            c.setFont("Helvetica-Bold", 10)
            c.drawCentredString(x + tier_w / 2, badge_y + 0.1 * inch, "RECOMENDADO PARA MELIÁ")

        # Tier name
        c.setFillColor(C_ACCENT_L if t["highlight"] else C_MUTED)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 0.35 * inch, y + tier_h - 0.65 * inch, t["name"])

        # Price
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 44)
        c.drawString(x + 0.35 * inch, y + tier_h - 1.4 * inch, t["price"])

        # Period
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 10)
        c.drawString(x + 0.35 * inch, y + tier_h - 1.7 * inch,
                     t["period"] + " · " + t["duration"])

        # Separator
        c.setStrokeColor(C_BORDER)
        c.setLineWidth(0.5)
        c.line(x + 0.35 * inch, y + tier_h - 2.0 * inch,
               x + tier_w - 0.35 * inch, y + tier_h - 2.0 * inch)

        # Features
        for j, f in enumerate(t["features"]):
            fy = y + tier_h - 2.3 * inch - j * 0.3 * inch
            c.setFillColor(C_ACCENT)
            c.circle(x + 0.45 * inch, fy + 0.05 * inch, 0.05 * inch, fill=1, stroke=0)
            c.setFillColor(C_TEXT_2)
            c.setFont("Helvetica", 10)
            c.drawString(x + 0.6 * inch, fy, f)

    # ROI strip
    roi_y = 0.9 * inch
    rounded_box(c, 0.82 * inch, roi_y, PAGE_W - 1.64 * inch, 0.5 * inch, C_ACCENT_D, None, radius=6)
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(1.05 * inch, roi_y + 0.18 * inch,
                 "ROI  ·  +1pp conversión = €3.3M/año   →   el Pilot se amortiza en ~5 días.")

# =============================================================
# PAGE 13 — STACK TÉCNICO
# =============================================================
def page_stack(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "12 · Stack técnico")
    draw_section_title(c, "Construido sobre la infraestructura que Meliá ya entiende")

    draw_subtitle(c, "Todas las capas son estándar enterprise, con roadmap de deployment on-premise si se requiere.")

    layers = [
        {
            "name": "LLM Orchestration",
            "items": [("Claude Sonnet 4", "Primary"), ("Groq Llama 3.3", "Fallback"), ("Ollama", "Air-gapped")],
            "color": C_ACCENT,
        },
        {
            "name": "Browser Fleet",
            "items": [("Playwright", "Chromium real"), ("Docker Swarm", "5–50 workers"), ("Proxy rotation", "geo IP")],
            "color": C_ACCENT_L,
        },
        {
            "name": "Data Layer",
            "items": [("PostgreSQL", "Multi-tenant"), ("Redis + BullMQ", "Queue"), ("S3-compatible", "Evidence")],
            "color": C_EMERALD,
        },
        {
            "name": "Application Layer",
            "items": [("Node.js + Express", "API"), ("Next.js + React", "Dashboard"), ("Tailwind CSS", "UI")],
            "color": C_AMBER,
        },
        {
            "name": "Security & Compliance",
            "items": [("SAML / SSO", "Identity"), ("SHA-256 audit", "Integrity"), ("EU region", "Data residency")],
            "color": C_ACCENT_D,
        },
    ]

    start_y = PAGE_H - 2.85 * inch
    layer_h = 0.75 * inch
    gap = 0.1 * inch

    x = 0.82 * inch
    w = PAGE_W - 1.64 * inch
    # Layer name column width, then 3 pill columns
    name_col_w = 2.9 * inch
    pills_start = x + name_col_w
    pills_total = w - name_col_w - 0.2 * inch  # inner padding
    pill_gap = 0.12 * inch
    pill_w = (pills_total - 2 * pill_gap) / 3

    for i, layer in enumerate(layers):
        ly = start_y - i * (layer_h + gap)
        rounded_box(c, x, ly, w, layer_h, C_SURFACE, C_BORDER, radius=10)
        # Colored stripe on left
        c.setFillColor(layer["color"])
        c.rect(x, ly, 0.08 * inch, layer_h, fill=1, stroke=0)
        # Layer name
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(x + 0.3 * inch, ly + layer_h - 0.3 * inch, layer["name"])
        c.setFillColor(C_MUTED_2)
        c.setFont("Helvetica", 9)
        c.drawString(x + 0.3 * inch, ly + 0.15 * inch, "Componentes principales")

        # Items as pills (fit inside the card)
        for j, (tech, role) in enumerate(layer["items"]):
            px = pills_start + j * (pill_w + pill_gap)
            rounded_box(c, px, ly + 0.15 * inch, pill_w, layer_h - 0.3 * inch,
                        C_SURFACE_2, None, radius=6)
            c.setFillColor(layer["color"])
            c.setFont("Helvetica-Bold", 11)
            c.drawString(px + 0.15 * inch, ly + layer_h - 0.3 * inch, tech)
            c.setFillColor(C_MUTED)
            c.setFont("Helvetica", 9)
            c.drawString(px + 0.15 * inch, ly + 0.25 * inch, role)

    # Bottom note
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica-Oblique", 10)
    c.drawString(0.82 * inch, 0.82 * inch,
                 "Todo el stack es reproducible vía Docker Compose. Onboarding técnico: < 4 horas desde kickoff.")

# =============================================================
# PAGE 14 — PRÓXIMOS PASOS
# =============================================================
def page_next_steps(c, pnum, total):
    draw_background(c)
    draw_page_frame(c, pnum, total, "13 · Próximos pasos")
    draw_section_title(c, "Del primer email al primer finding, en 10 días")

    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 12)
    c.drawString(0.82 * inch, PAGE_H - 1.85 * inch,
                 "Una línea de tiempo corta, con un único owner en cada etapa.")

    steps = [
        ("Día 0",   "Demo ejecutiva",      "45 min en vivo sobre melia.com — 12 agentes reales.",           C_ACCENT),
        ("Día 1",   "Alineación técnica",  "Kickoff con equipo digital Meliá. Firma DPA + NDA.",             C_ACCENT_L),
        ("Día 2",   "Ingesta de objetivos","Propiedades, arquetipos prioritarios, KPIs, variantes.",         C_EMERALD),
        ("Día 3",   "Simulación #1",       "500 agentes sobre booking funnel actual. Screenshots + DOM.",    C_AMBER),
        ("Día 5",   "Readout #1",          "Top 10 findings + recomendaciones priorizadas.",                 C_ACCENT),
        ("Día 10",  "Simulación #2",       "Variante rediseñada. Comparativa A vs B directa.",               C_ACCENT_D),
    ]

    # Horizontal timeline
    tl_y = PAGE_H / 2 - 0.2 * inch
    tl_x_start = 1.2 * inch
    tl_x_end = PAGE_W - 1.2 * inch
    tl_width = tl_x_end - tl_x_start

    # Timeline line
    c.setStrokeColor(C_ACCENT_D)
    c.setLineWidth(2)
    c.line(tl_x_start, tl_y, tl_x_end, tl_y)

    step_spacing = tl_width / (len(steps) - 1)
    for i, (day, name, desc, col) in enumerate(steps):
        sx = tl_x_start + i * step_spacing
        # Circle marker
        c.setFillColor(C_BG)
        c.circle(sx, tl_y, 0.22 * inch, fill=1, stroke=0)
        c.setStrokeColor(col)
        c.setLineWidth(2)
        c.circle(sx, tl_y, 0.22 * inch, fill=0, stroke=1)
        c.setFillColor(col)
        c.circle(sx, tl_y, 0.1 * inch, fill=1, stroke=0)

        # Day label below
        c.setFillColor(col)
        c.setFont("Helvetica-Bold", 11)
        c.drawCentredString(sx, tl_y - 0.5 * inch, day)

        # Alternate content above/below
        is_above = (i % 2 == 0)
        card_w = 2.0 * inch
        card_h = 1.3 * inch
        if is_above:
            cy = tl_y + 0.5 * inch
        else:
            cy = tl_y - card_h - 0.85 * inch
        cx = sx - card_w / 2
        rounded_box(c, cx, cy, card_w, card_h, C_SURFACE, C_BORDER, radius=8)
        # Connector
        c.setStrokeColor(C_BORDER)
        c.setLineWidth(0.5)
        if is_above:
            c.line(sx, tl_y + 0.22 * inch, sx, cy)
        else:
            c.line(sx, tl_y - 0.22 * inch, sx, cy + card_h)
        # Name
        c.setFillColor(C_TEXT)
        c.setFont("Helvetica-Bold", 11)
        c.drawCentredString(sx, cy + card_h - 0.3 * inch, name)
        # Desc
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 9)
        for j, line in enumerate(wrap_text(desc, 25)):
            c.drawCentredString(sx, cy + card_h - 0.6 * inch - j * 0.18 * inch, line)

    # Bottom CTA
    cta_y = 0.9 * inch
    rounded_box(c, 0.82 * inch, cta_y, PAGE_W - 1.64 * inch, 0.55 * inch, C_ACCENT, None, radius=8)
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(PAGE_W / 2, cta_y + 0.2 * inch,
                        "Agendemos la demo en vivo sobre melia.com. 45 minutos. La siguiente diapositiva tiene nuestros datos.")

# =============================================================
# PAGE 15 — CONTACTO / CIERRE
# =============================================================
def page_contact(c):
    draw_background(c)
    # No top frame — cleaner closer

    # Ambient glow
    for i, r in enumerate([3.5, 2.8, 2.1, 1.4]):
        alpha = 0.05 + i * 0.02
        c.setFillColor(Color(0.39, 0.4, 0.95, alpha=alpha))
        c.circle(2.5 * inch, 3 * inch, r * inch, fill=1, stroke=0)

    # Brand top
    c.setFillColor(C_ACCENT)
    c.circle(0.9 * inch, PAGE_H - 0.9 * inch, 0.1 * inch, fill=1, stroke=0)
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(1.15 * inch, PAGE_H - 0.94 * inch, "SYNTHETIC USERS")
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 10)
    c.drawString(3.05 * inch, PAGE_H - 0.94 * inch, "by MiroFish")

    # Centered thank-you
    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(0.9 * inch, PAGE_H - 2.5 * inch, "GRACIAS, MELIÁ")

    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 48)
    c.drawString(0.9 * inch, PAGE_H - 3.5 * inch, "Rehearse the future.")

    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 13)
    c.drawString(0.9 * inch, PAGE_H - 4.1 * inch,
                 "Validemos el próximo relanzamiento de melia.com")
    c.drawString(0.9 * inch, PAGE_H - 4.35 * inch,
                 "antes de exponerlo a un solo huésped real.")

    # Contact block (positioned below the subtitle)
    cx = 0.9 * inch
    cy = 1.2 * inch
    rounded_box(c, cx, cy, 6 * inch, 1.6 * inch, C_SURFACE, C_ACCENT, radius=14, stroke_width=1)
    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(cx + 0.3 * inch, cy + 1.3 * inch, "CONTACTO PRINCIPAL")
    c.setFillColor(C_TEXT)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(cx + 0.3 * inch, cy + 0.85 * inch, "Rafa Ferrer")
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica", 12)
    c.drawString(cx + 0.3 * inch, cy + 0.6 * inch, "Founder · MiroFish")
    c.setFillColor(C_ACCENT_L)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(cx + 0.3 * inch, cy + 0.25 * inch, "rafa@mirofish.ai  ·  +34 ___ ___ ___")

    # Right side — key stats recap
    rx = 7.5 * inch
    ry = 1.8 * inch
    rw = PAGE_W - rx - 0.9 * inch
    rh = 4.5 * inch
    rounded_box(c, rx, ry, rw, rh, C_SURFACE_2, C_BORDER, radius=14)
    c.setFillColor(C_MUTED)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(rx + 0.3 * inch, ry + rh - 0.5 * inch, "RECAP")

    recap = [
        ("€50K",          "Pilot · 4 semanas"),
        ("72h",           "Kickoff → primer informe"),
        ("500",           "Agentes por simulación"),
        ("8 × 12",        "Arquetipos × dimensiones"),
        ("+€12M – €22M",  "Impacto típico de un fix P0"),
        ("5 días",        "Payback del pilot"),
    ]

    for i, (big, label) in enumerate(recap):
        iy = ry + rh - 1.1 * inch - i * 0.58 * inch
        c.setFillColor(C_ACCENT)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(rx + 0.3 * inch, iy, big)
        c.setFillColor(C_MUTED)
        c.setFont("Helvetica", 10)
        c.drawString(rx + 2.2 * inch, iy + 0.05 * inch, label)

    # Bottom
    c.setFillColor(C_MUTED_2)
    c.setFont("Helvetica", 8)
    c.drawString(0.9 * inch, 0.4 * inch,
                 "Confidencial · Preparado para Meliá Hotels International · Abril 2026 · © MiroFish")
    c.drawRightString(PAGE_W - 0.9 * inch, 0.4 * inch, "mirofish.ai")

# =============================================================
# MAIN
# =============================================================
def build_pdf():
    c = canvas.Canvas(OUTPUT_PATH, pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Synthetic Users — Propuesta para Meliá Hotels")
    c.setAuthor("MiroFish")
    c.setSubject("Enterprise Launch Validation — Pitch para Meliá")
    c.setKeywords(["synthetic users", "meliá", "hospitality", "enterprise", "pre-launch validation"])

    pages = [
        page_cover,       # 1
        page_problem,     # 2
        page_solution,    # 3
        page_why_melia,   # 4
        page_archetypes,  # 5
        page_how,         # 6
        page_pack,        # 7
        page_use_cases,   # 8
        page_outcome,     # 9
        page_compare,     # 10
        page_security,    # 11
        page_pricing,     # 12
        page_stack,       # 13
        page_next_steps,  # 14
        page_contact,     # 15
    ]
    total = len(pages)

    for i, fn in enumerate(pages, start=1):
        if fn is page_cover or fn is page_contact:
            fn(c)
        else:
            fn(c, i, total)
        c.showPage()

    c.save()
    print(f"[OK] PDF generado: {OUTPUT_PATH}")
    print(f"[OK] Total páginas: {total}")

if __name__ == "__main__":
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    build_pdf()
