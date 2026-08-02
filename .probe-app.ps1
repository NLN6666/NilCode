$p = Get-Process -Id 10384 -ErrorAction SilentlyContinue
if ($null -eq $p) { "process gone"; exit }
"path=" + $p.Path
$vi = $p.MainModule.FileVersionInfo
"fileVersion=" + $vi.FileVersion
"productVersion=" + $vi.ProductVersion
$dir = Split-Path $p.Path -Parent
"dir=" + $dir
$res = Join-Path $dir 'resources'
if (Test-Path $res) {
    Get-ChildItem $res -Filter '*.asar' | ForEach-Object { "asar=" + $_.FullName + " size=" + $_.Length + " mtime=" + $_.LastWriteTime }
    Get-ChildItem $res -Directory | ForEach-Object { "resdir=" + $_.Name + " mtime=" + $_.LastWriteTime }
}
