"""Convert the Elgato guideline HTML pages into clean markdown.

Restores the Do / Don't / Recommended / Not recommended prefixes that Docusaurus
encodes via CSS class names (good_IfLH / bad_j7je inside requirements_*/recommendations_*).
"""
from pathlib import Path
from bs4 import BeautifulSoup
from markdownify import markdownify as md

DOCS = Path(__file__).parent
PAIRS = [
    ("Plugin Guidelines _ Marketplace.html", "elgato-plugin-guidelines.md"),
    ("Product Guidelines _ Marketplace.html", "elgato-product-guidelines.md"),
]


def classes(el):
    return el.get("class", []) or []


def is_class_prefix(el, prefix: str) -> bool:
    return any(c.startswith(prefix) for c in classes(el))


def annotate_lists(soup, article):
    """Walk the article and prepend a marker text node to each <li> in good/bad blocks."""
    for block in article.find_all("div"):
        cs = classes(block)
        if not any(c.startswith("guidelines_") for c in cs):
            continue
        is_rec = any(c.startswith("recommendations_") for c in cs)
        is_req = not is_rec
        for sub in block.find_all("div", recursive=True):
            sub_cs = classes(sub)
            if any(c.startswith("good_") for c in sub_cs):
                marker = "Do: " if is_req else "Recommended: "
            elif any(c.startswith("bad_") for c in sub_cs):
                marker = "Don't: " if is_req else "Not recommended: "
            else:
                continue
            for li in sub.find_all("li", recursive=True):
                first_p = li.find("p")
                target = first_p if first_p else li
                if target.string and target.string.startswith(marker):
                    continue
                marker_strong = soup.new_tag("strong")
                marker_strong.string = marker
                # Insert at the very beginning of the target.
                target.insert(0, marker_strong)


for src_name, dst_name in PAIRS:
    src = DOCS / src_name
    dst = DOCS / dst_name
    soup = BeautifulSoup(src.read_text(encoding="utf-8"), "html.parser")
    article = soup.find("article") or soup.find("main") or soup
    # Drop chrome.
    for sel in ["nav", ".theme-doc-breadcrumbs", ".theme-edit-this-page",
                ".pagination-nav", ".theme-doc-footer", ".tocCollapsible_ETCw",
                ".theme-doc-toc-mobile", "footer"]:
        for el in article.select(sel):
            el.decompose()
    annotate_lists(soup, article)
    body = md(str(article), heading_style="ATX", bullets="-", strip=["script", "style"])
    # Tighten: collapse 3+ blank lines, strip trailing whitespace.
    lines = [ln.rstrip() for ln in body.splitlines()]
    out = []
    blanks = 0
    for ln in lines:
        if not ln.strip():
            blanks += 1
            if blanks <= 2:
                out.append(ln)
        else:
            blanks = 0
            out.append(ln)
    header = (
        f"_Source: `{src.name}` (Elgato Marketplace docs)._  \n"
        f"_Image references resolve relative to `{src.stem}_files/`._\n\n---\n"
    )
    dst.write_text(header + "\n".join(out).strip() + "\n", encoding="utf-8")
    print(f"{src_name} -> {dst_name} ({dst.stat().st_size} bytes)")
