Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'assets/brand/icons/icon.png'
$iconDir = Join-Path $root 'assets/brand/icons'
$publicDir = Join-Path $root 'public'
New-Item -ItemType Directory -Force -Path $publicDir | Out-Null

function Resize-Png([string]$sourcePath, [string]$destPath, [int]$size) {
  $img = [System.Drawing.Image]::FromFile($sourcePath)
  try {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose()
    $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }
  finally {
    $img.Dispose()
  }
}

Resize-Png $source (Join-Path $iconDir 'favicon-32.png') 32
Resize-Png $source (Join-Path $iconDir 'favicon-192.png') 192
Resize-Png $source (Join-Path $iconDir 'apple-touch-icon.png') 180
Resize-Png $source (Join-Path $publicDir 'favicon-32.png') 32
Resize-Png $source (Join-Path $publicDir 'favicon-192.png') 192
Resize-Png $source (Join-Path $publicDir 'apple-touch-icon.png') 180
Resize-Png $source (Join-Path $publicDir 'icon-512.png') 512

# 1200x630 social share card
$w = 1200
$h = 630
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(4, 7, 14), [System.Drawing.Color]::FromArgb(12, 23, 48), 35.0)
$g.FillRectangle($bg, $rect)
$bg.Dispose()

# glow
$glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(38, 98, 132, 255))
$g.FillEllipse($glow, 760, -220, 620, 620)
$glow.Dispose()
$glow2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(34, 128, 87, 244))
$g.FillEllipse($glow2, -160, 330, 520, 520)
$glow2.Dispose()

$logoImg = [System.Drawing.Image]::FromFile($source)
$logo = New-Object System.Drawing.Bitmap($logoImg, 132, 132)
$g.DrawImage($logo, 84, 86, 132, 132)
$logo.Dispose()
$logoImg.Dispose()

$fontName = 'Segoe UI'
$bold = New-Object System.Drawing.Font($fontName, 76, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$body = New-Object System.Drawing.Font($fontName, 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$small = New-Object System.Drawing.Font($fontName, 22, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(167, 180, 207))
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(157, 182, 255))

$g.DrawString('TRABZONE', $bold, $white, 72, 260)
$g.DrawString("Trabzon'un dijital merkezi", $body, $accent, 76, 366)
$g.DrawString('Paylas, kesfet, alisveris yap ve sehrin topluluguna katil.', $small, $muted, 76, 420)
$g.DrawString('trabzoneapp.com', $small, $muted, 76, 520)

$accentPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110, 140, 200), 2)
$g.DrawLine($accentPen, 76, 492, 460, 492)
$accentPen.Dispose()

$g.Dispose()
$bmp.Save((Join-Path $publicDir 'og-image.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$bold.Dispose()
$body.Dispose()
$small.Dispose()
$white.Dispose()
$muted.Dispose()
$accent.Dispose()

Write-Output 'Brand assets generated.'
