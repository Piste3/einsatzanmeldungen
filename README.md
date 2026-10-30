# KKB-Einsatzplaner

Webanwendung des Kadetten-Korps Basel für Einsätze, Anmeldungen, Nachfassen, Schichten und das Aufgebot im Kalender. Umgesetzt nach dem Softwarekonzept und der Benutzeranleitung (Ordner `konzept` in der Projektbibliothek).

## Was drin ist

- **Cockpit** mit Kennzahlen, anstehenden Einsätzen, offenen Klärungen und letzter Aktivität
- **Einsätze** mit Status (Entwurf, Veröffentlicht, Abgeschlossen, Abgesagt), Checkliste, Schichten, Anmeldungen, Anfragen, Formular-Einstellungen und Verlauf
- **Öffentliches Anmeldeformular** unter `/forms/anmeldung` zum Einbetten in ClubDesk (iFrame)
- **Automatische Zuordnung** der Namen zu Personen (Umlaute, Akzente, vertauschte Namen, Aliasse). Unklare Fälle landen in den **Klärungen**, es werden nie automatisch Personen angelegt
- **Rückmeldungen**: wer hat sich wofür angemeldet, wer ist offen
- **Anfragen** (Nachfassen per Telefon oder WhatsApp) mit Kontaktversuchen. Eine Zusage legt direkt eine Anmeldung an
- **Kalendertermin (.ics)** mit Bausteinen wie `{{einsatz.name}}`, stabiler UID und Versionsnummer, damit ein erneuter Export den Termin aktualisiert
- **Exporte** jeder Liste als Excel (.xlsx) oder CSV, **Import** aus ClubDesk mit Vorschau und Duplikatprüfung
- **Live-Aktualisierung**: geänderte Listen laden sich selbst nach, und es ist sichtbar, wer gerade dasselbe bearbeitet
- **Gleichzeitige Änderungen** werden erkannt. Statt still zu überschreiben, erscheint eine Seite zum Übernehmen, erneut Anwenden oder Verwerfen
- **Verwaltung**: Benutzer, Auswahllisten, Vorlagen, Kalendertermin-Vorlage, Bestätigungsmail (mit Vorschau und Testmail), Einstellungen und tägliche Sicherung

Zusätzlich zu den Anmeldestatus aus dem Konzept gibt es **Abgesagt** (im Formular mit «Nein» geantwortet) und **Ungültig** (z. B. Spass-Anmeldung). Beide zählen nicht zur Besetzung. Im Kalendertermin werden nur **bestätigte** Personen als Teilnehmende eingetragen.

## Voraussetzungen

- Node.js **22.13 oder neuer** (die Datenbank ist das eingebaute SQLite von Node, es gibt keine nativen Abhängigkeiten)
- Für den Betrieb: ein Reverse-Proxy mit HTTPS (z. B. Caddy oder nginx)

## Schnellstart

```bash
npm install
cp .env.example .env      # anpassen
npm start
```

Beim ersten Start gibt es noch kein Benutzerkonto. Der Server schreibt dann einen einmaligen Einrichtungs-Link in die Ausgabe:

```
 Noch kein Benutzerkonto vorhanden. Ersten Admin anlegen unter:
 https://einsatz.kkb.ch/setup?token=…
```

Alternativ auf der Kommandozeile:

```bash
npm run user:create -- yann "Yann Wunderle" admin
```

Ohne Passwort wird ein Startpasswort erzeugt, das beim ersten Login geändert werden muss.

### Beispieldaten

```bash
npm run seed
```

legt Personen und Einsätze wie in der Anleitung an, dazu den Benutzer `lena` mit Passwort `Aufgebot2026!` (Rolle Aufgebotsstelle). Nur für Tests verwenden.

### Tests

```bash
npm test
```

## Konfiguration

Alles läuft über Umgebungsvariablen. `npm start` liest zusätzlich eine `.env`-Datei, siehe `.env.example`.

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `BASE_URL` | `http://localhost:PORT` | Öffentliche Adresse, wird für Links und Microsoft-Login gebraucht |
| `DATA_DIR` | `./data` | Ordner für Datenbank und Sicherungen |
| `TRUST_PROXY` | aus | Auf `1` setzen, wenn ein Reverse-Proxy davor steht |
| `SECURE_COOKIES` | in Produktion an | Cookies nur über HTTPS |
| `SESSION_HOURS` | `12` | Maximale Dauer einer Anmeldung |
| `SESSION_IDLE_MINUTES` | `120` | Abmeldung nach Inaktivität |
| `AUTH_PROVIDERS` | `local` | `local`, `microsoft` oder `local,microsoft` |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | | Für Microsoft-Login |
| `FORM_FRAME_ANCESTORS` | `https://*.clubdesk.com https://web.kkb.ch https://*.web.kkb.ch http://web.kkb.ch http://*.web.kkb.ch` | Webseiten, die das Formular einbetten dürfen (mit Leerzeichen getrennt) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | | E-Mail-Versand der Anmeldebestätigungen |
| `BACKUP_DIR` | `DATA_DIR/backups` | Ziel der täglichen Sicherung |
| `BACKUP_KEEP_DAYS` | `30` | Wie lange Sicherungen behalten werden |

Ohne `SMTP_HOST` werden Bestätigungsmails nicht verschickt, sondern bleiben im Postausgang der Datenbank und gehen raus, sobald SMTP eingerichtet ist.

## Login und Rollen

- **Admin**: alles, inklusive Verwaltung und Änderungen an abgeschlossenen Einsätzen (mit Begründung)
- **Aufgebotsstelle**: Einsätze, Anmeldungen, Anfragen, Klärungen und Personen, aber keine Verwaltung

Sicherheit des eigenen Logins:

- Passwörter mit scrypt gehasht, mindestens 10 Zeichen, der Benutzername darf nicht vorkommen
- Sitzungen liegen auf dem Server, im Cookie steht nur ein zufälliges Token
- Sperre nach 5 Fehlversuchen für 15 Minuten, zusätzlich Bremse pro IP-Adresse
- Jede Änderung ist mit einem CSRF-Token geschützt
- Nach einem Passwort-Reset durch einen Admin muss beim nächsten Login ein neues Passwort gesetzt werden

### Umstellung auf Microsoft SSO

Das Login ist austauschbar aufgebaut (`src/auth/providers/`). Microsoft (Entra ID) ist vorbereitet, aber noch nicht gegen einen echten Tenant getestet.

1. In Entra ID eine App-Registrierung anlegen, Typ «Web», Redirect-URI `<BASE_URL>/auth/microsoft/callback`
2. Ein Client-Secret erzeugen
3. Setzen: `AUTH_PROVIDERS=local,microsoft`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`
4. Bei den Benutzern in der Verwaltung die E-Mail-Adresse des Microsoft-Kontos eintragen. Beim ersten Microsoft-Login wird das Konto über die E-Mail verknüpft, danach über die feste Microsoft-ID
5. Wenn alles läuft, `AUTH_PROVIDERS=microsoft` setzen. Dann ist das eigene Login abgeschaltet

Rollen bleiben im Einsatzplaner verwaltet. Wer kein Benutzerkonto hat, kommt auch mit Microsoft nicht hinein.

## Formular in ClubDesk einbetten

In ClubDesk einen HTML-Block einfügen:

```html
<iframe src="https://einsatz.kkb.ch/forms/anmeldung" style="width:100%;min-height:1200px;border:0" title="Einsatz-Anmeldung"></iframe>
```

Das Formular braucht kein Cookie. Jeder Aufruf bekommt eine einmalige Absende-ID, ein doppeltes Absenden wird erkannt. Jede Absendung wird zuerst roh gespeichert und erst dann verarbeitet. Spam wird über ein verstecktes Feld und eine Mindestzeit abgefangen. Läuft ClubDesk unter einer eigenen Domain, diese bei `FORM_FRAME_ANCESTORS` ergänzen, z. B. `FORM_FRAME_ANCESTORS=https://*.clubdesk.com https://web.kkb.ch`. Die aktuell gültige Liste steht beim Start in der Server-Ausgabe. Blockiert ein Browser die Einbettung, steht in der Server-Ausgabe eine Zeile «Browser hat blockiert: frame-ancestors · <Adresse>» mit der Seite, die ergänzt werden muss.

Wichtig: Im iFrame genau `/forms/anmeldung` angeben. Alle anderen Seiten (Login, Cockpit, …) lassen sich absichtlich nicht einbetten. Der Reverse-Proxy darf keinen eigenen `X-Frame-Options`-Header setzen.

## Betrieb

Für Start, Stopp, Autostart, Sicherung und Update gibt es fertige Skripte für Linux, macOS und Windows im Ordner [`betrieb`](betrieb/README.md).

### Hinter einem Reverse-Proxy (Beispiel Caddy)

```
einsatz.kkb.ch {
    reverse_proxy localhost:3000
}
```

Caddy holt das Zertifikat selbst und leitet auch WebSockets (`/live`) weiter. Bei nginx `proxy_set_header Upgrade $http_upgrade;` und `proxy_set_header Connection "upgrade";` für `/live` nicht vergessen. In beiden Fällen `TRUST_PROXY=1` setzen.

### Docker

```bash
docker build -t kkb-einsatzplaner .
docker run -d -p 3000:3000 -v kkb-data:/data --env-file .env kkb-einsatzplaner
```

### Sicherung

Einmal täglich wird die Datenbank mit `VACUUM INTO` nach `BACKUP_DIR` gesichert (nach 30 Tagen gelöscht). Unter Einstellungen › Einstellungen lässt sich zusätzlich jederzeit eine Sicherung auslösen. Den Sicherungsordner zusätzlich ausser Haus kopieren.

Wiederherstellen: Server stoppen, die gewünschte Sicherung als `DATA_DIR/einsatzplaner.sqlite` hinlegen, die Dateien `-wal` und `-shm` daneben löschen, Server starten.

## Aufbau

```
src/
  auth/         Login, Sitzungen, Anbieter (local, microsoft)
  db/           Schema und Standardwerte (SQLite)
  services/     Fachlogik (Einsätze, Anmeldungen, Zuordnung, Kalender, …)
  routes/       Seiten und Formulare
  lib/          Hilfsfunktionen (Datum, Export, ICS, XLSX, Live-Updates)
views/          EJS-Vorlagen
public/         CSS, JavaScript, Logo
scripts/        seed, user:create
test/           automatische Tests
```
