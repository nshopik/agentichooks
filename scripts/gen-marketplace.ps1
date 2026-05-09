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

# ---- 1920×960 marketplace thumbnail ----

function Make-Thumbnail {
    param([string]$outPath, [int]$w = 1920, [int]$h = 960)
    $canvas = New-Canvas -w $w -h $h
    $g = $canvas.g
    $bmp = $canvas.bmp

    # Background gradient — navy bottom-left to bright blue top-right.
    $bg = New-GradientBrush -x 0 -y 0 -w $w -h $h -fromHex "#0f172a" -toHex "#1e3a8a" -angleDeg 45
    $g.FillRectangle($bg, 0, 0, $w, $h)
    $bg.Dispose()

    # Subtle decorative bells in background, low opacity
    $deco = [System.Drawing.Color]::FromArgb(30, 255, 255, 255)
    Draw-Bell -g $g -cx 200 -cy 180 -size 60 -color $deco
    Draw-Bell -g $g -cx 1700 -cy 800 -size 80 -color $deco
    Draw-Bell -g $g -cx 1820 -cy 200 -size 40 -color $deco
    Draw-Bell -g $g -cx 100 -cy 820 -size 50 -color $deco

    # LEFT — three alert-state buttons in a row, large
    $btnSize = 280
    $btnGap = 48
    $rowWidth = $btnSize * 3 + $btnGap * 2
    $rowX = 140
    $rowY = [int](($h - $btnSize) / 2)

    $iconFiles = @(
        (Join-Path $keys "stop-alert@2x.png"),
        (Join-Path $keys "permission-alert@2x.png"),
        (Join-Path $keys "task-completed-alert@2x.png")
    )
    for ($i = 0; $i -lt $iconFiles.Count; $i++) {
        $iconBmp = [System.Drawing.Image]::FromFile($iconFiles[$i])
        $x = $rowX + ($i * ($btnSize + $btnGap))
        # Soft drop shadow under each button
        $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 0, 0, 0))
        $shadowPath = New-RoundedRectPath -x ($x + 6) -y ($rowY + 16) -w $btnSize -h $btnSize -radius ($btnSize * 0.14)
        $g.FillPath($shadowBrush, $shadowPath)
        $shadowBrush.Dispose()
        $shadowPath.Dispose()
        $g.DrawImage($iconBmp, $x, $rowY, $btnSize, $btnSize)
        $iconBmp.Dispose()
    }

    # RIGHT — tagline
    $textX = $rowX + $rowWidth + 80
    $textY = 280
    Draw-Tagline -g $g -lines @("STREAM DECK", "ALERTS FOR", "CLAUDE CODE.") `
        -x $textX -y $textY -maxWidth 700 -lineHeight 100 -fontSize 64 -color ([System.Drawing.Color]::White)

    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# ---- 1920×960 thumbnail v2 — panel-framed ----

function Make-ThumbnailPanel {
    param([string]$outPath, [int]$w = 1920, [int]$h = 960)
    $canvas = New-Canvas -w $w -h $h
    $g = $canvas.g
    $bmp = $canvas.bmp

    # Background gradient — same as v1
    $bg = New-GradientBrush -x 0 -y 0 -w $w -h $h -fromHex "#0f172a" -toHex "#1e3a8a" -angleDeg 45
    $g.FillRectangle($bg, 0, 0, $w, $h)
    $bg.Dispose()

    # Subtle decorative bells in background, low opacity — only in the right margin area
    $deco = [System.Drawing.Color]::FromArgb(30, 255, 255, 255)
    Draw-Bell -g $g -cx 1700 -cy 800 -size 80 -color $deco
    Draw-Bell -g $g -cx 1820 -cy 200 -size 40 -color $deco

    # Stream Deck panel — left half. Slightly lighter than bg so it pops as a "surface".
    $panelX = 80
    $panelY = 130
    $panelW = 980
    $panelH = 700
    $panelRadius = 24

    # Panel drop shadow
    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 0, 0, 0))
    $shadowPath = New-RoundedRectPath -x ($panelX + 8) -y ($panelY + 18) -w $panelW -h $panelH -radius $panelRadius
    $g.FillPath($shadowBrush, $shadowPath)
    $shadowBrush.Dispose()
    $shadowPath.Dispose()

    # Panel surface
    $panelBrush = New-GradientBrush -x $panelX -y $panelY -w $panelW -h $panelH -fromHex "#1e293b" -toHex "#0f172a" -angleDeg 90
    $panelPath = New-RoundedRectPath -x $panelX -y $panelY -w $panelW -h $panelH -radius $panelRadius
    $g.FillPath($panelBrush, $panelPath)
    $panelBrush.Dispose()
    $panelPath.Dispose()

    # Window chrome — thin top bar with three circles (close/min/max) for window-app feel
    $chromeH = 44
    $chromeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 255, 255, 255))
    $chromeRect = New-RoundedRectPath -x $panelX -y $panelY -w $panelW -h $chromeH -radius $panelRadius
    $g.FillPath($chromeBrush, $chromeRect)
    $chromeBrush.Dispose()
    $chromeRect.Dispose()
    # Three traffic-light dots
    $dotR = 8
    $dotY = $panelY + ($chromeH / 2) - $dotR
    $dotColors = @("#ef4444", "#f59e0b", "#10b981")
    for ($i = 0; $i -lt 3; $i++) {
        $dotColor = [System.Drawing.ColorTranslator]::FromHtml($dotColors[$i])
        $dotBrush = New-Object System.Drawing.SolidBrush($dotColor)
        $g.FillEllipse($dotBrush, ($panelX + 24 + $i * 28), $dotY, ($dotR * 2), ($dotR * 2))
        $dotBrush.Dispose()
    }

    # 3x2 button grid inside panel — top row idle, bottom row alert
    $btnSize = 220
    $btnGap = 36
    $gridW = $btnSize * 3 + $btnGap * 2
    $gridX = $panelX + ($panelW - $gridW) / 2
    $gridY = $panelY + $chromeH + 100

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
    $rows = @($idleFiles, $alertFiles)
    for ($r = 0; $r -lt 2; $r++) {
        for ($i = 0; $i -lt 3; $i++) {
            $iconBmp = [System.Drawing.Image]::FromFile($rows[$r][$i])
            $x = $gridX + ($i * ($btnSize + $btnGap))
            $y = $gridY + ($r * ($btnSize + $btnGap + 20))
            $g.DrawImage($iconBmp, $x, $y, $btnSize, $btnSize)
            $iconBmp.Dispose()
        }
    }

    # Row labels — left of the grid
    $labelFont = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Regular)
    $labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 255, 255, 255))
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Far
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $idleRect = New-Object System.Drawing.RectangleF(($gridX - 100), $gridY, 90, $btnSize)
    $alertRect = New-Object System.Drawing.RectangleF(($gridX - 100), ($gridY + $btnSize + $btnGap + 20), 90, $btnSize)
    $g.DrawString("IDLE", $labelFont, $labelBrush, $idleRect, $sf)
    $g.DrawString("ALERT", $labelFont, $labelBrush, $alertRect, $sf)
    $labelFont.Dispose()
    $labelBrush.Dispose()

    # RIGHT — tagline
    $textX = $panelX + $panelW + 80
    $textY = 320
    Draw-Tagline -g $g -lines @("STREAM DECK", "ALERTS FOR", "CLAUDE CODE.") `
        -x $textX -y $textY -maxWidth 700 -lineHeight 100 -fontSize 64 -color ([System.Drawing.Color]::White)

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
Make-Thumbnail -outPath $thumbPath
Make-GalleryAnatomy -outPath (Join-Path $out "gallery-1-anatomy.png")
Make-GalleryArchitecture -outPath (Join-Path $out "gallery-2-architecture.png")
Make-GalleryStates -outPath (Join-Path $out "gallery-3-states.png")

# README hero — same content as the marketplace thumbnail. One source of truth.
$previewDir = Join-Path $root "com.nshopik.agentichooks.sdPlugin\previews"
New-Item -ItemType Directory -Force -Path $previewDir | Out-Null
Copy-Item -Path $thumbPath -Destination (Join-Path $previewDir "main.png") -Force

Write-Host "Generated marketplace assets:"
Get-ChildItem $out -Filter "*.png" | ForEach-Object { Write-Host "  $($_.FullName.Replace($root.Path, '.'))" }
