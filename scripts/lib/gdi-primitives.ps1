# Shared GDI+ drawing primitives for gen-icons.ps1 and gen-marketplace.ps1.
# Dot-source after `Add-Type -AssemblyName System.Drawing`.
# The two callers deliberately stay separate painters of the shared design
# (deployed plugin icon vs marketplace listing assets); only these low-level
# primitives are single-sourced so a glyph/geometry fix cannot land in one
# script and silently miss the other.

function New-RoundedRectPath {
    param([single]$x, [single]$y, [single]$w, [single]$h, [single]$radius)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
    $path.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
    $path.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

# Center-paints one string via GraphicsPath.AddString into a StringFormat-centered
# RectangleF anchored on (cx, cy). emSize is in world units (pixels); no SVG baseline math.
# With -AssertGlyph, throws when the font produced no glyph (GDI+ silently emits nothing
# for a missing codepoint). Guard relies on one string per fresh GraphicsPath
# (PointCount is per-call).
function Draw-CenteredText {
    param(
        $g,
        [string]$text,
        [single]$cx,
        [single]$cy,
        [single]$emSize,
        [System.Drawing.Color]$color,
        [System.Drawing.FontStyle]$fontStyle = [System.Drawing.FontStyle]::Bold,
        [switch]$AssertGlyph
    )
    $family = New-Object System.Drawing.FontFamily("Segoe UI")
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $halfH = $emSize
    $halfW = $emSize * 3   # generous width; AddString clips by path, not rect
    $rect  = New-Object System.Drawing.RectangleF(($cx - $halfW), ($cy - $halfH), ($halfW * 2), ($halfH * 2))
    $path  = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddString($text, $family, [int]$fontStyle, $emSize, $rect, $sf)
    if ($AssertGlyph -and $path.PointCount -le 0) {
        throw "Draw-CenteredText: glyph for '$text' rendered empty (PointCount=0) - font 'Segoe UI' missing this codepoint?"
    }
    $brush = New-Object System.Drawing.SolidBrush($color)
    $g.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
    $family.Dispose()
    $sf.Dispose()
}
