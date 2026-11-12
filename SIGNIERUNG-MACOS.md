# macOS-Signierung & Notarisierung — dein Minimal-Teil

Alles Technische ist schon eingerichtet (Notarisierung in `electron-builder.yml` aktiv, Workflow
reicht die Secrets durch). **Du musst nur zwei Dinge tun**, die ich grundsätzlich nicht übernehmen
darf (Apple-Konto/Zahlung + Credentials): das Zertifikat besorgen und die 5 Werte als GitHub-Secrets
einfügen. Danach sage mir Bescheid — den signierten Release löse ich selbst aus.

> Warum überhaupt? macOS lässt automatische Updates (Squirrel.Mac) nur für **signierte + notarisierte**
> Apps zu. Ohne das läuft die App zwar (Rechtsklick → Öffnen), aktualisiert sich aber nicht selbst.

---

## Schritt 1 — Apple Developer Programm (99 €/Jahr)
1. https://developer.apple.com/programs/enroll/ → mit deiner Apple-ID anmelden und das Programm buchen.
2. Freischaltung dauert manchmal ein paar Stunden.

## Schritt 2 — „Developer ID Application"-Zertifikat erstellen
**Einfachster Weg (über Xcode):**
1. Xcode → **Settings… → Accounts** → mit Apple-ID anmelden.
2. Account auswählen → **Manage Certificates…** → **+** unten links → **Developer ID Application**.
3. Das Zertifikat liegt jetzt in der **Schlüsselbundverwaltung** (Keychain Access).

## Schritt 3 — Zertifikat als `.p12` exportieren
1. **Schlüsselbundverwaltung** öffnen → Kategorie „Meine Zertifikate".
2. Eintrag **„Developer ID Application: … (TEAMID)"** aufklappen, Zertifikat **und** privaten Schlüssel
   markieren → Rechtsklick → **2 Objekte exportieren…** → Format **Personal Information Exchange (.p12)**.
3. Speichern als z. B. `DeveloperID.p12` und ein **Passwort** vergeben — **dieses Passwort = `CSC_KEY_PASSWORD`**.

## Schritt 4 — `.p12` in Base64 umwandeln (für `CSC_LINK`)
Im Terminal (macOS):
```bash
base64 -i DeveloperID.p12 -o DeveloperID.p12.b64
```
Die Datei `DeveloperID.p12.b64` enthält den Wert für **`CSC_LINK`**.

## Schritt 5 — App-spezifisches Passwort (für Notarisierung)
1. https://account.apple.com → **Anmeldung & Sicherheit → App-spezifische Passwörter** → **+**.
2. Namen vergeben (z. B. „LightBridge Notarize") → das generierte Passwort = **`APPLE_APP_SPECIFIC_PASSWORD`**.

## Schritt 6 — Team-ID finden
https://developer.apple.com/account → **Membership details** → **Team ID** (10 Zeichen) = **`APPLE_TEAM_ID`**.

---

## Schritt 7 — Die 5 Secrets im Repo hinterlegen
Du hast zwei Wege. **Beide halten die Werte von mir fern** — ich sehe sie nie.

### Variante A — Terminal (schnell, Werte bleiben lokal)
```bash
# CSC_LINK aus der Base64-Datei einlesen:
gh secret set CSC_LINK --repo Jet115/lightbridge < DeveloperID.p12.b64

# Die restlichen 4 fragt gh interaktiv ab (Eingabe wird nicht angezeigt):
gh secret set CSC_KEY_PASSWORD --repo Jet115/lightbridge
gh secret set APPLE_ID --repo Jet115/lightbridge
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo Jet115/lightbridge
gh secret set APPLE_TEAM_ID --repo Jet115/lightbridge
```
`APPLE_ID` ist deine Apple-ID-E-Mail.

### Variante B — GitHub-Website (per Klick)
`Settings → Secrets and variables → Actions → New repository secret` und diese **5** anlegen
(Namen exakt so):

| Secret-Name                   | Inhalt                                             |
|------------------------------|----------------------------------------------------|
| `CSC_LINK`                   | kompletter Inhalt von `DeveloperID.p12.b64`        |
| `CSC_KEY_PASSWORD`           | das `.p12`-Export-Passwort aus Schritt 3           |
| `APPLE_ID`                   | deine Apple-ID-E-Mail                              |
| `APPLE_APP_SPECIFIC_PASSWORD`| app-spezifisches Passwort aus Schritt 5            |
| `APPLE_TEAM_ID`              | Team-ID (10 Zeichen) aus Schritt 6                 |

---

## Schritt 8 — mir Bescheid geben
Schreib einfach **„Secrets sind drin"**. Dann:
- erhöhe ich die Version und pushe einen neuen Tag,
- der Workflow baut mac **signiert + notarisiert** (und win),
- der neue Release enthält eine self-updatefähige macOS-App.

Prüfen kannst du es nach dem Build mit:
```bash
spctl -a -vvv -t install /Applications/LightBridge.app   # sollte "accepted / Notarized Developer ID" zeigen
```

> Danach räumst du die lokalen Dateien weg: `rm DeveloperID.p12 DeveloperID.p12.b64`
