param()
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$out  = Join-Path $root "marketplace"
$drafts = Join-Path $out "drafts"
$keys = Join-Path $root "com.nshopik.agentichooks.sdPlugin\images\keys"
New-Item -ItemType Directory -Force -Path $out | Out-Null
New-Item -ItemType Directory -Force -Path $drafts | Out-Null

# ---- shared primitives ----

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

function New-GradientBrush {
    param([single]$x, [single]$y, [single]$w, [single]$h, [string]$fromHex, [string]$toHex, [single]$angleDeg = 135)
    $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $h)
    $c1 = [System.Drawing.ColorTranslator]::FromHtml($fromHex)
    $c2 = [System.Drawing.ColorTranslator]::FromHtml($toHex)
    return New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, $angleDeg)
}

function Draw-Sparkle {
    param($g, [single]$cx, [single]$cy, [single]$size, [System.Drawing.Color]$color)
    # 4-point sparkle: tips at N/E/S/W, concave waist between points (NE/SE/SW/NW).
    $r1 = $size * 0.50    # tip radius
    $r2 = $size * 0.14    # concave waist radius
    $pi4 = [Math]::PI / 4
    $points = @()
    for ($i = 0; $i -lt 8; $i++) {
        $angle = $i * $pi4 - [Math]::PI / 2
        $r = if ($i % 2 -eq 0) { $r1 } else { $r2 }
        $x = $cx + $r * [Math]::Cos($angle)
        $y = $cy + $r * [Math]::Sin($angle)
        $points += New-Object System.Drawing.PointF($x, $y)
    }
    $brush = New-Object System.Drawing.SolidBrush($color)
    $g.FillPolygon($brush, [System.Drawing.PointF[]]$points)
    $brush.Dispose()
}

function Draw-Clock {
    param($g, [single]$cx, [single]$cy, [single]$diameter, [single]$strokeWidth, [System.Drawing.Color]$color)
    $r = $diameter / 2
    $pen = New-Object System.Drawing.Pen($color, $strokeWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawEllipse($pen, ($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
    $g.DrawLine($pen, $cx, $cy, $cx, ($cy - $r * 0.6))
    $g.DrawLine($pen, $cx, $cy, ($cx + $r * 0.5), $cy)
    $pen.Dispose()
}

function Draw-Bell {
    param($g, [single]$cx, [single]$cy, [single]$size, [System.Drawing.Color]$color)
    $brush = New-Object System.Drawing.SolidBrush($color)
    $top = $cy - $size * 0.38
    $bottom = $cy + $size * 0.16
    $halfTopW = $size * 0.20
    $halfBotW = $size * 0.44
    $points = @(
        (New-Object System.Drawing.PointF(($cx - $halfTopW), $top)),
        (New-Object System.Drawing.PointF(($cx + $halfTopW), $top)),
        (New-Object System.Drawing.PointF(($cx + $halfBotW), $bottom)),
        (New-Object System.Drawing.PointF(($cx - $halfBotW), $bottom))
    )
    $g.FillPolygon($brush, [System.Drawing.PointF[]]$points)
    $capR = $halfTopW
    $g.FillEllipse($brush, ($cx - $capR), ($top - $capR), ($capR * 2), ($capR * 2))
    $baseW = $size * 1.00
    $baseH = $size * 0.09
    $g.FillRectangle($brush, ($cx - $baseW / 2), $bottom, $baseW, $baseH)
    $clapperR = $size * 0.10
    $g.FillEllipse($brush, ($cx - $clapperR), ($bottom + $baseH + $clapperR * 0.4), ($clapperR * 2), ($clapperR * 2))
    $brush.Dispose()
}

function New-Canvas {
    param([int]$w, [int]$h)
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    return @{ bmp = $bmp; g = $g }
}

# Draw all-caps multi-line text. Returns the total height drawn.
function Draw-Tagline {
    param($g, [string[]]$lines, [single]$x, [single]$y, [single]$maxWidth, [single]$lineHeight, [single]$fontSize, [System.Drawing.Color]$color)
    $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold)
    $brush = New-Object System.Drawing.SolidBrush($color)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Near
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Near
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $rect = New-Object System.Drawing.RectangleF($x, ($y + $i * $lineHeight), $maxWidth, $lineHeight)
        $g.DrawString($lines[$i], $font, $brush, $rect, $sf)
    }
    $font.Dispose()
    $brush.Dispose()
}

# Center-paints a single string via GraphicsPath.AddString into a StringFormat-centered
# RectangleF anchored on (cx, cy). emSize is in world units (pixels); GDI+ AddString
# uses em-size directly, so SVG font-size values map to this parameter as an approximation,
# fine-tuned visually. No SVG baseline math (y = center + fontSize*0.35) — GDI+ centers
# automatically via StringFormat.
function Draw-CenteredText {
    param(
        $g,
        [string]$text,
        [single]$cx,
        [single]$cy,
        [single]$emSize,
        [System.Drawing.Color]$color,
        [System.Drawing.FontStyle]$fontStyle = [System.Drawing.FontStyle]::Bold
    )
    $family = New-Object System.Drawing.FontFamily("Segoe UI")
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    # Bounding rect: 2×emSize tall so the StringFormat center is at (cx, cy).
    $halfH = $emSize
    $halfW = $emSize * 3   # generous width; AddString clips by path, not rect
    $rect  = New-Object System.Drawing.RectangleF(($cx - $halfW), ($cy - $halfH), ($halfW * 2), ($halfH * 2))
    $path  = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddString($text, $family, [int]$fontStyle, $emSize, $rect, $sf)
    $brush = New-Object System.Drawing.SolidBrush($color)
    $g.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
    $family.Dispose()
    $sf.Dispose()
}

# Black rounded-rect key face. radius = 20*s, matching runtime SVG rx="20" (144-unit space).
function Draw-KeyFace {
    param($g, [single]$x, [single]$y, [single]$size)
    $s      = $size / 144.0
    $radius = [single](20 * $s)
    $path   = New-RoundedRectPath -x $x -y $y -w $size -h $size -radius $radius
    $brush  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
    $g.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
}

# Thinking key face: black key + coral sparkle (corner-weighted, top-left) + gray timer.
# Geometry scaled from 144-unit SVG space: sparkle center=(x+22s, y+22s), size=26s;
# timer em=44s centered on key center. Display value: "1:24" (user-confirmed 2026-06-07).
# Uses Draw-Sparkle (polygon, not font glyph — avoids silent AddString miss for U+273B).
function Draw-KeyThinking {
    param($g, [single]$x, [single]$y, [single]$size)
    $s = [single]($size / 144.0)

    # Key face (black rounded rect)
    Draw-KeyFace -g $g -x $x -y $y -size $size

    # Coral sparkle — top-left corner-weighted (runtime: cx=22, cy≈22 in 144px space)
    $coral = [System.Drawing.Color]::FromArgb(255, 218, 119, 86)   # #da7756
    Draw-Sparkle -g $g `
        -cx ([single]($x + 22 * $s)) `
        -cy ([single]($y + 22 * $s)) `
        -size ([single](26 * $s)) `
        -color $coral

    # Gray "1:24" timer — centered on key center
    $gray  = [System.Drawing.Color]::FromArgb(255, 154, 154, 154)  # #9a9a9a
    $emSz  = [single](44 * $s)
    Draw-CenteredText -g $g -text "1:24" `
        -cx ([single]($x + $size / 2)) `
        -cy ([single]($y + $size / 2)) `
        -emSize $emSz `
        -color $gray `
        -fontStyle ([System.Drawing.FontStyle]::Bold)
}

# Counting key face: black key + yellow task count (centered) + coral pill with agent count.
# Geometry scaled from 144-unit SVG space:
#   count "5" em=96s centered on key center (1-digit tier, largest font);
#   pill circle: center=(x+118s, y+26s), r=22s (hero-enlarged from runtime r=19 for
#     legibility at 50% zoom — runtime renderer is NOT changed);
#   pill numeral "3" em=26s centered on pill center.
# Display values: 5 tasks, 3 agents (user-confirmed 2026-06-07).
function Draw-KeyCounting {
    param($g, [single]$x, [single]$y, [single]$size)
    $s = [single]($size / 144.0)

    # Key face (black rounded rect)
    Draw-KeyFace -g $g -x $x -y $y -size $size

    # Yellow task count "5" — centered on key center
    $yellow = [System.Drawing.Color]::FromArgb(255, 253, 224, 71)  # #fde047
    $emSzCount = [single](96 * $s)
    Draw-CenteredText -g $g -text "5" `
        -cx ([single]($x + $size / 2)) `
        -cy ([single]($y + $size / 2)) `
        -emSize $emSzCount `
        -color $yellow `
        -fontStyle ([System.Drawing.FontStyle]::Bold)

    # Coral pill circle — top-right corner (runtime cx=118, cy=26; hero r=22 for legibility)
    $coral  = [System.Drawing.Color]::FromArgb(255, 218, 119, 86)  # #da7756
    $pillCx = [single]($x + 118 * $s)
    $pillCy = [single]($y + 26  * $s)
    $pillR  = [single](22 * $s)                                     # hero-only: r=22 vs runtime r=19
    $pillBrush = New-Object System.Drawing.SolidBrush($coral)
    $g.FillEllipse($pillBrush, ($pillCx - $pillR), ($pillCy - $pillR), ($pillR * 2), ($pillR * 2))
    $pillBrush.Dispose()

    # Black pill numeral "3" — centered on pill center
    $black    = [System.Drawing.Color]::Black
    $emSzPill = [single](26 * $s)
    Draw-CenteredText -g $g -text "3" `
        -cx $pillCx `
        -cy $pillCy `
        -emSize $emSzPill `
        -color $black `
        -fontStyle ([System.Drawing.FontStyle]::Bold)
}

# ---- 288×288 app icon variants ----

function New-AppIconCanvas {
    param([int]$size, [string]$fromHex, [string]$toHex)
    $canvas = New-Canvas -w $size -h $size
    $bg = New-GradientBrush -x 0 -y 0 -w $size -h $size -fromHex $fromHex -toHex $toHex -angleDeg 135
    $radius = [single]($size * 0.16)
    $rect = New-RoundedRectPath -x 0 -y 0 -w $size -h $size -radius $radius
    $canvas.g.FillPath($bg, $rect)
    $bg.Dispose()
    $rect.Dispose()
    return $canvas
}

function Save-IconCanvas {
    param([hashtable]$canvas, [string]$outPath)
    $canvas.g.Dispose()
    $canvas.bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.bmp.Dispose()
}

# Variant — AH typography (refined: brand-consistent navy → blue gradient)
function Make-AppIcon-AH {
    param([string]$outPath, [int]$size = 288)
    $canvas = New-AppIconCanvas -size $size -fromHex "#0f172a" -toHex "#3b82f6"
    $g = $canvas.g

    $textPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $family = New-Object System.Drawing.FontFamily("Segoe UI")
    $emSize = [single]($size * 0.50)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, [single]$size, [single]$size)
    $textPath.AddString("AH", $family, [int][System.Drawing.FontStyle]::Bold, $emSize, $rect, $sf)

    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillPath($brush, $textPath)
    $brush.Dispose()
    $textPath.Dispose()
    $family.Dispose()

    Save-IconCanvas -canvas $canvas -outPath $outPath
}

# Variant — Bell + sparkle (keeps bell, adds AI signifier)
function Make-AppIcon-BellSparkle {
    param([string]$outPath, [int]$size = 288)
    $canvas = New-AppIconCanvas -size $size -fromHex "#0f172a" -toHex "#3b82f6"
    $g = $canvas.g

    # Bell slightly off-center to make room for sparkle in upper-right
    Draw-Bell -g $g -cx ([single]($size * 0.46)) -cy ([single]($size * 0.52)) -size ([single]($size * 0.50)) -color ([System.Drawing.Color]::White)

    # Sparkle in upper-right corner
    Draw-Sparkle -g $g -cx ([single]($size * 0.78)) -cy ([single]($size * 0.24)) -size ([single]($size * 0.22)) -color ([System.Drawing.Color]::White)

    Save-IconCanvas -canvas $canvas -outPath $outPath
}

# Variant — Clock + sparkle (the "actually great" reference)
function Make-AppIcon-ClockSparkle {
    param([string]$outPath, [int]$size = 288)
    $canvas = New-AppIconCanvas -size $size -fromHex "#0f172a" -toHex "#3b82f6"
    $g = $canvas.g

    # Clock centered
    Draw-Clock -g $g -cx ([single]($size * 0.5)) -cy ([single]($size * 0.5)) -diameter ([single]($size * 0.55)) -strokeWidth ([single]($size * 0.07)) -color ([System.Drawing.Color]::White)

    # Sparkle pushed further into upper-right corner to clear the centered clock
    Draw-Sparkle -g $g -cx ([single]($size * 0.83)) -cy ([single]($size * 0.20)) -size ([single]($size * 0.20)) -color ([System.Drawing.Color]::White)

    Save-IconCanvas -canvas $canvas -outPath $outPath
}

# Production app icon — clock + sparkle.
function Make-AppIcon {
    param([string]$outPath, [int]$size = 288)
    Make-AppIcon-ClockSparkle -outPath $outPath -size $size
}


# ---- 1920×960 marketplace thumbnail B2 — live-deck panel ----
# Production thumbnail. Replaces Make-ThumbnailPanel (draft) and Make-Thumbnail (v1).
#
# Panel geometry (arithmetic for maintainers):
#   keySize=240, keyGap=36, gridW=3*240+2*36=792
#   labelSlot=120 (right-aligned label area left of grid, slot >= 120 per spec)
#   paddingLeft=60 (panel left edge to label slot start)
#   paddingRight=80 (grid right edge to panel right edge)
#   panelW = paddingLeft + labelSlot + gridW + paddingRight = 60+120+792+80 = 1052
#   panelX=80, panelY=130, panelH=700
#   panelMidY = panelY + panelH/2 = 130 + 350 = 480
#   gridX = panelX + paddingLeft + labelSlot = 80+60+120 = 260
#   rowGap=36; topRowY = panelY + (panelH - (2*240+rowGap))/2 = 222
#   botRowY = topRowY + 240 + rowGap = 498
#   textY = panelMidY - 150 = 330  (top of 3-line * 100px = 300px headline block)
#   textX = panelX + panelW + 80 = 1212
#
# Bell centroids cx=1700 and cx=1820 are both > panelX+panelW (1132) — right-half only.
# Guard: do not move bells left of x=1132 without verifying they clear the panel.

function Make-ThumbnailPanel {
    param([string]$outPath, [int]$w = 1920, [int]$h = 960)
    $canvas = New-Canvas -w $w -h $h
    $g      = $canvas.g
    $bmp    = $canvas.bmp

    # --- Background: 45-degree gradient, navy to blue ---
    $bg = New-GradientBrush -x 0 -y 0 -w $w -h $h -fromHex "#0f172a" -toHex "#1e3a8a" -angleDeg 45
    $g.FillRectangle($bg, 0, 0, $w, $h)
    $bg.Dispose()

    # --- Decorative bells — RIGHT HALF ONLY (cx > panelX+panelW=1132). ---
    # Guard: bell cx values (1700, 1820) must stay > 1132. Do not reposition left.
    $deco = [System.Drawing.Color]::FromArgb(30, 255, 255, 255)
    Draw-Bell -g $g -cx 1700 -cy 800 -size 80 -color $deco
    Draw-Bell -g $g -cx 1820 -cy 200 -size 40 -color $deco

    # --- Panel geometry ---
    [single]$panelX  = 80
    [single]$panelY  = 130
    [single]$panelW  = 1052   # paddingLeft(60)+labelSlot(120)+gridW(792)+paddingRight(80)
    [single]$panelH  = 700
    [int]$panelRadius = 24

    # Panel drop shadow (offset 8/18, alpha 120)
    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 0, 0, 0))
    $shadowPath  = New-RoundedRectPath -x ($panelX + 8) -y ($panelY + 18) -w $panelW -h $panelH -radius $panelRadius
    $g.FillPath($shadowBrush, $shadowPath)
    $shadowBrush.Dispose()
    $shadowPath.Dispose()

    # Panel surface — solid graphite fill (B2: no gradient, separates cleanly from bg at 50% zoom)
    $panelColor = [System.Drawing.ColorTranslator]::FromHtml("#13161c")
    $panelBrush = New-Object System.Drawing.SolidBrush($panelColor)
    $panelPath  = New-RoundedRectPath -x $panelX -y $panelY -w $panelW -h $panelH -radius $panelRadius
    $g.FillPath($panelBrush, $panelPath)
    $panelBrush.Dispose()

    # 1px hairline border ARGB(23,255,255,255) — subtle panel edge
    $borderColor = [System.Drawing.Color]::FromArgb(23, 255, 255, 255)
    $borderPen   = New-Object System.Drawing.Pen($borderColor, [single]1)
    $g.DrawPath($borderPen, $panelPath)
    $borderPen.Dispose()
    $panelPath.Dispose()

    # --- Key grid geometry ---
    [single]$keySize  = 240
    [single]$keyGap   = 36
    [single]$gridX    = $panelX + 60 + 120    # paddingLeft + labelSlot = 260
    [single]$rowGap   = 36
    # Vertically center the 2-row grid inside the panel
    [single]$topRowY  = $panelY + ($panelH - (2 * $keySize + $rowGap)) / 2   # = 222
    [single]$botRowY  = $topRowY + $keySize + $rowGap                          # = 498

    # --- LIVE row (top): thinking face | counting face | permission-idle@2x.png ---
    [single]$col0X = $gridX
    [single]$col1X = $gridX + $keySize + $keyGap
    [single]$col2X = $gridX + 2 * ($keySize + $keyGap)

    Draw-KeyThinking -g $g -x $col0X -y $topRowY -size $keySize
    Draw-KeyCounting -g $g -x $col1X -y $topRowY -size $keySize

    # permission-idle@2x.png — DrawImage scaled to keySize (must match the two GDI+ faces)
    $permIdlePath = Join-Path $keys "permission-idle@2x.png"
    $permIdleBmp  = [System.Drawing.Image]::FromFile($permIdlePath)
    $g.DrawImage($permIdleBmp, $col2X, $topRowY, $keySize, $keySize)
    $permIdleBmp.Dispose()

    # --- ALERT row (bottom): stop-alert | task-completed-alert | permission-alert ---
    $alertFiles = @(
        (Join-Path $keys "stop-alert@2x.png"),
        (Join-Path $keys "task-completed-alert@2x.png"),
        (Join-Path $keys "permission-alert@2x.png")
    )
    $alertXs = @($col0X, $col1X, $col2X)
    for ($i = 0; $i -lt 3; $i++) {
        $alertBmp = [System.Drawing.Image]::FromFile($alertFiles[$i])
        $g.DrawImage($alertBmp, $alertXs[$i], $botRowY, $keySize, $keySize)
        $alertBmp.Dispose()
    }

    # --- Row labels: right-aligned in label slot (labelSlot=120, labelWidth=100) ---
    # Label rect right edge = gridX, giving 20px gutter to the first key column.
    $labelFont  = New-Object System.Drawing.Font("Segoe UI", [single]18, [System.Drawing.FontStyle]::Regular)
    $labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 255, 255, 255))
    $sfLabel = New-Object System.Drawing.StringFormat
    $sfLabel.Alignment     = [System.Drawing.StringAlignment]::Far
    $sfLabel.LineAlignment = [System.Drawing.StringAlignment]::Center
    # labelSlot=120, paddingLeft=60; label rect left = panelX+paddingLeft = 140
    [single]$labelRectX = $panelX + 60
    [single]$labelW     = 100   # fits within labelSlot=120 with 20px gutter
    $liveRect  = New-Object System.Drawing.RectangleF($labelRectX, $topRowY, $labelW, $keySize)
    $alertRect = New-Object System.Drawing.RectangleF($labelRectX, $botRowY, $labelW, $keySize)
    $g.DrawString("LIVE",  $labelFont, $labelBrush, $liveRect,  $sfLabel)
    $g.DrawString("ALERT", $labelFont, $labelBrush, $alertRect, $sfLabel)
    $labelFont.Dispose()
    $labelBrush.Dispose()
    $sfLabel.Dispose()

    # --- Headline — vertically centered on panel midpoint ---
    # panelMidY = panelY + panelH/2 = 480; block height = 3 lines * 100px = 300px
    # textY = panelMidY - 150 = 330
    [single]$textX    = $panelX + $panelW + 80   # = 1212
    [single]$textY    = $panelY + $panelH / 2 - 150
    Draw-Tagline -g $g -lines @("STREAM DECK", "ALERTS FOR", "CLAUDE CODE.") `
        -x $textX -y $textY -maxWidth 700 -lineHeight 100 -fontSize 64 `
        -color ([System.Drawing.Color]::White)

    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# ---- shared gallery helpers ----

# Centered tagline at top of gallery image
function Draw-GalleryTagline {
    param($g, [string[]]$lines, [int]$canvasW, [single]$y, [single]$lineHeight, [single]$fontSize)
    $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $rect = New-Object System.Drawing.RectangleF(0, ($y + $i * $lineHeight), $canvasW, $lineHeight)
        $g.DrawString($lines[$i], $font, $brush, $rect, $sf)
    }
    $font.Dispose()
    $brush.Dispose()
}

function Draw-GalleryBackground {
    param($g, [int]$w, [int]$h)
    $bg = New-GradientBrush -x 0 -y 0 -w $w -h $h -fromHex "#0f172a" -toHex "#1e3a8a" -angleDeg 45
    $g.FillRectangle($bg, 0, 0, $w, $h)
    $bg.Dispose()
    # Decorative bells, low opacity, far corners only
    $deco = [System.Drawing.Color]::FromArgb(25, 255, 255, 255)
    Draw-Bell -g $g -cx 100 -cy 100 -size 50 -color $deco
    Draw-Bell -g $g -cx ($w - 100) -cy ($h - 100) -size 60 -color $deco
}

# ---- Gallery 1 — Anatomy ----

function Make-GalleryAnatomy {
    param([string]$outPath, [int]$w = 1920, [int]$h = 960)
    $canvas = New-Canvas -w $w -h $h
    $g = $canvas.g
    $bmp = $canvas.bmp

    Draw-GalleryBackground -g $g -w $w -h $h

    Draw-GalleryTagline -g $g -lines @("THREE SIGNALS, ONE GLANCE.") `
        -canvasW $w -y 100 -lineHeight 80 -fontSize 56

    # Three columns: Stop / Permission / Task. Each column = button + label + caption.
    $colCount = 3
    $btnSize = 280
    $colGap = 80
    $totalWidth = $btnSize * $colCount + $colGap * ($colCount - 1)
    $startX = ($w - $totalWidth) / 2
    $btnY = 320

    $iconFiles = @(
        (Join-Path $keys "stop-alert@2x.png"),
        (Join-Path $keys "permission-alert@2x.png"),
        (Join-Path $keys "task-completed-alert@2x.png")
    )
    $labels = @("STOP", "PERMISSION", "TASK COMPLETED")
    $captions = @(
        "Claude's turn ended.",
        "Tool permission needed.",
        "Subagent finished its task."
    )

    $labelFont = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold)
    $captionFont = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Regular)
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 255, 255, 255))
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

    for ($i = 0; $i -lt $colCount; $i++) {
        $x = $startX + ($i * ($btnSize + $colGap))

        # Drop shadow
        $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 0, 0, 0))
        $shadowPath = New-RoundedRectPath -x ($x + 6) -y ($btnY + 16) -w $btnSize -h $btnSize -radius ($btnSize * 0.14)
        $g.FillPath($shadowBrush, $shadowPath)
        $shadowBrush.Dispose()
        $shadowPath.Dispose()

        $iconBmp = [System.Drawing.Image]::FromFile($iconFiles[$i])
        $g.DrawImage($iconBmp, $x, $btnY, $btnSize, $btnSize)
        $iconBmp.Dispose()

        $labelRect = New-Object System.Drawing.RectangleF(($x - 30), ($btnY + $btnSize + 30), ($btnSize + 60), 50)
        $g.DrawString($labels[$i], $labelFont, $whiteBrush, $labelRect, $sf)

        $captionRect = New-Object System.Drawing.RectangleF(($x - 40), ($btnY + $btnSize + 90), ($btnSize + 80), 40)
        $g.DrawString($captions[$i], $captionFont, $mutedBrush, $captionRect, $sf)
    }
    $labelFont.Dispose()
    $captionFont.Dispose()
    $whiteBrush.Dispose()
    $mutedBrush.Dispose()

    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# ---- Gallery 2 — Architecture (local + remote) ----

function Make-GalleryArchitecture {
    param([string]$outPath, [int]$w = 1920, [int]$h = 960)
    $canvas = New-Canvas -w $w -h $h
    $g = $canvas.g
    $bmp = $canvas.bmp

    Draw-GalleryBackground -g $g -w $w -h $h

    Draw-GalleryTagline -g $g -lines @("WORKS LOCAL OR OVER SSH.") `
        -canvasW $w -y 100 -lineHeight 80 -fontSize 56

    # Center: single alert button
    $btnSize = 320
    $btnX = ($w - $btnSize) / 2
    $btnY = 380

    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 0, 0, 0))
    $shadowPath = New-RoundedRectPath -x ($btnX + 8) -y ($btnY + 20) -w $btnSize -h $btnSize -radius ($btnSize * 0.14)
    $g.FillPath($shadowBrush, $shadowPath)
    $shadowBrush.Dispose()
    $shadowPath.Dispose()

    $iconBmp = [System.Drawing.Image]::FromFile((Join-Path $keys "permission-alert@2x.png"))
    $g.DrawImage($iconBmp, $btnX, $btnY, $btnSize, $btnSize)
    $iconBmp.Dispose()

    # Left source: "LOCAL HOOKS"
    $sourceFont = New-Object System.Drawing.Font("Segoe UI", 30, [System.Drawing.FontStyle]::Bold)
    $detailFont = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Regular)
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 255, 255, 255))
    $sfLeft = New-Object System.Drawing.StringFormat
    $sfLeft.Alignment = [System.Drawing.StringAlignment]::Far
    $sfLeft.LineAlignment = [System.Drawing.StringAlignment]::Center
    $sfRight = New-Object System.Drawing.StringFormat
    $sfRight.Alignment = [System.Drawing.StringAlignment]::Near
    $sfRight.LineAlignment = [System.Drawing.StringAlignment]::Center

    $leftLabel = New-Object System.Drawing.RectangleF(120, 480, 480, 50)
    $leftDetail = New-Object System.Drawing.RectangleF(120, 540, 480, 40)
    $g.DrawString("LOCAL HOOKS", $sourceFont, $whiteBrush, $leftLabel, $sfLeft)
    $g.DrawString("Claude on your machine", $detailFont, $mutedBrush, $leftDetail, $sfLeft)

    $rightLabel = New-Object System.Drawing.RectangleF(($w - 600), 480, 480, 50)
    $rightDetail = New-Object System.Drawing.RectangleF(($w - 600), 540, 480, 40)
    $g.DrawString("REMOTE SSH", $sourceFont, $whiteBrush, $rightLabel, $sfRight)
    $g.DrawString("Tunnel via -R 9123", $detailFont, $mutedBrush, $rightDetail, $sfRight)

    # Arrows pointing toward the center button
    $arrowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 255, 255, 255), 4)
    $arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::ArrowAnchor
    $g.DrawLine($arrowPen, 620, 540, ($btnX - 20), ($btnY + $btnSize / 2))
    $g.DrawLine($arrowPen, ($w - 620), 540, ($btnX + $btnSize + 20), ($btnY + $btnSize / 2))
    $arrowPen.Dispose()

    $sourceFont.Dispose()
    $detailFont.Dispose()
    $whiteBrush.Dispose()
    $mutedBrush.Dispose()

    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# ---- Gallery 3 — State transition (idle vs alert) ----

function Make-GalleryStates {
    param([string]$outPath, [int]$w = 1920, [int]$h = 960)
    $canvas = New-Canvas -w $w -h $h
    $g = $canvas.g
    $bmp = $canvas.bmp

    Draw-GalleryBackground -g $g -w $w -h $h

    Draw-GalleryTagline -g $g -lines @("ARMED IN UNDER A SECOND.") `
        -canvasW $w -y 100 -lineHeight 80 -fontSize 56

    # 3x2 grid: idle row + alert row
    $btnSize = 240
    $colGap = 60
    $rowGap = 60
    $totalWidth = $btnSize * 3 + $colGap * 2
    $startX = ($w - $totalWidth) / 2
    $idleY = 280
    $alertY = $idleY + $btnSize + $rowGap

    $idleFiles = @(
        (Join-Path $keys "stop-idle@2x.png"),
        (Join-Path $keys "permission-idle@2x.png"),
        (Join-Path $keys "task-completed-idle@2x.png")
    )
    $alertFiles = @(
        (Join-Path $keys "stop-alert@2x.png"),
        (Join-Path $keys "permission-alert@2x.png"),
        (Join-Path $keys "task-completed-alert@2x.png")
    )

    for ($i = 0; $i -lt 3; $i++) {
        $x = $startX + ($i * ($btnSize + $colGap))
        $iconBmpIdle = [System.Drawing.Image]::FromFile($idleFiles[$i])
        $iconBmpAlert = [System.Drawing.Image]::FromFile($alertFiles[$i])
        $g.DrawImage($iconBmpIdle, $x, $idleY, $btnSize, $btnSize)
        $g.DrawImage($iconBmpAlert, $x, $alertY, $btnSize, $btnSize)
        $iconBmpIdle.Dispose()
        $iconBmpAlert.Dispose()
    }

    # Row labels left of grid
    $labelFont = New-Object System.Drawing.Font("Segoe UI", 26, [System.Drawing.FontStyle]::Bold)
    $labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 255, 255, 255))
    $sfLabel = New-Object System.Drawing.StringFormat
    $sfLabel.Alignment = [System.Drawing.StringAlignment]::Far
    $sfLabel.LineAlignment = [System.Drawing.StringAlignment]::Center
    $idleLabelRect = New-Object System.Drawing.RectangleF(($startX - 200), $idleY, 180, $btnSize)
    $alertLabelRect = New-Object System.Drawing.RectangleF(($startX - 200), $alertY, 180, $btnSize)
    $g.DrawString("IDLE", $labelFont, $labelBrush, $idleLabelRect, $sfLabel)
    $g.DrawString("ALERT", $labelFont, $labelBrush, $alertLabelRect, $sfLabel)
    $labelFont.Dispose()
    $labelBrush.Dispose()

    # Footer caption
    $captionFont = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Regular)
    $captionBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 255, 255, 255))
    $sfCaption = New-Object System.Drawing.StringFormat
    $sfCaption.Alignment = [System.Drawing.StringAlignment]::Center
    $sfCaption.LineAlignment = [System.Drawing.StringAlignment]::Center
    $captionRect = New-Object System.Drawing.RectangleF(0, ($alertY + $btnSize + 40), $w, 40)
    $g.DrawString("Configurable delay swallows fast hooks before they flash.", $captionFont, $captionBrush, $captionRect, $sfCaption)
    $captionFont.Dispose()
    $captionBrush.Dispose()

    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# ---- generate ----

# Draft variants for app icon comparison
Make-AppIcon-AH           -outPath (Join-Path $drafts "app-icon-ah.png")
Make-AppIcon-BellSparkle  -outPath (Join-Path $drafts "app-icon-bell-sparkle.png")
Make-AppIcon-ClockSparkle -outPath (Join-Path $drafts "app-icon-clock-sparkle.png")

# Production assets
Make-AppIcon -outPath (Join-Path $out "app-icon-288.png")
$thumbPath = Join-Path $out "thumbnail-1920x960.png"
Make-ThumbnailPanel -outPath $thumbPath
Make-GalleryAnatomy -outPath (Join-Path $out "gallery-1-anatomy.png")
Make-GalleryArchitecture -outPath (Join-Path $out "gallery-2-architecture.png")
Make-GalleryStates -outPath (Join-Path $out "gallery-3-states.png")

# README hero — same content as the marketplace thumbnail. One source of truth.
$previewDir = Join-Path $root "com.nshopik.agentichooks.sdPlugin\previews"
New-Item -ItemType Directory -Force -Path $previewDir | Out-Null
Copy-Item -Path $thumbPath -Destination (Join-Path $previewDir "main.png") -Force

Write-Host "Generated marketplace assets:"
Get-ChildItem $out -Filter "*.png" | ForEach-Object { Write-Host "  $($_.FullName.Replace($root.Path, '.'))" }
