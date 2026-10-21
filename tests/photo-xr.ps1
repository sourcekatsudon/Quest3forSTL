. (Join-Path $PSScriptRoot 'quest-v2-lib.ps1')
$panel=Find '^RoomControls$';$poses=Get-Content artifacts/photo-input-poses.json -Raw|ConvertFrom-Json -AsHashtable
function PhotoState {Values (Iw 'ecs' 'query' @{entityIndex=$panel;components=@('RoomPhotoCapture')}) 'RoomPhotoCapture'}
function PhotoCount {return (Invoke-RestMethod https://localhost:8081/api/photos -SkipCertificateCheck).photos.Count}
function ReleaseFrame {$null=Iw 'xr' 'set-transform' @{device='hand-left';position=@{x=-.6;y=1.5;z=-.4};orientation=@{x=0;y=0;z=0;w=1}};Start-Sleep -Milliseconds 500}
function HoldFrame {$null=Iw 'xr' 'set-device-state' @{state=@{inputMode='hand';hands=$poses}}}
$initial=PhotoCount
ReleaseFrame;HoldFrame;Start-Sleep -Milliseconds 1700
Check 'tracked rectangle gesture saves one photo' ((PhotoState).stage-eq'saved'-and(PhotoCount)-eq($initial+1))
Start-Sleep -Milliseconds 1400
Check 'holding the rectangle does not burst-shoot' ((PhotoCount)-eq($initial+1))
ReleaseFrame;HoldFrame
$null=Iw 'xr' 'set-input-mode' @{mode='controller'}
Start-Sleep -Milliseconds 1000
Check 'controller switching cancels a partial frame gesture' ((PhotoCount)-eq($initial+1))
$null=Iw 'xr' 'set-input-mode' @{mode='hand'};ReleaseFrame
$null=& node $cli browser run tests/photo-outage.mjs --timeout 30000
HoldFrame;Start-Sleep -Milliseconds 1800
Check 'upload failure retains a retryable photo' ((PhotoState).stage-eq'error'-and(PhotoCount)-eq($initial+1))
ReleaseFrame
$latest=(PhotoState).photoId
Invoke-WebRequest "https://localhost:8081/api/photos?id=$latest" -SkipCertificateCheck -OutFile artifacts/photo-capture.jpg
@{passed=$true;checks=$checks;runtime='IWER Meta Quest 3';physicalQuestTested=$false}|ConvertTo-Json -Depth 4|Set-Content artifacts/photo-xr-results.json
