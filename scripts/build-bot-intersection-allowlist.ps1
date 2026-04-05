# Builds data/bot-intersection-allowlist.txt — high-quality English only (no wiki).
#
# Layer 1 (main): Norvig/Bartmassey freq ∩ Google 20k ∩ Hunspell en_US ∩ Hunspell en_GB
# Layer 2 (supplement): NGSL+NAWL ∩ Norvig ∩ Hunspell US ∩ Hunspell GB
# Layer 3 (volume): First $NorvigHeadLines of Norvig file (frequency-ordered corpus) ∩ Hunspell US ∩ Hunspell GB,
#   min length 4. Same Norvig list as layer 1; no Google filter so we keep high-frequency English lemmas that
#   are not in the Google 20k slice. Still excludes gibberish via dual spelling dictionaries.
#
# Hunspell US+GB = conservative spelling dictionaries (SCOWL-like quality without shipping SCOWL builds).
#
# Run from repo root: powershell -ExecutionPolicy Bypass -File scripts/build-bot-intersection-allowlist.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

# How many top frequency lines from Norvig to consider for layer 3 (~45k is a strong "common English" band).
$NorvigHeadLines = 45000

function Get-DicSet($url) {
  $dic = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 180).Content
  $h = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($line in ($dic -split "`r?`n")) {
    $line = $line.Trim()
    if (-not $line) { continue }
    if ($line -match '^\d+$') { continue }
    $w = ($line -split '/')[0].Trim().ToLower()
    if ($w -match '^[a-z]+$') { [void]$h.Add($w) }
  }
  return $h
}

Write-Host 'Loading Norvig/Massey...'
$n = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
Get-Content 'data\bot-norvig-massey-freq-words.txt' | ForEach-Object {
  $w = $_.Trim().ToLower()
  if ($w -match '^[a-z]+$') { [void]$n.Add($w) }
}

Write-Host 'Loading Google 20k (first20hours English)...'
$g20 = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
Get-Content 'data\google-20k-english.txt' | ForEach-Object {
  $w = $_.Trim().ToLower()
  if ($w -match '^[a-z]+$') { [void]$g20.Add($w) }
}

Write-Host 'Loading NGSL+NAWL supplement...'
$ngsl = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
if (Test-Path 'data\bot-curated-english-ngsl-nawl.txt') {
  Get-Content 'data\bot-curated-english-ngsl-nawl.txt' | ForEach-Object {
    $w = $_.Trim().ToLower()
    # Comment lines are not plain a-z; no 'continue' here (invalid inside ForEach-Object).
    if ($w -match '^[a-z]+$') { [void]$ngsl.Add($w) }
  }
}

Write-Host 'Downloading Hunspell en_US...'
$hUs = Get-DicSet 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/en/en_US.dic'
Write-Host "  en_US lemmas: $($hUs.Count)"

Write-Host 'Downloading Hunspell en_GB...'
$hGb = Get-DicSet 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/en/en_GB.dic'
Write-Host "  en_GB lemmas: $($hGb.Count)"

$all = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$nMain = 0
foreach ($w in $g20) {
  if ($n.Contains($w) -and $hUs.Contains($w) -and $hGb.Contains($w)) {
    [void]$all.Add($w)
    $nMain++
  }
}
Write-Host "Layer1 (Norvig+G20+US+GB): $nMain"

$nExtra = 0
foreach ($w in $ngsl) {
  if ($n.Contains($w) -and $hUs.Contains($w) -and $hGb.Contains($w)) {
    if ($all.Add($w)) { $nExtra++ }
  }
}
Write-Host "Layer2 added from NGSL+NAWL (new only): $nExtra"

$nTier3 = 0
Write-Host "Layer3: Norvig first $NorvigHeadLines lines, len>=4, Hunspell US+GB..."
Get-Content 'data\bot-norvig-massey-freq-words.txt' -TotalCount $NorvigHeadLines | ForEach-Object {
  $w = $_.Trim().ToLower()
  if ($w -notmatch '^[a-z]+$') { return }
  if ($w.Length -lt 4) { return }
  if ($hUs.Contains($w) -and $hGb.Contains($w)) {
    if ($all.Add($w)) { $nTier3++ }
  }
}
Write-Host "Layer3 new words added: $nTier3"

$out = [System.Collections.Generic.List[string]]::new()
foreach ($w in $all) { $out.Add($w) }
$out.Sort()

$header = @(
  '# Bot intersection allowlist (lowercase, one word per line).',
  '# Union of: (Norvig AND Google20k AND Hunspell US AND Hunspell GB)',
  '#      and: (NGSL+NAWL AND Norvig AND Hunspell US AND Hunspell GB)',
  "#      and: first $NorvigHeadLines Norvig freq lines, len>=4, Hunspell US AND Hunspell GB.",
  '# Regenerate: scripts/build-bot-intersection-allowlist.ps1',
  '# Hunspell .dic: LibreOffice (MPL/GPL). NGSL/NAWL: CC BY-SA (see bot-curated-english-ngsl-nawl.txt).'
)
$outPath = Join-Path (Get-Location) 'data\bot-intersection-allowlist.txt'
[IO.File]::WriteAllLines($outPath, $header + $out.ToArray(), [Text.UTF8Encoding]::new($false))
Write-Host "Wrote $outPath ($($out.Count) words total)"
