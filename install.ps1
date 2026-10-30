# One-command Windows installation. No elevation or execution-policy changes.
# Downloaded executable bytes and the orchestration helper are pinned by SHA256.
[CmdletBinding()]
param(
    [string]$CacheDirectory,
    [string]$Target,
    [string]$PermissionMode
)

function Assert-ComputerUsePath {
    param([Parameter(Mandatory=$true)][string]$Path, [switch]$Private)
    $full = [IO.Path]::GetFullPath($Path)
    if ($full.StartsWith('\\')) { throw 'Use a local folder for installation downloads.' }
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $trusted = @($me, 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Download path contains a link: $cursor" }
            if ($PSVersionTable.PSEdition -eq 'Core') { $acl = [IO.FileSystemAclExtensions]::GetAccessControl($item) }
            else { $acl = $item.GetAccessControl() }
            if ($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw "An unrelated account owns a download-path ancestor: $cursor" }
            $descriptor = New-Object Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(), 0)
            if ($null -eq $descriptor.DiscretionaryAcl) { throw "Download path has unrestricted permissions: $cursor" }
            $volume = $cursor.TrimEnd('\') -eq [IO.Path]::GetPathRoot($cursor).TrimEnd('\')
            [long]$unsafe = 0x40000 -bor 0x80000 -bor 0x40
            if (!$volume) { $unsafe = $unsafe -bor 0x10000 }
            if ($Private -and $cursor -eq $full) { $unsafe = $unsafe -bor 0x2 -bor 0x4 -bor 0x10 -bor 0x100 }
            foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
                if ($rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0 -or $trusted -contains $rule.IdentityReference.Value) { continue }
                [long]$rights = [long]$rule.FileSystemRights -band 0xffffffffL
                if (($rights -band 0x10000000) -ne 0) { $rights = $rights -bor 0x1f01ff }
                if (($rights -band 0x40000000) -ne 0) { $rights = $rights -bor 0x120116 }
                if (($rights -band $unsafe) -ne 0) { throw "Another account can replace the download path: $cursor. Parent permissions were not changed." }
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function New-ComputerUseStaging {
    param([string]$CacheDirectory)
    if (!$CacheDirectory) {
        $candidates = @()
        if (Test-Path -LiteralPath 'D:\') {
            $hasher = [Security.Cryptography.SHA256]::Create()
            try { $sidHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([Security.Principal.WindowsIdentity]::GetCurrent().User.Value))).Replace('-', '').ToLowerInvariant().Substring(0, 10) }
            finally { $hasher.Dispose() }
            $candidates += 'D:\AntigravityComputerUseBootstrap-' + $sidHash
        }
        $candidates += Join-Path ([Environment]::GetFolderPath('UserProfile')) '.gemini/AntigravityComputerUseBootstrap'
        $candidates += Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AntigravityComputerUseBootstrap'
        $rejected = @()
        foreach ($candidate in $candidates) {
            try { Assert-ComputerUsePath $candidate; $CacheDirectory = $candidate; break }
            catch { $rejected += ($candidate + ': ' + $_.Exception.Message) }
        }
        if (!$CacheDirectory) { throw ('No private download cache is available. ' + ($rejected -join ' | ')) }
    }
    $cache = [IO.Path]::GetFullPath($CacheDirectory)
    if ($cache.TrimEnd('\') -eq [IO.Path]::GetPathRoot($cache).TrimEnd('\')) { throw 'A drive root cannot be the download cache.' }
    Assert-ComputerUsePath $cache
    if (!(Test-Path -LiteralPath $cache)) {
        [void][IO.Directory]::CreateDirectory($cache)
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl.SetOwner($owner); $acl.SetAccessRuleProtection($true, $false)
        foreach ($sid in @($owner.Value, 'S-1-5-18', 'S-1-5-32-544')) {
            $identity = New-Object Security.Principal.SecurityIdentifier($sid)
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
            [void]$acl.AddAccessRule($rule)
        }
        $directory = New-Object IO.DirectoryInfo($cache)
        if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::SetAccessControl($directory, $acl) }
        else { $directory.SetAccessControl($acl) }
    }
    Assert-ComputerUsePath $cache -Private
    $stage = Join-Path $cache ('run-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($stage)
    Assert-ComputerUsePath $stage -Private
    return $stage
}

function Assert-ComputerUseHash {
    param([string]$File, [string]$Expected)
    $stream = [IO.File]::OpenRead($File)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
    if ($actual -ne $Expected) { throw 'Download verification failed. Nothing was installed.' }
}

function Expand-ComputerUseBundle {
    param([string]$Archive, [string]$Destination)
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $root = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('/', '\')
            $resolved = [IO.Path]::GetFullPath((Join-Path $Destination $name))
            if ($name.Contains(':') -or [IO.Path]::IsPathRooted($name) -or !$resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'The release archive contains an unsafe path.' }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
}

function Invoke-ComputerUseInstall {
    param([string]$CacheDirectory, [string]$Target, [string]$PermissionMode)
    if ($PermissionMode -and $PermissionMode -notin @('standalone', 'host-managed')) { throw 'Invalid permission mode.' }
    if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or ![Environment]::Is64BitOperatingSystem) { throw 'Computer Use currently requires Windows x64.' }
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $stage = New-ComputerUseStaging $CacheDirectory
    $completed = $false
    $oldTls = [Net.ServicePointManager]::SecurityProtocol
    try {
        [Net.ServicePointManager]::SecurityProtocol = $oldTls -bor [Net.SecurityProtocolType]::Tls12
        Write-Host 'Installing Computer Use for Antigravity...' -ForegroundColor Cyan
        $archive = Join-Path $stage 'windows.zip'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/shayann07/antigravity-computer-use/releases/download/v0.3.0-beta.4/AntigravityComputerUse-0.3.0-beta.4-windows-x64.zip' -OutFile $archive
        $checksums = Join-Path $stage 'SHA256SUMS.txt'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/shayann07/antigravity-computer-use/releases/download/v0.3.0-beta.4/SHA256SUMS.txt' -OutFile $checksums
        $archiveName = 'AntigravityComputerUse-0.3.0-beta.4-windows-x64.zip'
        $checksumLine = Get-Content -LiteralPath $checksums | Where-Object { $_ -match [Regex]::Escape($archiveName) } | Select-Object -First 1
        if (!$checksumLine) { throw 'The release checksums do not contain the Windows archive.' }
        $expectedArchiveHash = ($checksumLine -split '\s+')[0]
        Assert-ComputerUseHash $archive $expectedArchiveHash
        $helper = Join-Path $stage 'quick-install.mjs'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/shayann07/antigravity-computer-use/4335f06a56d5bba0ba039ca887f7103a9210fe11/scripts/quick-install.mjs' -OutFile $helper
        Assert-ComputerUseHash $helper '4f2548620e136c7c84ea39b348a279ab611f302c9e53aa9d03d24553d1fc0889'
        $expanded = Join-Path $stage 'payload'
        Expand-ComputerUseBundle $archive $expanded
        $bundle = Join-Path $expanded 'AntigravityComputerUse-windows-x64'
        $arguments = @($helper, '--bundle', $bundle)
        if ($Target) { $arguments += @('--target', [IO.Path]::GetFullPath($Target)) }
        if ($PermissionMode) { $arguments += @('--permission-mode', $PermissionMode) }
        $reply = & (Join-Path $bundle 'node.exe') @arguments
        if ($LASTEXITCODE -ne 0) { throw 'Installation did not finish. Your existing configuration was not reset; inspect the error above.' }
        $result = ($reply -join "`n") | ConvertFrom-Json
        if (!$result.ok) { throw 'The installer did not report a verified success.' }
        Write-Host 'Ready. In Antigravity, type /computer-use and describe your task.' -ForegroundColor Green
        Write-Host 'Background startup is enabled. Your existing settings and emergency Stop are preserved.'
        $completed = $true
        return $result
    } finally {
        [Net.ServicePointManager]::SecurityProtocol = $oldTls
        if ($completed) {
            try {
                $absoluteStage = [IO.Path]::GetFullPath($stage).TrimEnd('\')
                $cacheRoot = [IO.Path]::GetDirectoryName($absoluteStage)
                if ([IO.Path]::GetFileName($absoluteStage) -notmatch '^run-[a-f0-9]{32}$' -or !$absoluteStage.StartsWith($cacheRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected download cleanup path.' }
                Assert-ComputerUsePath $absoluteStage -Private
                Remove-Item -LiteralPath $absoluteStage -Recurse -Force -ErrorAction Stop
                if ([IO.Path]::GetFileName($cacheRoot) -match '^AntigravityComputerUseBootstrap-[a-f0-9]{10}$' -and [IO.Directory]::GetFileSystemEntries($cacheRoot).Length -eq 0) { [IO.Directory]::Delete($cacheRoot, $false) }
            } catch { Write-Warning ('Installation succeeded; cached downloads could not be removed: ' + $_.Exception.Message) }
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { $null = Invoke-ComputerUseInstall -CacheDirectory $CacheDirectory -Target $Target -PermissionMode $PermissionMode }
    catch { Write-Error $_; throw }
}
