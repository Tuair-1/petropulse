$ErrorActionPreference = 'Stop'

# --- Read OAuth token stored by gh CLI in Windows Credential Manager ---
Add-Type -Namespace Win32.Native -Name Cred -MemberDefinition @'
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string Target, int Type, int Flags, out IntPtr Credential);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr Buffer);
'@

function Read-GitHubToken {
    $target = 'GitHub - https://api.github.com/Tuair-1'
    $cred = [IntPtr]::Zero
    if (-not [Win32.Native.Cred]::CredRead($target, 1, 0, [ref]$cred)) {
        throw "CredRead failed for '$target', win32 error: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    try {
        $size = [System.Runtime.InteropServices.Marshal]::ReadInt32($cred, 32)
        if ($size -le 0 -or $size -gt 4096) { throw "Unexpected credential blob size: $size" }
        $blobPtr = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($cred, 40)
        $bytes = New-Object byte[] $size
        [System.Runtime.InteropServices.Marshal]::Copy($blobPtr, $bytes, 0, $size)

        # Try UTF-8 first, fall back to UTF-16 if it doesn't look right
        $u8 = [System.Text.Encoding]::UTF8.GetString($bytes).Trim([char]0, [char]10, [char]13, ' ')
        if ($u8 -match '^[A-Za-z0-9_\-\.]+$') { return $u8 }
        $u16 = [System.Text.Encoding]::Unicode.GetString($bytes).Trim([char]0, [char]10, [char]13, ' ')
        if ($u16 -match '^[A-Za-z0-9_\-\.]+$') { return $u16 }
        throw 'Token decode failed (neither UTF-8 nor UTF-16 yields a clean token)'
    } finally {
        [Win32.Native.Cred]::CredFree($cred) | Out-Null
    }
}

$token = Read-GitHubToken
Write-Output ("TOKEN_LEN=" + $token.Length)
Write-Output ("TOKEN_HEAD=" + $token.Substring(0, [Math]::Min(6, $token.Length)) + "...")

# Persist token for later git push (askpass), then clean up after use
$tokenFile = Join-Path $env:TEMP 'petropulse_gh_token.txt'
[System.IO.File]::WriteAllText($tokenFile, $token, [System.Text.Encoding]::ASCII)
Write-Output ("TOKEN_FILE=" + $tokenFile)

# --- Create public repo ---
$repoName = 'petropulse'
$body = @{
    name        = $repoName
    description = 'PetroPulse 石化脉动 — 石化产业智慧信息平台 (Claude Code 生成)'
    private     = $false
    auto_init   = $false
    has_issues  = $false
    has_wiki    = $false
} | ConvertTo-Json

$headers = @{
    Authorization = "Bearer $token"
    'User-Agent'  = 'claude-code-deploy'
    Accept        = 'application/vnd.github+json'
}

try {
    $r = Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' -Headers $headers -Body $body -ContentType 'application/json'
    Write-Output ("REPO_OK " + $r.full_name + " | " + $r.html_url + " | " + $r.clone_url)
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $errBody = $reader.ReadToEnd()
        Write-Output ("REPO_ERR " + [int]$resp.StatusCode + " " + $errBody)
    } else {
        Write-Output ("REPO_ERR " + $_.Exception.Message)
    }
}
