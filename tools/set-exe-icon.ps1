<#
    Injects an .ico into the icon resources of a Windows executable.

    pkg (and Node's SEA) do not embed an icon, so the built exe keeps the
    generic Node/pkg mark. This script replaces the RT_GROUP_ICON resource
    with the images from the given .ico using the Win32 resource API — the
    same thing rcedit does, without any dependency.

      powershell -File tools\set-exe-icon.ps1 -Exe release\FileBridge.exe -Ico build\FileBridge.ico
#>
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Ico
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace FbIcon -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);

[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern bool UpdateResource(System.IntPtr hUpdate, System.IntPtr lpType, System.IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);

[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern bool EndUpdateResource(System.IntPtr hUpdate, bool fDiscard);
'@

$RT_ICON = [IntPtr]3        # one image
$RT_GROUP_ICON = [IntPtr]14 # the directory that Windows actually shows
$GROUP_ID = 1               # overwrite the default icon group
$FIRST_IMAGE_ID = 101       # keep clear of whatever pkg left behind

$bytes = [System.IO.File]::ReadAllBytes($Ico)
$reserved = [BitConverter]::ToUInt16($bytes, 0)
$type = [BitConverter]::ToUInt16($bytes, 2)
$count = [BitConverter]::ToUInt16($bytes, 4)
if ($reserved -ne 0 -or $type -ne 1) { throw "not an .ico file: $Ico" }

$images = @()
for ($i = 0; $i -lt $count; $i++) {
  $o = 6 + $i * 16
  $size = [BitConverter]::ToUInt32($bytes, $o + 8)
  $offset = [BitConverter]::ToUInt32($bytes, $o + 12)
  $data = New-Object byte[] $size
  [Array]::Copy($bytes, $offset, $data, 0, $size)
  $images += [pscustomobject]@{
    Width = $bytes[$o]; Height = $bytes[$o + 1]; Colors = $bytes[$o + 2]
    Reserved = $bytes[$o + 3]
    Planes = [BitConverter]::ToUInt16($bytes, $o + 4)
    Bpp = [BitConverter]::ToUInt16($bytes, $o + 6)
    Size = $size
    Data = $data
  }
}

$h = [FbIcon.Native]::BeginUpdateResource($Exe, $false)
if ($h -eq [IntPtr]::Zero) {
  throw "BeginUpdateResource failed (Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
}

try {
  for ($i = 0; $i -lt $images.Count; $i++) {
    $img = $images[$i]
    $id = $FIRST_IMAGE_ID + $i
    $ok = [FbIcon.Native]::UpdateResource($h, $RT_ICON, [IntPtr]$id, 0, $img.Data, [uint32]$img.Size)
    if (-not $ok) { throw "UpdateResource(RT_ICON $id) failed" }
  }

  # GRPICONDIR: header + one 14-byte GRPICONDIRENTRY per image
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([uint16]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]$images.Count)
  for ($i = 0; $i -lt $images.Count; $i++) {
    $img = $images[$i]
    $bw.Write([byte]$img.Width)
    $bw.Write([byte]$img.Height)
    $bw.Write([byte]$img.Colors)
    $bw.Write([byte]$img.Reserved)
    $bw.Write([uint16]$img.Planes)
    $bw.Write([uint16]$img.Bpp)
    $bw.Write([uint32]$img.Size)
    $bw.Write([uint16]($FIRST_IMAGE_ID + $i))
  }
  $bw.Flush()
  $group = $ms.ToArray()

  $ok = [FbIcon.Native]::UpdateResource($h, $RT_GROUP_ICON, [IntPtr]$GROUP_ID, 0, $group, [uint32]$group.Length)
  if (-not $ok) { throw 'UpdateResource(RT_GROUP_ICON) failed' }
}
finally {
  $committed = [FbIcon.Native]::EndUpdateResource($h, $false)
  if (-not $committed) { throw 'EndUpdateResource failed' }
}

Write-Output ("icon embedded: {0} image(s) -> {1}" -f $images.Count, $Exe)