$ErrorActionPreference = 'Stop'
$tokenFile = Join-Path $env:TEMP 'petropulse_gh_token.txt'
$token = [System.IO.File]::ReadAllText($tokenFile).Trim()

$headers = @{
    Authorization = "Bearer $token"
    'User-Agent'  = 'claude-code-deploy'
    Accept        = 'application/vnd.github+json'
}

# 1) 启用 Pages(以 main 分支根目录为源)
try {
    $body = @{ source = @{ branch = 'main'; path = '/' } } | ConvertTo-Json -Depth 3
    $r = Invoke-RestMethod -Method Put -Uri 'https://api.github.com/repos/Tuair-1/petropulse/pages' -Headers $headers -Body $body -ContentType 'application/json'
    Write-Output ("PAGES_OK " + $r.html_url + " | status=" + $r.status)
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        Write-Output ("PAGES_ERR " + [int]$resp.StatusCode + " " + $reader.ReadToEnd())
    } else {
        Write-Output ("PAGES_ERR " + $_.Exception.Message)
    }
}
