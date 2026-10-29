param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
# Windows Installer COM 以只读方式打开数据库；不执行安装动作、不创建 MSI 产品登记。
$installer=New-Object -ComObject WindowsInstaller.Installer
$database=$installer.OpenDatabase([IO.Path]::GetFullPath($Path),0)
function Query([string]$sql,[int]$columns){
    $view=$database.OpenView($sql);$null=$view.Execute()
    try{while($record=$view.Fetch()){
        try{$row=@();for($i=1;$i -le $columns;$i++){$row+=,[string]$record.StringData($i)};Write-Output ([pscustomobject]@{cells=$row})}finally{$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($record)}
    }}finally{$null=$view.Close();$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($view)}
}
try{
    $properties=@{};foreach($row in Query 'SELECT `Property`,`Value` FROM `Property`' 2){$properties[$row.cells[0]]=$row.cells[1]}
    $files=@(Query 'SELECT `File`,`FileName`,`Version` FROM `File`' 3)
    $registry=@(Query 'SELECT `Root`,`Key`,`Name` FROM `Registry`' 3)
    $summary=$database.SummaryInformation(0)
    try{$template=$summary.Property(7)}finally{$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($summary)}
    $data=@{properties=$properties;files=$files;registry=$registry;template=$template}
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),($data|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
}finally{$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($database);$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($installer)}
