$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$svgPath = Join-Path $projectRoot "build\icon.svg"
$icoPath = Join-Path $projectRoot "build\icon.ico"
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("codex-control-icon-" + [Guid]::NewGuid().ToString("N"))
$pngPath = Join-Path $temporaryDirectory "icon-512.png"

$edgeCandidates = @(
  $env:EDGE_PATH,
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if (-not $edgeCandidates) {
  throw "Microsoft Edge is required to render build/icon.svg. Set EDGE_PATH to msedge.exe."
}
$edgePath = $edgeCandidates | Select-Object -First 1

New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
try {
  $svgUri = ([Uri]$svgPath).AbsoluteUri
  & $edgePath `
    --headless=new `
    --disable-gpu `
    --hide-scrollbars `
    --default-background-color=00000000 `
    --window-size=512,512 `
    --screenshot=$pngPath `
    $svgUri | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pngPath)) {
    throw "Microsoft Edge could not render build/icon.svg."
  }

  $source = [System.Drawing.Image]::FromFile($pngPath)
  try {
    $frames = [System.Collections.Generic.List[object]]::new()
    foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 128, 256)) {
      $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.Clear([System.Drawing.Color]::Transparent)
          $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
          $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
          $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $graphics.DrawImage($source, 0, 0, $size, $size)
        } finally {
          $graphics.Dispose()
        }
        $memory = [System.IO.MemoryStream]::new()
        try {
          $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
          $frames.Add([pscustomobject]@{ Size = $size; Bytes = $memory.ToArray() })
        } finally {
          $memory.Dispose()
        }
      } finally {
        $bitmap.Dispose()
      }
    }

    $file = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    try {
      $writer = [System.IO.BinaryWriter]::new($file)
      try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$frames.Count)
        $offset = 6 + (16 * $frames.Count)
        foreach ($frame in $frames) {
          $writer.Write([byte]$(if ($frame.Size -eq 256) { 0 } else { $frame.Size }))
          $writer.Write([byte]$(if ($frame.Size -eq 256) { 0 } else { $frame.Size }))
          $writer.Write([byte]0)
          $writer.Write([byte]0)
          $writer.Write([uint16]1)
          $writer.Write([uint16]32)
          $writer.Write([uint32]$frame.Bytes.Length)
          $writer.Write([uint32]$offset)
          $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) {
          $writer.Write([byte[]]$frame.Bytes)
        }
      } finally {
        $writer.Dispose()
      }
    } finally {
      $file.Dispose()
    }
  } finally {
    $source.Dispose()
  }
} finally {
  Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Generated build/icon.ico with Windows icon sizes 16 through 256 px."
