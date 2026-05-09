param()
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$keys = Join-Path $root "com.nshopik.claudenotify.sdPlugin\images\keys"
$imgs = Join-Path $root "com.nshopik.claudenotify.sdPlugin\images"
$prev = Join-Path $root "com.nshopik.claudenotify.sdPlugin\previews"

New-Item -ItemType Directory -Force -Path $keys | Out-Null
New-Item -ItemType Directory -Force -Path $prev | Out-Null

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
    @{ name = "stop";           glyph = "check"; idle = "#1f2937"; alert = "#16a34a" },
    @{ name = "permission";     glyph = "perm";  idle = "#1f2937"; alert = "#dc2626" },
    @{ name = "task-completed"; glyph = "idle";  idle = "#1f2937"; alert = "#3b82f6" }
)

foreach ($e in $events) {
    foreach ($size in @(72, 144)) {
        $suffix = if ($size -eq 144) { "@2x" } else { "" }
        Make-KeyIcon -outPath (Join-Path $keys "$($e.name)-idle$suffix.png")  -size $size -bgHex $e.idle  -glyphName $e.glyph
        Make-KeyIcon -outPath (Join-Path $keys "$($e.name)-alert$suffix.png") -size $size -bgHex $e.alert -glyphName $e.glyph
    }
}

# Plugin icon (256 + 512): dark rounded square with bell glyph
function Make-PluginIcon {
    param([string]$outPath, [int]$size)
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $bg = [System.Drawing.ColorTranslator]::FromHtml("#0f172a")
    $bgBrush = New-Object System.Drawing.SolidBrush($bg)
    $radius = [int]($size * 0.16)
    $rect = New-RoundedRectPath $g $size $size $radius
    $g.FillPath($bgBrush, $rect)

    $blue = [System.Drawing.ColorTranslator]::FromHtml("#3b82f6")
    $brush = New-Object System.Drawing.SolidBrush($blue)
    $pen = New-Object System.Drawing.Pen($blue, [single]($size * 0.04))
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    # Bell shape: ellipse top + flared trapezoid + clapper
    $s = [single]$size
    $cx = $s * 0.5
    # bell body (rounded triangle)
    $top = $s * 0.28
    $bottom = $s * 0.66
    $halfTopW = $s * 0.10
    $halfBotW = $s * 0.22
    $points = @(
        (New-Object System.Drawing.PointF(($cx - $halfTopW), $top)),
        (New-Object System.Drawing.PointF(($cx + $halfTopW), $top)),
        (New-Object System.Drawing.PointF(($cx + $halfBotW), $bottom)),
        (New-Object System.Drawing.PointF(($cx - $halfBotW), $bottom))
    )
    $g.FillPolygon($brush, [System.Drawing.PointF[]]$points)
    # rounded top cap
    $capR = $halfTopW
    $g.FillEllipse($brush, ($cx - $capR), ($top - $capR), ($capR * 2), ($capR * 2))
    # base bar
    $baseW = $s * 0.50
    $baseH = $s * 0.045
    $g.FillRectangle($brush, ($cx - $baseW / 2), $bottom, $baseW, $baseH)
    # clapper
    $clapperR = $s * 0.05
    $g.FillEllipse($brush, ($cx - $clapperR), ($bottom + $baseH + $clapperR * 0.4), ($clapperR * 2), ($clapperR * 2))

    $pen.Dispose()
    $brush.Dispose()
    $bgBrush.Dispose()
    $g.Dispose()

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

Make-PluginIcon -outPath (Join-Path $imgs "plugin-icon.png")    -size 256
Make-PluginIcon -outPath (Join-Path $imgs "plugin-icon@2x.png") -size 512

# Preview placeholder (800 x 600)
$pw = 800; $ph = 600
$pbmp = New-Object System.Drawing.Bitmap($pw, $ph, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$pg = [System.Drawing.Graphics]::FromImage($pbmp)
$pg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$pgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#0f172a"))
$pg.FillRectangle($pgBrush, 0, 0, $pw, $ph)
$pgBrush.Dispose()

$font = New-Object System.Drawing.Font("Segoe UI", 48, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 0, $pw, $ph)
$pg.DrawString("Agent Hook Notify", $font, $textBrush, $rect, $sf)

$font.Dispose()
$textBrush.Dispose()
$pg.Dispose()
$pbmp.Save((Join-Path $prev "main.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$pbmp.Dispose()

Write-Host "Generated all icons:"
Get-ChildItem (Join-Path $root "com.nshopik.claudenotify.sdPlugin") -Recurse -Include "*.png", "*.svg" | ForEach-Object { Write-Host "  $($_.FullName.Replace($root.Path, '.'))" }
