$ErrorActionPreference = 'Stop'
$token = [System.IO.File]::ReadAllText((Join-Path $env:TEMP 'petropulse_gh_token.txt')).Trim()
$headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'claude-code-deploy'; Accept = 'application/vnd.github+json' }

foreach ($u in @(
  'https://api.github.com/user',
  'https://api.github.com/repos/Tuair-1/petropulse',
  'https://api.github.com/repos/Tuair-1/petropulse/pages'
)) {
  try {
    $r = Invoke-WebRequest -Uri $u -Headers $headers -Method Get
    Write-Output ("GET " + $u + " => " + [int]$r.StatusCode + " " + $r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))
  } catch {
    $resp = $_.Exception.Response
    $code = [int]$resp.StatusCode
    $body = ''
    try { $body = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {}
    Write-Output ("GET " + $u + " => " + $code + " " + $body.Substring(0, [Math]::Min(300, $body.Length)))
  }
}
