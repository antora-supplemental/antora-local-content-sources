# Windows desktop confirm + progress for antora-local-content-sources.
# Launched hidden (wscript window style 0). No console. ASCII only.
param(
    [Parameter(Mandatory = $true)][string] $Request,
    [Parameter(Mandatory = $true)][string] $Decision,
    [Parameter(Mandatory = $true)][string] $Progress,
    [Parameter(Mandatory = $true)][string] $Ready,
    [Parameter(Mandatory = $true)][string] $ErrorLog,
    [Parameter(Mandatory = $true)][string] $PidFile,
    [ValidateSet('confirm', 'progress')][string] $Mode = 'confirm'
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Write-TextFile ([string] $Path, [string] $Value) {
    [System.IO.File]::WriteAllText($Path, $Value, $utf8)
}

try {
    Write-TextFile $PidFile ([string]$PID)
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    [System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

    $req = [System.IO.File]::ReadAllText($Request, $utf8) | ConvertFrom-Json
    $script:decided = $false
    $script:offset = 0
    $script:finished = $false
    $script:started = Get-Date
    $script:progressing = $false

    $form = New-Object System.Windows.Forms.Form
    $form.Text = [string]$req.title
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(960, 760)
    $form.MinimumSize = New-Object System.Drawing.Size(800, 640)
    $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $form.BackColor = [System.Drawing.Color]::White

    $header = New-Object System.Windows.Forms.Panel
    $header.Dock = 'Top'
    $header.AutoScroll = $false

    $script:y = 16
    function Add-WrapLabel ([string] $Text, [System.Drawing.Font] $Font, [System.Drawing.Color] $Color) {
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $Text
        $label.AutoSize = $true
        $label.MaximumSize = New-Object System.Drawing.Size(900, 0)
        $label.Font = $Font
        $label.ForeColor = $Color
        $label.Location = New-Object System.Drawing.Point(16, $script:y)
        $header.Controls.Add($label)
        $script:y += ($label.PreferredHeight + 12)
        return $label
    }

    $ink = [System.Drawing.Color]::FromArgb(24, 28, 34)
    $muted = [System.Drawing.Color]::FromArgb(70, 78, 90)
    $accent = [System.Drawing.Color]::FromArgb(20, 78, 122)
    Add-WrapLabel ([string]$req.heading) (New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)) $ink | Out-Null
    Add-WrapLabel ([string]$req.lead) (New-Object System.Drawing.Font('Segoe UI', 10)) $ink | Out-Null
    Add-WrapLabel ([string]$req.detail) (New-Object System.Drawing.Font('Segoe UI', 10)) $ink | Out-Null
    Add-WrapLabel 'Scripting bypass' (New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)) $accent | Out-Null
    Add-WrapLabel ([string]$req.bypass) (New-Object System.Drawing.Font('Segoe UI', 9)) $muted | Out-Null
    $header.Height = $script:y + 4

    $list = New-Object System.Windows.Forms.ListView
    $list.Name = 'sources'
    $list.View = [System.Windows.Forms.View]::Details
    $list.FullRowSelect = $true
    $list.GridLines = $true
    $list.HideSelection = $false
    $list.MultiSelect = $false
    $list.Dock = 'Fill'
    $list.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $list.HeaderStyle = 'Nonclickable'
    [void]$list.Columns.Add('Remote URL', 640)
    [void]$list.Columns.Add('Status', 160)

    if ($null -ne $req.sources) {
        foreach ($src in @($req.sources)) {
            $item = New-Object System.Windows.Forms.ListViewItem([string]$src.url)
            $item.Tag = [string]$src.key
            $initial = [string]$src.status
            if (-not $initial) { $initial = 'waiting' }
            [void]$item.SubItems.Add($initial)
            [void]$list.Items.Add($item)
        }
    }

    function Resize-SourceColumns {
        if ($list.Columns.Count -lt 2) { return }
        $statusWidth = 160
        $urlWidth = $list.ClientSize.Width - $statusWidth - 8
        if ($urlWidth -lt 280) { $urlWidth = 280 }
        $list.Columns[0].Width = $urlWidth
        $list.Columns[1].Width = $statusWidth
    }
    $list.Add_Resize({ Resize-SourceColumns })

    function Set-SourceStatus ([string] $Url, [string] $Status) {
        foreach ($item in $list.Items) {
            $display = [string]$item.Text
            $key = [string]$item.Tag
            if ($display -eq $Url -or ($key -and $key -eq $Url)) {
                if ($item.SubItems.Count -lt 2) {
                    [void]$item.SubItems.Add($Status)
                } else {
                    $item.SubItems[1].Text = $Status
                }
            }
        }
    }

    $workLabel = New-Object System.Windows.Forms.Label
    $workLabel.Text = ''
    $workLabel.Dock = 'Bottom'
    $workLabel.Height = 28
    $workLabel.Padding = New-Object System.Windows.Forms.Padding(16, 6, 16, 0)
    $workLabel.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)

    $logBox = New-Object System.Windows.Forms.RichTextBox
    $logBox.ReadOnly = $true
    $logBox.DetectUrls = $false
    $logBox.ScrollBars = 'Vertical'
    $logBox.Dock = 'Bottom'
    $logBox.Height = 170
    $logBox.Font = New-Object System.Drawing.Font('Consolas', 10)
    $logBox.BackColor = [System.Drawing.Color]::FromArgb(248, 249, 252)
    $logBox.WordWrap = $true
    $logBox.BorderStyle = 'FixedSingle'

    function Add-LogLine ([string] $Line, $Color) {
        $logBox.SelectionStart = $logBox.TextLength
        $logBox.SelectionLength = 0
        if ($null -eq $Color) {
            $logBox.SelectionColor = $logBox.ForeColor
        } else {
            $logBox.SelectionColor = $Color
        }
        $logBox.AppendText($Line + "`r`n")
        $logBox.SelectionStart = $logBox.TextLength
        $logBox.SelectionLength = 0
        $logBox.SelectionColor = $logBox.ForeColor
        $logBox.ScrollToCaret()
    }

    $buttonPanel = New-Object System.Windows.Forms.Panel
    $buttonPanel.Dock = 'Bottom'
    $buttonPanel.Height = 56

    $yesBtn = New-Object System.Windows.Forms.Button
    $yesBtn.Text = 'Yes'
    $yesBtn.Size = New-Object System.Drawing.Size(96, 32)
    $noBtn = New-Object System.Windows.Forms.Button
    $noBtn.Text = 'No'
    $noBtn.Size = New-Object System.Drawing.Size(96, 32)
    $buttonPanel.Controls.Add($yesBtn)
    $buttonPanel.Controls.Add($noBtn)
    $buttonPanel.Add_Resize({
        $noBtn.Left = $buttonPanel.ClientSize.Width - $noBtn.Width - 16
        $yesBtn.Left = $noBtn.Left - $yesBtn.Width - 12
        $yesBtn.Top = 12
        $noBtn.Top = 12
    })

    # Last added docks first: buttons, then log, then the working label, then the header.
    $form.Controls.Add($list)
    $form.Controls.Add($header)
    $form.Controls.Add($workLabel)
    $form.Controls.Add($logBox)
    $form.Controls.Add($buttonPanel)

    $form.AcceptButton = $yesBtn
    $form.CancelButton = $noBtn
    $form.TopMost = $true

    function Write-Decision ([string] $Value) {
        if ($script:decided) { return }
        $script:decided = $true
        $tmp = $Decision + '.tmp'
        Write-TextFile $tmp $Value
        [System.IO.File]::Copy($tmp, $Decision, $true)
        Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    }

    function Show-ProgressView {
        if ($script:progressing) { return }
        $script:progressing = $true
        $buttonPanel.Visible = $false
        $buttonPanel.Height = 0
        $form.Text = 'Antora Local content search'
        $form.AcceptButton = $null
        $form.CancelButton = $null
        $form.TopMost = $false
        $script:started = Get-Date
        $script:timer.Start()
        Resize-SourceColumns
    }

    $yesBtn.Add_Click({
        Show-ProgressView
        Write-Decision 'yes'
    })
    $noBtn.Add_Click({
        Write-Decision 'no'
        $form.Close()
    })
    $form.Add_FormClosing({
        if (-not $script:decided -and $Mode -eq 'confirm') {
            Write-Decision 'no'
        }
    })
    $form.Add_Shown({
        $form.Activate()
        Resize-SourceColumns
    })

    function Read-SharedText ([string] $Path) {
        if (-not (Test-Path -LiteralPath $Path)) { return '' }
        $fs = New-Object System.IO.FileStream(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
        try {
            $buf = New-Object byte[] $fs.Length
            $read = 0
            while ($read -lt $buf.Length) {
                $n = $fs.Read($buf, $read, $buf.Length - $read)
                if ($n -le 0) { break }
                $read += $n
            }
            if ($read -le $script:offset) { return '' }
            return $utf8.GetString($buf, $script:offset, $read - $script:offset)
        } finally {
            $fs.Dispose()
        }
    }

    $colorOk = [System.Drawing.Color]::FromArgb(0, 128, 0)
    $colorBad = [System.Drawing.Color]::FromArgb(178, 24, 24)

    $script:timer = New-Object System.Windows.Forms.Timer
    $script:timer.Interval = 200
    $script:timer.Add_Tick({
        if ($script:finished) {
            $workLabel.Text = 'Finished. You can close this window. The build does not wait on it.'
        } else {
            $elapsed = (Get-Date) - $script:started
            $workLabel.Text = ('Working  {0:mm\:ss}' -f $elapsed)
        }
        try {
            $chunk = Read-SharedText $Progress
        } catch {
            return
        }
        if (-not $chunk) { return }
        $lines = @($chunk -split "`n")
        $consumed = $utf8.GetByteCount($chunk)
        if (-not $chunk.EndsWith("`n")) {
            if ($lines.Count -le 1) { return }
            $partial = [string]$lines[-1]
            $lines = @($lines[0..($lines.Count - 2)])
            $consumed -= $utf8.GetByteCount($partial)
        }
        $script:offset += $consumed
        foreach ($line in $lines) {
            $trim = $line.Trim()
            if (-not $trim) { continue }
            try { $ev = $trim | ConvertFrom-Json } catch { continue }
            $stamp = Get-Date -Format 'HH:mm:ss'
            $kind = [string]$ev.type
            if ($kind -eq 'source') {
                Set-SourceStatus ([string]$ev.url) ([string]$ev.status)
                Add-LogLine ('{0}  {1}  {2}  {3}' -f $stamp, $kind, [string]$ev.url, [string]$ev.status) $null
                continue
            }
            if ($kind -eq 'done') {
                $script:finished = $true
                $ok = $true
                if ($null -ne $ev.ok) { $ok = [bool]$ev.ok }
                $msg = [string]$ev.text
                if (-not $msg) {
                    if ($ok) { $msg = 'Finished.' } else { $msg = 'Finished with errors.' }
                }
                $paint = $colorOk
                if (-not $ok) { $paint = $colorBad }
                Add-LogLine $msg $paint
                continue
            }
            Add-LogLine ('{0}  {1}  {2}' -f $stamp, $kind, [string]$ev.text) $null
        }
    })

    if ($Mode -eq 'progress') {
        Show-ProgressView
    }

    Write-TextFile $Ready 'ready'
    [System.Windows.Forms.Application]::Run($form)
} catch {
    try { Write-TextFile $ErrorLog ([string]$_.Exception.Message) } catch {}
    exit 1
}
