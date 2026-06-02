$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\ACR-Agent代码助手.lnk')
$lnk.TargetPath = 'D:\我的工作台\03-AI工具\agent-code-reporter\node_modules\electron\dist\electron.exe'
$lnk.Arguments = 'D:\我的工作台\03-AI工具\agent-code-reporter'
$lnk.WorkingDirectory = 'D:\我的工作台\03-AI工具\agent-code-reporter'
$lnk.IconLocation = 'D:\我的工作台\03-AI工具\agent-code-reporter\icon.ico'
$lnk.Description = 'ACR-Agent代码助手 - 实时代码展示桌面工具'
$lnk.Save()
Write-Host 'OK' $lnk.FullName
