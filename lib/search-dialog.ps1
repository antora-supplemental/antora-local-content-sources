# Windows desktop path choice and search progress for antora-local-content-sources.
# Row actions: Download, Move, Local.
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

    $grid = New-Object System.Windows.Forms.DataGridView
    $grid.Name = 'sources'
    $grid.Dock = 'Fill'
    $grid.AllowUserToAddRows = $false
    $grid.AllowUserToDeleteRows = $false
    $grid.RowHeadersVisible = $false
    $grid.SelectionMode = 'FullRowSelect'
    $grid.MultiSelect = $false
    $grid.AutoGenerateColumns = $false
    $grid.BackgroundColor = [System.Drawing.Color]::White
    $grid.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $colUrl = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colUrl.Name = 'url'
    $colUrl.HeaderText = 'Remote URL'
    $colUrl.ReadOnly = $true
    $colUrl.AutoSizeMode = 'Fill'
    $colStatus = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colStatus.Name = 'status'
    $colStatus.HeaderText = 'Status'
    $colStatus.ReadOnly = $true
    $colStatus.Width = 140
    $colAction = New-Object System.Windows.Forms.DataGridViewButtonColumn
    $colAction.Name = 'action'
    $colAction.HeaderText = 'Action'
    $colAction.Width = 120
    $colAction.UseColumnTextForButtonValue = $false
    [void]$grid.Columns.Add($colUrl)
    [void]$grid.Columns.Add($colStatus)
    [void]$grid.Columns.Add($colAction)

    if ($null -ne $req.sources) {
        foreach ($src in @($req.sources)) {
            $initial = [string]$src.status
            if (-not $initial) { $initial = 'waiting' }
            $label = [string]$src.button
            if (-not $label) { $label = 'Download' }
            $index = $grid.Rows.Add([string]$src.url, $initial, $label)
            $grid.Rows[$index].Tag = [string]$src.key
            if ($label -eq 'Local') {
                $grid.Rows[$index].Cells[2].ReadOnly = $true
            }
        }
    }

    function Set-SourceStatus ([string] $Url, [string] $Status, [string] $Button) {
        foreach ($row in $grid.Rows) {
            $display = [string]$row.Cells[0].Value
            $key = [string]$row.Tag
            if ($display -eq $Url -or ($key -and $key -eq $Url)) {
                $row.Cells[1].Value = $Status
                if ($Button) {
                    $row.Cells[2].Value = $Button
                    $row.Cells[2].ReadOnly = ($Button -eq 'Local')
                }
            }
        }
    }

    function Invoke-Acquire ([string] $Url) {
        if (-not $req.nodePath -or -not $req.acquireScript) { return }
        $reqPath = [string]$req.acquireLog + '.' + [guid]::NewGuid().ToString('n') + '.json'
        $body = '{"url":"' + ($Url.Replace('\', '\\').Replace('"', '\"')) + '","playbookDir":"' + ([string]$req.playbookDir).Replace('\', '\\').Replace('"', '\"') + '","antoraContentCache":"' + ([string]$req.antoraContentCache).Replace('\', '\\').Replace('"', '\"') + '","log":"' + ([string]$req.acquireLog).Replace('\', '\\').Replace('"', '\"') + '"}'
        Write-TextFile $reqPath $body
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = [string]$req.nodePath
        $psi.Arguments = '"' + [string]$req.acquireScript + '" "' + $reqPath + '"'
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $proc = [System.Diagnostics.Process]::Start($psi)
        $out = $proc.StandardOutput.ReadToEnd()
        $errText = $proc.StandardError.ReadToEnd()
        $proc.WaitForExit()
        if (-not $out) {
            Set-SourceStatus $Url 'error' 'Download'
            Add-LogLine ('acquire failed ' + $errText) $null
            return
        }
        try { $result = $out | ConvertFrom-Json } catch {
            Set-SourceStatus $Url 'error' 'Download'
            Add-LogLine 'acquire failed' $null
            return
        }
        if ($result.ok) {
            Set-SourceStatus $Url 'validated' 'Local'
            Add-LogLine ('local checkout ' + [string]$result.path) $null
        } else {
            Set-SourceStatus $Url 'error' 'Download'
            Add-LogLine ([string]$result.error) $null
        }
    }

    $grid.Add_CellContentClick({
        $event = $args[1]
        if ($null -eq $event -or $event.ColumnIndex -ne 2) { return }
        $row = $grid.Rows[$event.RowIndex]
        $label = [string]$row.Cells[2].Value
        if ($label -eq 'Local') { return }
        $url = [string]$row.Cells[0].Value
        $row.Cells[1].Value = 'working'
        Invoke-Acquire $url
    })

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

    # Last added docks first: log, then the working label, then the header.
    $form.Controls.Add($grid)
    $form.Controls.Add($header)
    $form.Controls.Add($workLabel)
    $form.Controls.Add($logBox)

    $form.TopMost = $true

    function Write-Decision ([string] $Value) {
        if ($script:decided) { return }
        $script:decided = $true
        $tmp = $Decision + '.tmp'
        Write-TextFile $tmp $Value
        [System.IO.File]::Copy($tmp, $Decision, $true)
        Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    }

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
                Set-SourceStatus ([string]$ev.url) ([string]$ev.status) ([string]$ev.button)
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

    if ($Mode -eq 'choose') {
        $pick = New-Object System.Windows.Forms.Form
        $pick.Text = 'Antora Local content search'
        $pick.StartPosition = 'CenterScreen'
        $pick.Size = New-Object System.Drawing.Size(680, 320)
        $pick.Font = New-Object System.Drawing.Font('Segoe UI', 10)
        $pick.BackColor = [System.Drawing.Color]::White
        $prompt = New-Object System.Windows.Forms.Label
        $prompt.Text = 'Where should this build read the docs?'
        $prompt.AutoSize = $true
        $prompt.Location = New-Object System.Drawing.Point(24, 24)
        $prompt.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
        $pick.Controls.Add($prompt)
        $note = New-Object System.Windows.Forms.Label
        $note.Text = [string]$req.bypass
        $note.MaximumSize = New-Object System.Drawing.Size(620, 0)
        $note.AutoSize = $true
        $note.Location = New-Object System.Drawing.Point(24, 72)
        $pick.Controls.Add($note)
        $localBtn = New-Object System.Windows.Forms.Button
        $localBtn.Text = 'Use local docs'
        $localBtn.Size = New-Object System.Drawing.Size(170, 36)
        $localBtn.Location = New-Object System.Drawing.Point(24, 220)
        $remoteBtn = New-Object System.Windows.Forms.Button
        $remoteBtn.Text = 'Use remote docs'
        $remoteBtn.Size = New-Object System.Drawing.Size(170, 36)
        $remoteBtn.Location = New-Object System.Drawing.Point(210, 220)
        $pick.Controls.Add($localBtn)
        $pick.Controls.Add($remoteBtn)
        $localBtn.Add_Click({
            Write-Decision 'local'
            $pick.Close()
        })
        $remoteBtn.Add_Click({
            Write-Decision 'remote'
            $pick.Close()
        })
        $pick.Add_FormClosing({
            if (-not $script:decided) { Write-Decision 'remote' }
        })
        Write-TextFile $Ready 'ready'
        [System.Windows.Forms.Application]::Run($pick)
        exit 0
    }

    $script:started = Get-Date
    $script:timer.Start()
    $form.Text = 'Antora Local content search'
    Write-TextFile $Ready 'ready'
    [System.Windows.Forms.Application]::Run($form)
} catch {
    try { Write-TextFile $ErrorLog ([string]$_.Exception.Message) } catch {}
    exit 1
}
