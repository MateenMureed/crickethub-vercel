$ErrorActionPreference = 'Stop'
$base = 'https://cricket-android.azurewebsites.net/api'

function Api {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 20
    return Invoke-RestMethod -Uri ($base + $Path) -Method $Method -ContentType 'application/json' -Body $json -TimeoutSec 60
  }

  return Invoke-RestMethod -Uri ($base + $Path) -Method $Method -TimeoutSec 60
}

$suffix = Get-Random -Minimum 10000 -Maximum 99999
$username = "liveuser_$suffix"
$password = 'Pass@12345'

Write-Output "START_TEST_SUFFIX=$suffix"

$signup = Api -Method 'POST' -Path '/auth/signup' -Body @{ username = $username; password = $password }
Write-Output "PASS signup id=$($signup.id)"

$login = Api -Method 'POST' -Path '/auth/login' -Body @{ username = $username; password = $password }
Write-Output "PASS login user=$($login.user.username)"

# Full functional flow
$league = Api -Method 'POST' -Path '/leagues' -Body @{ name = "LIVE_TEST_LEAGUE_$suffix"; city = 'Dubai'; format = 'round-robin'; overs_per_innings = 2; status = 'upcoming' }
Write-Output "PASS league id=$($league.id)"

$teamA = Api -Method 'POST' -Path '/teams' -Body @{ league_id = $league.id; name = "Live A $suffix"; captain_name = 'Captain A' }
$teamB = Api -Method 'POST' -Path '/teams' -Body @{ league_id = $league.id; name = "Live B $suffix"; captain_name = 'Captain B' }
Write-Output "PASS teams A=$($teamA.id) B=$($teamB.id)"

$a1 = Api -Method 'POST' -Path '/players' -Body @{ team_id = $teamA.id; name = 'A1'; role = 'batsman'; jersey_number = '1' }
$a2 = Api -Method 'POST' -Path '/players' -Body @{ team_id = $teamA.id; name = 'A2'; role = 'batsman'; jersey_number = '2' }
$b1 = Api -Method 'POST' -Path '/players' -Body @{ team_id = $teamB.id; name = 'B1'; role = 'bowler'; jersey_number = '9' }
Write-Output "PASS players A1=$($a1.id) A2=$($a2.id) B1=$($b1.id)"

$match = Api -Method 'POST' -Path '/matches' -Body @{ league_id = $league.id; team_a_id = $teamA.id; team_b_id = $teamB.id; date = '2020-01-01'; time = '00:00'; venue = 'Live Test Ground'; overs_per_innings = 2 }
Write-Output "PASS match id=$($match.id)"

$start = Api -Method 'POST' -Path "/matches/$($match.id)/start" -Body @{ toss_winner_id = $teamA.id; toss_decision = 'bat' }
Write-Output "PASS start innings=$($start.innings_id)"

$null = Api -Method 'POST' -Path "/innings/$($start.innings_id)/ball" -Body @{ runs_scored = 1 }
Write-Output "PASS record ball"

$null = Api -Method 'DELETE' -Path "/innings/$($start.innings_id)/ball/last"
Write-Output "PASS undo ball"

$second = Api -Method 'POST' -Path "/matches/$($match.id)/second-innings" -Body @{}
Write-Output "PASS second innings=$($second.innings_id)"

$end = Api -Method 'POST' -Path "/matches/$($match.id)/end" -Body @{}
Write-Output "PASS end match summary=$($end.result_summary)"

$scorecard = Api -Method 'GET' -Path "/matches/$($match.id)/scorecard"
Write-Output "PASS scorecard inningsCount=$((@($scorecard)).Count)"

# Seed one visible showcase dataset for manual app checks
$showLeague = Api -Method 'POST' -Path '/leagues' -Body @{ name = "SHOWCASE_LEAGUE_$suffix"; city = 'Abu Dhabi'; format = 'round-robin'; overs_per_innings = 20; status = 'upcoming' }
$showA = Api -Method 'POST' -Path '/teams' -Body @{ league_id = $showLeague.id; name = "Show XI A $suffix"; captain_name = 'Show Cap A' }
$showB = Api -Method 'POST' -Path '/teams' -Body @{ league_id = $showLeague.id; name = "Show XI B $suffix"; captain_name = 'Show Cap B' }
$null = Api -Method 'POST' -Path '/players' -Body @{ team_id = $showA.id; name = 'ShowA1'; role = 'batsman'; jersey_number = '7' }
$null = Api -Method 'POST' -Path '/players' -Body @{ team_id = $showB.id; name = 'ShowB1'; role = 'bowler'; jersey_number = '11' }
$showMatch = Api -Method 'POST' -Path '/matches' -Body @{ league_id = $showLeague.id; team_a_id = $showA.id; team_b_id = $showB.id; date = '2026-03-20'; time = '19:00'; venue = 'Sharjah'; overs_per_innings = 20 }

Write-Output "SHOWCASE_LEAGUE_ID=$($showLeague.id)"
Write-Output "SHOWCASE_MATCH_ID=$($showMatch.id)"
Write-Output "SHOWCASE_TEAM_A_ID=$($showA.id)"
Write-Output "SHOWCASE_TEAM_B_ID=$($showB.id)"
Write-Output "LOGIN_USERNAME=$username"
Write-Output "LOGIN_PASSWORD=$password"
Write-Output 'LIVE_TEST_COMPLETE'
