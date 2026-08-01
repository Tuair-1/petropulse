$ErrorActionPreference = 'Stop'
# 从 Windows 凭证管理器读取 gh CLI OAuth 令牌,写入临时文件供 git askpass 使用
Add-Type -Namespace Win32.Native -Name Cred -MemberDefinition @'
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string Target, int Type, int Flags, out IntPtr Credential);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr Buffer);
'@

$target = 'GitHub - https://api.github.com/Tuair-1'
$cred = [IntPtr]::Zero
if (-not [Win32.Native.Cred]::CredRead($target, 1, 0, [ref]$cred)) {
    throw "CredRead failed, win32 error: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
    $size = [System.Runtime.InteropServices.Marshal]::ReadInt32($cred, 32)
    $blobPtr = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($cred, 40)
    $bytes = New-Object byte[] $size
    [System.Runtime.InteropServices.Marshal]::Copy($blobPtr, $bytes, 0, $size)
    $token = [System.Text.Encoding]::UTF8.GetString($bytes).Trim([char]0, [char]10, [char]13, ' ')
} finally {
    [Win32.Native.Cred]::CredFree($cred) | Out-Null
}
$file = Join-Path $env:TEMP 'petropulse_gh_token.txt'
[System.IO.File]::WriteAllText($file, $token, [System.Text.Encoding]::ASCII)
Write-Output ("TOKEN_OK len=" + $token.Length)
