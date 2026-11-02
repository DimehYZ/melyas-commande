# Branche le bot Telegram sur le moteur, en une fois :
#   1. vérifie le jeton auprès de Telegram (getMe)
#   2. met le jeton et le mot secret dans les secrets Cloudflare
#   3. déclare le webhook avec ce même mot secret
#
# Le jeton et le mot secret sont tapés ici, dans le terminal : ils ne
# passent par aucun fichier, aucun historique, aucune conversation.
#
# Lancer depuis le dossier du projet :
#   powershell -ExecutionPolicy Bypass -File scripts\brancher-telegram.ps1

$ErrorActionPreference = 'Stop'
$moteur = 'https://melyas-commande.mehdilakhal07200.workers.dev'

function Lire-Secret($invite) {
  $s = Read-Host -AsSecureString $invite
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$jeton = Lire-Secret 'Colle le jeton de BotFather (rien ne s affiche, c est normal)'
if ($jeton -notmatch '^\d+:[\w-]{30,}$') {
  Write-Host "Ce n'est pas un jeton Telegram : il doit ressembler a 7123456789:AAH... (chiffres, deux-points, puis environ 35 caracteres)." -ForegroundColor Red
  exit 1
}

Write-Host '1/4 Verification du jeton aupres de Telegram...'
try {
  $moi = Invoke-RestMethod "https://api.telegram.org/bot$jeton/getMe"
} catch {
  Write-Host 'Telegram refuse ce jeton. Recopie-le depuis BotFather (/mybots > ton bot > API Token).' -ForegroundColor Red
  exit 1
}
Write-Host "    OK, bot : @$($moi.result.username)" -ForegroundColor Green

# Mot secret tiré au hasard : 40 lettres et chiffres, rien à inventer ni à retenir.
$alphabet = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
$octets = New-Object byte[] 40
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($octets)
$secret = -join ($octets | ForEach-Object { $alphabet[$_ % $alphabet.Length] })

Write-Host '2/4 Envoi du jeton a Cloudflare...'
$jeton | npx wrangler secret put TELEGRAM_TOKEN | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'Echec de wrangler (TELEGRAM_TOKEN).' -ForegroundColor Red; exit 1 }

Write-Host '3/4 Envoi du mot secret a Cloudflare...'
$secret | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'Echec de wrangler (TELEGRAM_WEBHOOK_SECRET).' -ForegroundColor Red; exit 1 }

Write-Host '4/4 Branchement du webhook...'
$r = Invoke-RestMethod -Method Post "https://api.telegram.org/bot$jeton/setWebhook" -Body @{
  url = "$moteur/telegram"
  secret_token = $secret
  allowed_updates = '["message","callback_query"]'
}
if (-not $r.ok) { Write-Host "Telegram a refuse : $($r.description)" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host "C'est branche. Envoie maintenant /start a @$($moi.result.username) sur Telegram." -ForegroundColor Green
