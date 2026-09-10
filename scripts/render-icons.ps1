# Render the project's simple vector coin mark at standard toolbar sizes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'extension\icons'
New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null
foreach ($iconSize in @(16, 32, 48, 128)) {
    $bitmap = [System.Drawing.Bitmap]::new($iconSize, $iconSize)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::FromArgb(36, 76, 90))
    $scale = $iconSize / 128.0
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(228, 238, 241), [single](6 * $scale))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawEllipse($pen, [single](20*$scale), [single](20*$scale), [single](88*$scale), [single](88*$scale))
    $graphics.DrawArc($pen, [single](38*$scale), [single](38*$scale), [single](52*$scale), [single](52*$scale), [single]52, [single]256)
    $bitmap.Save((Join-Path $iconDirectory "icon-$iconSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
