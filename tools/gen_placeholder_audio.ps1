# 產生 4 個佔位音效 WAV（16-bit PCM, 單聲道, 44100Hz）。
# 這些只是接線用的佔位音，之後換正式素材只需替換檔案、重綁 AudioClip。
# 用法：pwsh tools/gen_placeholder_audio.ps1

param(
    [string]$OutDir = "$PSScriptRoot/../assets/audio"
)

$ErrorActionPreference = 'Stop'
$sampleRate = 44100

function Write-Wav {
    param(
        [string]$Path,
        [float[]]$Samples
    )
    $byteRate = $sampleRate * 2       # 單聲道 * 16bit = 2 bytes/sample
    $dataLen = $Samples.Length * 2
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    # RIFF header
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
    $bw.Write([int](36 + $dataLen))
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes('WAVE'))
    # fmt chunk
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes('fmt '))
    $bw.Write([int]16)
    $bw.Write([int16]1)               # PCM
    $bw.Write([int16]1)               # 單聲道
    $bw.Write([int]$sampleRate)
    $bw.Write([int]$byteRate)
    $bw.Write([int16]2)               # block align
    $bw.Write([int16]16)              # bits per sample
    # data chunk
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
    $bw.Write([int]$dataLen)
    foreach ($s in $Samples) {
        $v = [int]([math]::Max(-1.0, [math]::Min(1.0, $s)) * 32767)
        $bw.Write([int16]$v)
    }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
    $bw.Dispose(); $ms.Dispose()
    Write-Output "wrote $Path ($($Samples.Length) samples)"
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$OutDir = (Resolve-Path $OutDir).Path

# 1) spin：短 whoosh（白噪 + 下滑包絡），約 0.35s
$rnd = New-Object System.Random 1
$n = [int]($sampleRate * 0.35)
$spin = New-Object 'float[]' $n
for ($i = 0; $i -lt $n; $i++) {
    $t = $i / $sampleRate
    $env = [math]::Exp(-$t * 6.0)
    $noise = ($rnd.NextDouble() * 2 - 1)
    $tone = [math]::Sin(2 * [math]::PI * (600 - 900 * $t) * $t)
    $spin[$i] = [float](($noise * 0.5 + $tone * 0.5) * $env * 0.6)
}
Write-Wav -Path (Join-Path $OutDir 'spin.wav') -Samples $spin

# 2) stop：click（極短脈衝 + 快速衰減），約 0.08s
$n = [int]($sampleRate * 0.08)
$stop = New-Object 'float[]' $n
for ($i = 0; $i -lt $n; $i++) {
    $t = $i / $sampleRate
    $env = [math]::Exp(-$t * 60.0)
    $tone = [math]::Sin(2 * [math]::PI * 1200 * $t)
    $stop[$i] = [float]($tone * $env * 0.7)
}
Write-Wav -Path (Join-Path $OutDir 'stop.wav') -Samples $stop

# 3) win：上揚叮（兩個音高漸強），約 0.5s
$n = [int]($sampleRate * 0.5)
$win = New-Object 'float[]' $n
for ($i = 0; $i -lt $n; $i++) {
    $t = $i / $sampleRate
    $env = [math]::Exp(-$t * 3.0)
    $f = 660 + 440 * $t              # 往上滑
    $tone = [math]::Sin(2 * [math]::PI * $f * $t) + 0.5 * [math]::Sin(2 * [math]::PI * $f * 2 * $t)
    $win[$i] = [float]($tone * $env * 0.4)
}
Write-Wav -Path (Join-Path $OutDir 'win.wav') -Samples $win

# 4) bgm：一小段可 loop 的和弦墊底，約 2.0s（頭尾淡入淡出讓接點平滑）
$n = [int]($sampleRate * 2.0)
$bgm = New-Object 'float[]' $n
$freqs = @(220.0, 277.18, 329.63)   # A3 + C#4 + E4 大三和弦
for ($i = 0; $i -lt $n; $i++) {
    $t = $i / $sampleRate
    $s = 0.0
    foreach ($f in $freqs) { $s += [math]::Sin(2 * [math]::PI * $f * $t) }
    $s = $s / $freqs.Count
    # 頭尾各 0.1s 淡入淡出，讓 loop 接點不爆音
    $fade = 1.0
    $fadeLen = $sampleRate * 0.1
    if ($i -lt $fadeLen) { $fade = $i / $fadeLen }
    elseif ($i -gt ($n - $fadeLen)) { $fade = ($n - $i) / $fadeLen }
    $bgm[$i] = [float]($s * 0.25 * $fade)
}
Write-Wav -Path (Join-Path $OutDir 'bgm.wav') -Samples $bgm

Write-Output "done."
