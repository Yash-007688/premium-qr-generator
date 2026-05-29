$scriptBlock = @"
    <script>
        (function() {
            var theme = localStorage.getItem('theme');
            if (theme === 'light') {
                document.documentElement.setAttribute('data-theme', 'light');
            }
        })();
    </script>
"@

Get-ChildItem -Filter *.html | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -notmatch "localStorage.getItem\('theme'\)") {
        $content = $content -replace "(?i)(<head>)", "`$1`r`n$scriptBlock"
        Set-Content -Path $_.FullName -Value $content -NoNewline
    }
}
