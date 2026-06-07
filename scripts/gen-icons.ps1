param()
# Determinism note (2026-05-10): System.Drawing's PNG encoder writes
# IHDR + sRGB + gAMA + pHYs + IDAT + IEND. The ancillary chunks carry
# fixed values (sRGB rendering intent, gamma 2.2, 96 dpi) — no tIME or
# session-varying metadata. Same-session output is byte-stable (SHA-1
# verified). If output ever drifts across machines or .NET updates,
# evaluate SVG-source + resvg-cli rasterization or drop PNGs from git
# rather than chasing encoder determinism.
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$keys = Join-Path $root "com.nshopik.agentichooks.sdPlugin\images\keys"
$imgs = Join-Path $root "com.nshopik.agentichooks.sdPlugin\images"

New-Item -ItemType Directory -Force -Path $keys | Out-Null

function New-RoundedRectPath {
    param([System.Drawing.Graphics]$g, [int]$w, [int]$h, [int]$radius)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($w - $d, 0, $d, $d, 270, 90)
    $path.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
    $path.AddArc(0, $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

# Center-paints one string via GraphicsPath.AddString into a StringFormat-centered
# RectangleF anchored on (cx, cy). emSize is in world units (pixels); no SVG baseline math.
# With -AssertGlyph, throws when the font produced no glyph (GDI+ silently emits nothing for a
# missing codepoint). Guard relies on one string per fresh GraphicsPath (PointCount is per-call).
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
    $halfW = $emSize * 3
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

function Draw-CheckGlyph {
    param($g, $size, $pen, $white)
    $s = [single]$size
    $points = @(
        (New-Object System.Drawing.PointF(($s * 0.25), ($s * 0.52))),
        (New-Object System.Drawing.PointF(($s * 0.43), ($s * 0.70))),
        (New-Object System.Drawing.PointF(($s * 0.78), ($s * 0.32)))
    )
    $g.DrawLines($pen, $points)
}

function Draw-IdleGlyph {
    param($g, $size, $pen, $white)
    $s = [single]$size
    $r = $s * 0.28
    $cx = $s * 0.5
    $cy = $s * 0.5
    $g.DrawEllipse($pen, ($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
    $g.DrawLine($pen, $cx, $cy, $cx, ($cy - $r * 0.6))
    $g.DrawLine($pen, $cx, $cy, ($cx + $r * 0.5), $cy)
}

function Draw-MoonGlyph {
    param($g, $size, $pen, $white)
    $s = [single]$size

    # Crescent shape: two same-radius circles offset horizontally. The crescent
    # is bounded by the outer circle's LEFT arc and the inner circle's LEFT arc,
    # which meet at the two intersection points (top and bottom).
    $R = $s * 0.30
    $d = $s * 0.20    # distance between the two circle centers
    $cx1 = $s * 0.40  # outer (illuminated) center, slightly left so the moon sits centered
    $cy  = $s * 0.50
    $cx2 = $cx1 + $d  # inner (shadow) center

    # Half-angle β at each circle subtended to the intersection chord.
    # cos(β) = (d/2) / R    so β = acos((d/2)/R)
    $betaDeg = [Math]::Acos(($d / 2.0) / $R) * 180.0 / [Math]::PI

    # Outer LEFT arc: from top intersection (-β) sweeping CCW through 180° to bottom intersection (+β).
    $startOuter = -$betaDeg
    $sweepOuter = -(360.0 - 2 * $betaDeg)

    # Inner LEFT arc: from bottom intersection (180-β) sweeping CW through 180° to top intersection (180+β).
    $startInner = 180.0 - $betaDeg
    $sweepInner = 2 * $betaDeg

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(($cx1 - $R), ($cy - $R), ($R * 2), ($R * 2), $startOuter, $sweepOuter)
    $path.AddArc(($cx2 - $R), ($cy - $R), ($R * 2), ($R * 2), $startInner, $sweepInner)
    $path.CloseFigure()

    $brush = New-Object System.Drawing.SolidBrush($white)
    $g.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
}

function Draw-PermGlyph {
    param($g, $size, $pen, $white)
    $s = [single]$size
    $cx = $s * 0.5
    $g.DrawLine($pen, $cx, ($s * 0.26), $cx, ($s * 0.62))
    $dotR = $s * 0.07
    $brush = New-Object System.Drawing.SolidBrush($white)
    $g.FillEllipse($brush, ($cx - $dotR), ($s * 0.74 - $dotR), ($dotR * 2), ($dotR * 2))
    $brush.Dispose()
}

function Make-KeyIcon {
    param([string]$outPath, [int]$size, [string]$bgHex, [string]$glyphName)
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $bg = [System.Drawing.ColorTranslator]::FromHtml($bgHex)
    $bgBrush = New-Object System.Drawing.SolidBrush($bg)
    $radius = [int]($size * 0.14)
    $rect = New-RoundedRectPath $g $size $size $radius
    $g.FillPath($bgBrush, $rect)

    $white = [System.Drawing.Color]::White
    $strokeWidth = [single]($size * 0.083)
    $pen = New-Object System.Drawing.Pen($white, $strokeWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    switch ($glyphName) {
        "check" { Draw-CheckGlyph $g $size $pen $white }
        "idle"  { Draw-IdleGlyph  $g $size $pen $white }
        "perm"  { Draw-PermGlyph  $g $size $pen $white }
        "moon"  { Draw-MoonGlyph  $g $size $pen $white }
    }

    $pen.Dispose()
    $bgBrush.Dispose()
    $g.Dispose()

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$events = @(
    @{ name = "stop";           glyph = "check"; idle = "#000000"; alert = "#16a34a" },
    @{ name = "permission";     glyph = "perm";  idle = "#000000"; alert = "#dc2626" },
    @{ name = "task-completed"; glyph = "idle";  idle = "#000000"; alert = "#3b82f6" }
)

foreach ($e in $events) {
    foreach ($size in @(72, 144)) {
        $suffix = if ($size -eq 144) { "@2x" } else { "" }
        Make-KeyIcon -outPath (Join-Path $keys "$($e.name)-idle$suffix.png")  -size $size -bgHex $e.idle  -glyphName $e.glyph
        if ($null -ne $e.alert) {
            Make-KeyIcon -outPath (Join-Path $keys "$($e.name)-alert$suffix.png") -size $size -bgHex $e.alert -glyphName $e.glyph
        }
    }
}

# Plugin icon (256 + 512): black key face + coral eight-point star (U+2734) + grey "1:24" caption.
# Kept IN SYNC with gen-marketplace.ps1's Make-AppIcon (the marketplace listing asset) - same design,
# different size. Geometry in a 144-unit reference space scaled by s = size/144 so all sizes match.
function Make-PluginIcon {
    param([string]$outPath, [int]$size)
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = $size / 144.0

    # Black rounded face (radius 26*s ~ 0.18 squircle)
    $radius = [int](26 * $s)
    $rect = New-RoundedRectPath $g $size $size $radius
    $blackBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
    $g.FillPath($blackBrush, $rect)
    $blackBrush.Dispose()
    $rect.Dispose()

    # Coral eight-point star, centered-upper
    $coral = [System.Drawing.Color]::FromArgb(255, 218, 119, 86)   # #da7756
    Draw-CenteredText -g $g -text ([string][char]0x2734) `
        -cx ([single](72 * $s)) -cy ([single](58 * $s)) -emSize ([single](88 * $s)) `
        -color $coral -AssertGlyph

    # Grey "1:24" caption
    $grey = [System.Drawing.Color]::FromArgb(255, 207, 207, 207)   # #cfcfcf
    Draw-CenteredText -g $g -text "1:24" `
        -cx ([single](72 * $s)) -cy ([single](120 * $s)) -emSize ([single](28 * $s)) `
        -color $grey

    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

Make-PluginIcon -outPath (Join-Path $imgs "plugin-icon.png")    -size 256
Make-PluginIcon -outPath (Join-Path $imgs "plugin-icon@2x.png") -size 512

Write-Host "Generated all icons:"
Get-ChildItem (Join-Path $root "com.nshopik.agentichooks.sdPlugin") -Recurse -Include "*.png", "*.svg" | ForEach-Object { Write-Host "  $($_.FullName.Replace($root.Path, '.'))" }
