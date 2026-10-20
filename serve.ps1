# Minimal static file server for the HSK 1 site.
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8000] [-Open]
param(
    [int]$Port = 8000,
    [switch]$Open
)

$root = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$prefix = "http://localhost:$Port/"

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.ico'  = 'image/x-icon'
    '.mp3'  = 'audio/mpeg'
    '.txt'  = 'text/plain; charset=utf-8'
}

# Learning progress is stored on disk in data\progress.json, with one backup per day (last 14 kept).
$utf8 = New-Object System.Text.UTF8Encoding($false)
$dataDir = Join-Path $root 'data'
$backupDir = Join-Path $dataDir 'backups'
$progressFile = Join-Path $dataDir 'progress.json'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

function Save-Progress([string]$json) {
    # write to a temp file first, then swap it in, so a crash never leaves a half-written file
    $tmp = "$progressFile.tmp"
    [IO.File]::WriteAllText($tmp, $json, $utf8)
    if (Test-Path -LiteralPath $progressFile) {
        # [NullString] because PowerShell would pass $null as "" (an invalid backup path)
        [IO.File]::Replace($tmp, $progressFile, [NullString]::Value)
    } else {
        [IO.File]::Move($tmp, $progressFile)
    }
    $backup = Join-Path $backupDir ("progress-{0}.json" -f (Get-Date -Format 'yyyy-MM-dd'))
    Copy-Item -LiteralPath $progressFile -Destination $backup -Force
    Get-ChildItem -LiteralPath $backupDir -Filter 'progress-*.json' |
        Sort-Object Name -Descending | Select-Object -Skip 14 | Remove-Item -Force
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    Write-Host "Could not start server on port $Port. Is it already in use? Try: .\serve.ps1 -Port 8080" -ForegroundColor Red
    exit 1
}

Write-Host "Serving $root"
Write-Host "Open $prefix in your browser. Press Ctrl+C to stop." -ForegroundColor Green
if ($Open) { Start-Process $prefix }

try {
    while ($listener.IsListening) {
        # Poll so Ctrl+C can interrupt between requests
        $task = $listener.GetContextAsync()
        while (-not $task.AsyncWaitHandle.WaitOne(500)) { }
        $ctx = $task.Result
        $res = $ctx.Response

        $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
        if ($rel -eq '') { $rel = 'index.html' }
        $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
        $method = $ctx.Request.HttpMethod

        $status = 200
        if ($rel -eq 'api/progress') {
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add('Cache-Control', 'no-store')
            if ($method -eq 'GET') {
                $json = if (Test-Path -LiteralPath $progressFile) { [IO.File]::ReadAllText($progressFile, $utf8) } else { '{}' }
            } elseif ($method -eq 'PUT' -or $method -eq 'POST') {
                $reader = New-Object IO.StreamReader($ctx.Request.InputStream, $utf8)
                $body = $reader.ReadToEnd()
                $reader.Close()
                try {
                    if ($body.Length -gt 5MB) { throw 'too large' }
                    $parsed = $body | ConvertFrom-Json
                    if ($parsed.version -ne 2) { throw 'unexpected format' }
                    Save-Progress $body
                    $json = '{"ok":true}'
                } catch {
                    $status = 400
                    $json = '{"ok":false}'
                    Write-Host "Rejected progress save: $_" -ForegroundColor Yellow
                }
            } else {
                $status = 405
                $json = '{"ok":false}'
            }
            $bytes = $utf8.GetBytes($json)
        } elseif ($file.StartsWith($root + [IO.Path]::DirectorySeparatorChar) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
            $ext = [IO.Path]::GetExtension($file).ToLower()
            $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
            $res.Headers.Add('Cache-Control', 'no-cache')
            $bytes = [IO.File]::ReadAllBytes($file)
        } else {
            $status = 404
            $res.ContentType = 'text/plain; charset=utf-8'
            $bytes = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
        }

        $res.StatusCode = $status
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.Close()
        Write-Host ("{0} {1} {2} /{3}" -f (Get-Date -Format 'HH:mm:ss'), $status, $method, $rel)
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Host 'Server stopped.'
}
