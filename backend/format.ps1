param([switch]$Check)
$ErrorActionPreference = 'Stop'
$formatterVersion = '1.28.0' # Last formatter line supporting this project's JDK 17.
& mvn.cmd -q dependency:get "-Dartifact=com.google.googlejavaformat:google-java-format:${formatterVersion}:jar:all-deps" '-Dtransitive=false'
if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve Google Java Format.' }
$formatterJar = Join-Path ([Environment]::GetFolderPath('UserProfile')) ".m2/repository/com/google/googlejavaformat/google-java-format/$formatterVersion/google-java-format-$formatterVersion-all-deps.jar"
$sources = @(Get-ChildItem -LiteralPath "$PSScriptRoot/src" -Recurse -Filter '*.java' | ForEach-Object FullName)
if ($Check) { & java -jar $formatterJar --dry-run --set-exit-if-changed @sources }
else { & java -jar $formatterJar --replace @sources }
if ($LASTEXITCODE -ne 0) { throw 'Java formatting check failed.' }
