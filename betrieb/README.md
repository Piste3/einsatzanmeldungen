# Betrieb: Server starten, stoppen, aktualisieren

Skripte für den Alltag. Es gibt je eine Variante für **Linux/macOS** (`betrieb/linux`) und für **Windows** (`betrieb/windows`). Alle Skripte lesen `PORT` und `DATA_DIR` aus der `.env` im Projektordner.

| Aufgabe | Linux / macOS | Windows |
|---|---|---|
| Server starten | `betrieb/linux/start.sh` | `start.cmd` doppelklicken |
| Server stoppen | `betrieb/linux/stop.sh` | `stop.cmd` |
| Neu starten | `betrieb/linux/neustart.sh` | `neustart.cmd` |
| Läuft er? | `betrieb/linux/status.sh` | `status.cmd` |
| Protokoll ansehen | `betrieb/linux/protokoll.sh` | `protokoll.cmd` |
| Sicherung jetzt | `betrieb/linux/sicherung.sh` | `sicherung.cmd` |
| Server-Einstellungen aus der Verwaltung löschen (Notausgang) | `betrieb/linux/server-zuruecksetzen.sh` | `server-zuruecksetzen.cmd` |
| Neueste Version holen | `betrieb/linux/update.sh` | `update.cmd` |
| Autostart einschalten | `betrieb/linux/autostart-ein.sh` | `autostart-ein.cmd` (als Administrator) |
| Autostart ausschalten | `betrieb/linux/autostart-aus.sh` | `autostart-aus.cmd` (als Administrator) |

Unter Windows sind die `.cmd`-Dateien nur Doppelklick-Starter für die gleichnamigen PowerShell-Skripte (`.ps1`).

## Update und Neustart im Browser

Admins finden unter **Einstellungen › System** die Knöpfe «Nach Updates suchen», «Update installieren» und «Server neu starten», mit Protokoll. Dafür muss der Server über die Skripte hier (oder `npm start`) gestartet sein. Diese starten `src/launcher.js`, der den Server nach einem Update automatisch neu startet. Für das Update muss `git` auf dem Server installiert sein, und das Konto, unter dem der Server läuft, muss von GitHub lesen dürfen.

## Was die Skripte tun

- **start** startet den Server im Hintergrund und merkt sich die Prozessnummer in `DATA_DIR/server.pid`. Die Ausgabe landet in `DATA_DIR/server.log`. Fehlen die Abhängigkeiten, werden sie zuerst installiert.
- **stop** beendet den Server.
- **update** bricht ab, wenn jemand am Code etwas lokal geändert hat. Sonst sichert es zuerst die Datenbank, holt mit `git pull` die neueste Version von `main`, installiert die Abhängigkeiten und startet den Server neu.
- **server-zuruecksetzen** löscht die Werte, die unter **Einstellungen › Server** gespeichert sind, und startet neu. Danach gilt wieder nur die `.env`. Hilft, wenn man sich dort ausgesperrt hat. Mit Namen dahinter nur diese Werte, z. B. `server-zuruecksetzen.cmd AUTH_PROVIDERS`.
- **sicherung** legt sofort eine Kopie der Datenbank in `DATA_DIR/backups` ab (zusätzlich zur täglichen automatischen Sicherung). Das geht auch, während der Server läuft.
- **autostart-ein** richtet den Server als Dienst ein, der beim Hochfahren startet und nach einem Absturz neu startet:
  - Linux: systemd-Dienst `kkb-einsatzplaner` (fragt nach dem sudo-Passwort). Das Protokoll gibt es dann mit `protokoll.sh` bzw. `journalctl -u kkb-einsatzplaner`.
  - macOS: launchd-Agent, startet bei der Anmeldung des Benutzers.
  - Windows: geplante Aufgabe `KKB-Einsatzplaner`, die beim Systemstart läuft.

Ist der Autostart eingerichtet, steuern start, stop und neustart automatisch den Dienst. Unter Windows brauchen stop und neustart dann ebenfalls Administratorrechte.

## Voraussetzungen

- Node.js 22.13 oder neuer
- Git, und der Projektordner wurde mit `git clone` angelegt (für update)
