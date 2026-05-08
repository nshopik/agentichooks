"""
Generate Stream Deck plugin assets:
  1. Update idle-state key icons: replace navy background with pure black,
     preserving white glyph and rounded shape via alpha decomposition.
  2. Regenerate the marketplace preview image: composite the 4 alert icons
     in a horizontal row onto a backup of the original preview.

Idempotent: always reads from `previews/main-base.png` (backup created during
Task 1), so re-running produces the same result regardless of prior runs.

Run from project root:
  python scripts/generate-icons.py
"""
from pathlib import Path
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PLUGIN_DIR = PROJECT_ROOT / "com.nshopik.claudenotify.sdPlugin"
KEYS_DIR = PLUGIN_DIR / "images" / "keys"
PREVIEWS_DIR = PLUGIN_DIR / "previews"

EVENT_TYPES = ["stop", "idle", "permission", "task-completed"]

OLD_BG = (26, 35, 50)

ICON_SIZE_PX = 96
ICON_GAP_PX = 32
ICON_ROW_Y_FRAC = 0.65


def update_idle_icon_background(path: Path) -> None:
    """Replace navy background with pure black, preserving glyph anti-aliasing.

    Each opaque pixel is modeled as
        original = glyph_alpha * white + (1 - glyph_alpha) * navy
    Solve for glyph_alpha per channel, average, recompose on pure black:
        new = glyph_alpha * white + (1 - glyph_alpha) * black = glyph_alpha * 255
    Transparent pixels are left untouched (preserves rounded-corner mask).
    """
    img = Image.open(path).convert("RGBA")
    pixels = img.load()
    width, height = img.size

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            ga_r = (r - OLD_BG[0]) / (255 - OLD_BG[0])
            ga_g = (g - OLD_BG[1]) / (255 - OLD_BG[1])
            ga_b = (b - OLD_BG[2]) / (255 - OLD_BG[2])
            ga = (ga_r + ga_g + ga_b) / 3.0
            ga = max(0.0, min(1.0, ga))
            v = int(round(ga * 255))
            pixels[x, y] = (v, v, v, a)

    img.save(path)


def update_all_idle_icons() -> None:
    for evt in EVENT_TYPES:
        for suffix in ("", "@2x"):
            path = KEYS_DIR / f"{evt}-idle{suffix}.png"
            if not path.exists():
                raise FileNotFoundError(f"Expected icon not found: {path}")
            update_idle_icon_background(path)
            print(f"[icon ] {path.name}")


def generate_preview() -> None:
    """Compose preview: existing text-only base + horizontal row of 4 alert icons."""
    base_path = PREVIEWS_DIR / "main-base.png"
    out_path = PREVIEWS_DIR / "main.png"

    if not base_path.exists():
        raise FileNotFoundError(
            f"Backup preview not found at {base_path}. "
            f"Create it from the current main.png first."
        )

    base = Image.open(base_path).convert("RGBA")
    width, height = base.size

    n = len(EVENT_TYPES)
    row_w = n * ICON_SIZE_PX + (n - 1) * ICON_GAP_PX
    start_x = (width - row_w) // 2
    row_y = int(height * ICON_ROW_Y_FRAC)

    for i, evt in enumerate(EVENT_TYPES):
        icon_path = KEYS_DIR / f"{evt}-alert@2x.png"
        if not icon_path.exists():
            raise FileNotFoundError(f"Expected alert icon not found: {icon_path}")
        icon = Image.open(icon_path).convert("RGBA")
        icon = icon.resize((ICON_SIZE_PX, ICON_SIZE_PX), Image.LANCZOS)
        x = start_x + i * (ICON_SIZE_PX + ICON_GAP_PX)
        base.alpha_composite(icon, (x, row_y))
        print(f"[preview] placed {icon_path.name} at ({x}, {row_y})")

    base.save(out_path)
    print(f"[preview] wrote {out_path}")


if __name__ == "__main__":
    print("=== Updating idle icons (navy -> black) ===")
    update_all_idle_icons()
    print()
    print("=== Regenerating preview image ===")
    generate_preview()
    print()
    print("Done.")
