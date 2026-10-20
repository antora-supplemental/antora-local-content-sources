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

    $form = New-Object System.Windows.Forms.Form
    $form.Text = [string]$req.title
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(720, 640)
    $form.MinimumSize = New-Object System.Drawing.Size(560, 420)
    $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $form.BackColor = [System.Drawing.Color]::White

    $confirmPanel = New-Object System.Windows.Forms.Panel
    $confirmPanel.Dock = 'Fill'
    $confirmPanel.AutoScroll = $true

    $script:y = 16
    function Add-Block ([string] $Heading, [string] $Body, [bool] $Muted) {
        $h = New-Object System.Windows.Forms.Label
        $h.Text = $Heading
        $h.AutoSize = $true
        $h.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
        if ($Muted) {
            $h.ForeColor = [System.Drawing.Color]::FromArgb(90, 98, 110)
        } else {
            $h.ForeColor = [System.Drawing.Color]::FromArgb(20, 78, 122)
        }
        $h.Location = New-Object System.Drawing.Point(16, $script:y)
        $confirmPanel.Controls.Add($h)
        $script:y += 22

        $b = New-Object System.Windows.Forms.Label
        $b.Text = $Body
        $b.AutoSize = $true
        $b.MaximumSize = New-Object System.Drawing.Size(640, 0)
        $b.Location = New-Object System.Drawing.Point(16, $script:y)
        if ($Muted) { $b.ForeColor = [System.Drawing.Color]::FromArgb(70, 78, 90) }
        $confirmPanel.Controls.Add($b)
        $height = $b.PreferredHeight
        if ($height -lt 16) { $height = 32 }
        $script:y += ($height + 16)
    }

    $title = New-Object System.Windows.Forms.Label
    $title.Text = [string]$req.heading
    $title.AutoSize = $true
    $title.MaximumSize = New-Object System.Drawing.Size(640, 0)
    $title.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
    $title.Location = New-Object System.Drawing.Point(16, $script:y)
    $confirmPanel.Controls.Add($title)
    $script:y += ($title.PreferredHeight + 18)

    Add-Block 'Why' ([string]$req.why) $false
    Add-Block 'What' ([string]$req.what) $false
    Add-Block 'How' ([string]$req.how) $false
    Add-Block 'Scripting bypass' ([string]$req.bypass) $true

    $buttonPanel = New-Object System.Windows.Forms.Panel
    $buttonPanel.Dock = 'Bottom'
    $buttonPanel.Height = 72

    $question = New-Object System.Windows.Forms.Label
    $question.Text = [string]$req.question
    $question.AutoSize = $true
    $question.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $question.Location = New-Object System.Drawing.Point(16, 24)
    $buttonPanel.Controls.Add($question)

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
        $yesBtn.Top = 18
        $noBtn.Top = 18
    })

    $progressPanel = New-Object System.Windows.Forms.Panel
    $progressPanel.Dock = 'Fill'
    $progressPanel.Visible = $false

    $status = New-Object System.Windows.Forms.Label
    $status.Text = 'Working'
    $status.Dock = 'Top'
    $status.Height = 36
    $status.Padding = New-Object System.Windows.Forms.Padding(16, 10, 16, 0)
    $status.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $progressPanel.Controls.Add($status)

    $logBox = New-Object System.Windows.Forms.TextBox
    $logBox.Multiline = $true
    $logBox.ReadOnly = $true
    $logBox.ScrollBars = 'Vertical'
    $logBox.Dock = 'Fill'
    $logBox.Font = New-Object System.Drawing.Font('Consolas', 10)
    $logBox.BackColor = [System.Drawing.Color]::FromArgb(248, 249, 252)
    $logBox.WordWrap = $true
    $progressPanel.Controls.Add($logBox)
    $logBox.BringToFront()

    $form.Controls.Add($buttonPanel)
    $form.Controls.Add($confirmPanel)
    $form.Controls.Add($progressPanel)

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
        $confirmPanel.Visible = $false
        $buttonPanel.Visible = $false
        $progressPanel.Visible = $true
        $form.Text = 'Antora Local content search'
        $form.AcceptButton = $null
        $form.CancelButton = $null
        $form.TopMost = $false
        $script:started = Get-Date
        $script:timer.Start()
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

    $script:timer = New-Object System.Windows.Forms.Timer
    $script:timer.Interval = 200
    $script:timer.Add_Tick({
        if ($script:finished) {
            $status.Text = 'Finished. You can close this window. The build does not wait on it.'
        } else {
            $elapsed = (Get-Date) - $script:started
            $status.Text = ('Working  {0:mm\:ss}' -f $elapsed)
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
            if ($kind -eq 'done') { $script:finished = $true }
            $logBox.AppendText(('{0}  {1}  {2}' -f $stamp, $kind, [string]$ev.text) + "`r`n")
        }
    })

    if ($Mode -eq 'progress') {
        $confirmPanel.Visible = $false
        $buttonPanel.Visible = $false
        $progressPanel.Visible = $true
        $form.Text = 'Antora Local content search'
        $form.AcceptButton = $null
        $form.CancelButton = $null
        $form.TopMost = $false
        $script:started = Get-Date
        $script:timer.Start()
    }

    Write-TextFile $Ready 'ready'
    [System.Windows.Forms.Application]::Run($form)
} catch {
    try { Write-TextFile $ErrorLog ([string]$_.Exception.Message) } catch {}
    exit 1
}
