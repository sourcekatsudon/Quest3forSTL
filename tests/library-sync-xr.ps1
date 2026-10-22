. "$PSScriptRoot/quest-v2-lib.ps1"
$library=Find '^RoomLibrary$';$fixture=Get-Content artifacts/library-sync-model.json -Raw|ConvertFrom-Json
function LibraryState {Values (Iw 'ecs' 'query' @{entityIndex=$library;components=@('RoomLibraryState')}) 'RoomLibraryState'}
function WaitLibrary($Status){foreach($attempt in 1..10){$current=LibraryState;if($current.status-eq$Status){return $current};Start-Sleep -Milliseconds 200};return $current}
$null=Iw 'xr' 'set-input-mode' @{mode='controller'}
MoveXR .25 1.5 -.4
$null=& node $cli browser run tests/library-sync-recover.mjs --timeout 20000
Click (Point $library '#Refresh')
$before=WaitLibrary 'ready'
Check 'new PC upload reaches the first page of the XR library' ($before.status-eq'ready'-and$before.page-eq 0)
$null=& node $cli browser run tests/library-sync-outage.mjs --timeout 20000
Click (Point $library '#Refresh')
$failed=WaitLibrary 'error'
Check 'native refresh reports a connection failure without erasing the library' ($failed.status-eq'error'-and$failed.count-eq$before.count)
$null=& node $cli browser run tests/library-sync-recover.mjs --timeout 20000
Click (Point $library '#Refresh')
$recovered=WaitLibrary 'ready'
Check 'native refresh retries immediately and recovers' ($recovered.status-eq'ready'-and$recovered.count-eq$before.count)
Click (Point $library '#Item0' 0)
Click (Point $library '#Add')
$model=Find "^STL $($fixture.name)$"
$room=Values (State) 'RoomModel'
Check 'native thumbnail selection and Add place the newly uploaded model' ($room.assetId-eq$fixture.id)
@{passed=$true;checks=$checks.ToArray();before=$before;failure=$failed;recovered=$recovered;model=$model}|ConvertTo-Json -Depth 10|Set-Content artifacts/library-sync-xr-results.json
& node $cli browser screenshot --output-file artifacts/library-sync-final.png | Out-Null
