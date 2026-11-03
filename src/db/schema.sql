-- KKB-Einsatzplaner Datenbankschema (SQLite)
-- Zeiten: lokale Zeit Europe/Zurich als Text 'YYYY-MM-DD' bzw. 'YYYY-MM-DDTHH:MM'.
-- Zeitstempel (created_at usw.): ISO-8601 UTC.

CREATE TABLE IF NOT EXISTS ranks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,          -- z. B. «Soldat»
  short TEXT NOT NULL,         -- z. B. «Sdt»
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Funktionen an einem Einsatz (EL, SC, BF, Einsatzteilnehmer …). Genau eine ist Standard:
-- Wer keine Funktion zugewiesen hat, zählt als diese (Einsatzteilnehmer).
-- Nicht zu verwechseln mit der Benutzer-Rolle «Einsatzleiter» (Login, Lesezugriff).
CREATE TABLE IF NOT EXISTS functions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,          -- z. B. «Sektorchef»
  short TEXT NOT NULL,         -- z. B. «SC»
  sort INTEGER NOT NULL DEFAULT 0,  -- kleine Zahl = weiter oben (EL zuerst)
  active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,          -- Mannschaft / Kader
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  norm_key TEXT NOT NULL,      -- normalisiert «vorname|nachname»
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','inaktiv','ausgetreten')),
  rank_id INTEGER REFERENCES ranks(id),
  birth_date TEXT,             -- YYYY-MM-DD
  birth_year INTEGER,
  mobile TEXT,
  email TEXT,
  diet_category TEXT,          -- allergie, unvertraeglichkeit, vegetarisch, vegan, religioes, andere
  diet_text TEXT,
  internal_note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_persons_norm ON persons(norm_key);

CREATE TABLE IF NOT EXISTS person_teams (
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, team_id)
);

CREATE TABLE IF NOT EXISTS person_aliases (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  norm_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_aliases_norm ON person_aliases(norm_key);

-- Benutzerkonten. auth_provider/external_id erlauben später Microsoft SSO
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','aufgebotsstelle','einsatzleiter')),
  person_id INTEGER REFERENCES persons(id),
  password_hash TEXT,          -- NULL bei reinen SSO-Konten
  auth_provider TEXT NOT NULL DEFAULT 'local',
  external_id TEXT,            -- z. B. Entra-ID Objekt-ID
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  totp_secret TEXT,            -- Zwei-Faktor: Geheimnis der Authenticator-App (Base32)
  totp_enabled_at TEXT,        -- gesetzt = 2FA eingerichtet
  totp_last_step INTEGER,      -- zuletzt verwendetes Zeitfenster (gegen Wiederverwendung)
  recovery_codes JSON,         -- SHA-256 der unbenutzten Wiederherstellungscodes
  twofa_required INTEGER NOT NULL DEFAULT 0,
  twofa_remember_days INTEGER NOT NULL DEFAULT 0,  -- 0 = bei jedem Login
  theme TEXT NOT NULL DEFAULT 'system',            -- Darstellung: system, light, dark
  ms_login INTEGER NOT NULL DEFAULT 0,             -- Microsoft-Anmeldung für diese E-Mail freigegeben
  password_login INTEGER NOT NULL DEFAULT 1,       -- 0 = nur Microsoft (gilt nur, solange Microsoft eingeschaltet ist)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external ON users(auth_provider, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,         -- SHA-256 des Cookie-Tokens
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY,
  ip TEXT,
  username TEXT,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(ip, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  question_text TEXT NOT NULL,
  help_text TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tenue_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Konfigurierbare Zusatzfelder für Einsätze (Werte als JSON am Einsatz)
CREATE TABLE IF NOT EXISTS extra_fields (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','textarea','number','date','checkbox')),
  required INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT,                   -- YYYY-MM-DD, freiwillig (leer = Schichten an verschiedenen Tagen)
  description TEXT,            -- für Mitglieder sichtbar
  start_time TEXT,             -- HH:MM Antreten
  end_time TEXT,               -- HH:MM Abtreten
  start_place TEXT,
  end_place TEXT,
  tenue TEXT,
  leader_person_id INTEGER REFERENCES persons(id),
  internal_note TEXT,
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','veroeffentlicht','abgeschlossen','abgesagt')),
  show_in_form INTEGER NOT NULL DEFAULT 0,
  question_template_id INTEGER REFERENCES question_templates(id),
  question_text TEXT,
  help_text TEXT,
  extra JSON NOT NULL DEFAULT '{}',
  function_targets JSON NOT NULL DEFAULT '{}',  -- veraltet (früher Soll pro Funktion am Einsatz) – jetzt pro Schicht
  calendar_sent_at TEXT,       -- zuletzt Kalendertermin exportiert
  date_from TEXT,              -- erster Tag (Einsatzdatum und Schichten) – wird per Trigger nachgeführt
  date_to TEXT,                -- letzter Tag (Einsatzdatum und Schichtbeginne)
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER,
  updated_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_date_from ON events(date_from);

-- Freigabe einzelner Einsätze für Konten mit der Rolle «Einsatzleiter» (nur lesen: Angaben + Teilnehmer)
CREATE TABLE IF NOT EXISTS event_leaders (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL,
  granted_by INTEGER,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_leaders_user ON event_leaders(user_id);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_at TEXT,              -- YYYY-MM-DDTHH:MM
  ends_at TEXT,
  target_count INTEGER,         -- Soll der Schicht = Summe von function_targets (wird mitgeführt)
  function_targets JSON NOT NULL DEFAULT '{}',  -- Soll pro Funktion in dieser Schicht: { "<functions.id>": Anzahl }
  start_place TEXT,            -- überschreibt Antretensort des Einsatzes
  internal_note TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_shifts_event ON shifts(event_id);

-- Zeitraum eines Einsatzes (date_from/date_to) aus Einsatzdatum und Schichtbeginnen ableiten.
-- So funktionieren Sortierung und Filter auch, wenn der Einsatz kein eigenes Datum hat.
CREATE TRIGGER IF NOT EXISTS trg_shifts_ins_dates AFTER INSERT ON shifts BEGIN
  UPDATE events SET
    date_from = (SELECT min(d) FROM (SELECT events.date AS d UNION ALL SELECT substr(starts_at, 1, 10) FROM shifts WHERE event_id = events.id)),
    date_to = (SELECT max(d) FROM (SELECT events.date AS d UNION ALL SELECT substr(starts_at, 1, 10) FROM shifts WHERE event_id = events.id))
  WHERE id = NEW.event_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_shifts_upd_dates AFTER UPDATE OF starts_at, event_id ON shifts BEGIN
  UPDATE events SET
    date_from = (SELECT min(d) FROM (SELECT events.date AS d UNION ALL SELECT substr(starts_at, 1, 10) FROM shifts WHERE event_id = events.id)),
    date_to = (SELECT max(d) FROM (SELECT events.date AS d UNION ALL SELECT substr(starts_at, 1, 10) FROM shifts WHERE event_id = events.id))
  WHERE id IN (NEW.event_id, OLD.event_id);
END;
CREATE TRIGGER IF NOT EXISTS trg_shifts_del_dates AFTER DELETE ON shifts BEGIN
  UPDATE events SET
    date_from = (SELECT min(d) FROM (SELECT events.date AS d UNION ALL SELECT substr(starts_at, 1, 10) FROM shifts WHERE event_id = events.id)),
    date_to = (SELECT max(d) FROM (SELECT events.date AS d UNION ALL SELECT substr(starts_at, 1, 10) FROM shifts WHERE event_id = events.id))
  WHERE id = OLD.event_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_events_dates AFTER INSERT ON events BEGIN
  UPDATE events SET date_from = NEW.date, date_to = NEW.date WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_events_upd_dates AFTER UPDATE OF date ON events BEGIN
  UPDATE events SET
    date_from = (SELECT min(d) FROM (SELECT NEW.date AS d UNION ALL SELECT substr(starts_at, 1, 10) FROM shifts WHERE event_id = NEW.id)),
    date_to = (SELECT max(d) FROM (SELECT NEW.date AS d UNION ALL SELECT substr(starts_at, 1, 10) FROM shifts WHERE event_id = NEW.id))
  WHERE id = NEW.id;
END;

-- Externe Abteilungen (andere Vereine, Feuerwehr …): wiederverwendbare Liste
CREATE TABLE IF NOT EXISTS external_units (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Externe Abteilung an einem Einsatz: nur Anzahl Personen, keine Namen
CREATE TABLE IF NOT EXISTS event_externals (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES external_units(id),
  person_count INTEGER NOT NULL CHECK (person_count > 0),
  shift_ids JSON NOT NULL DEFAULT '[]',  -- leer = alle Schichten des Einsatzes
  contact TEXT,                -- Ansprechperson der Abteilung (Name, Telefon)
  note TEXT,
  diets JSON NOT NULL DEFAULT '[]',     -- Essenseinschränkungen: [{ count, category, text }]
  function_id INTEGER REFERENCES functions(id),  -- NULL = Standardfunktion (Einsatzteilnehmer)
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_externals_event ON event_externals(event_id);

-- Vom Server ausgegebene Formular-Aufrufe (einmalige Absende-ID + damals angezeigte Einsätze)
CREATE TABLE IF NOT EXISTS form_tokens (
  uid TEXT PRIMARY KEY,
  event_ids JSON NOT NULL,
  shift_ids JSON NOT NULL,
  issued_at TEXT NOT NULL,
  ip TEXT
);

-- «formular_eingang»: jede Absendung wird zuerst unverändert gespeichert
CREATE TABLE IF NOT EXISTS form_submissions (
  id INTEGER PRIMARY KEY,
  submission_uid TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  payload JSON NOT NULL,       -- ganze Absendung inkl. angezeigter Fragen
  form_snapshot JSON,          -- Formularstand beim Seitenaufruf
  status TEXT NOT NULL DEFAULT 'neu' CHECK (status IN ('neu','verarbeitet','fehler','spam')),
  spam_reason TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES persons(id),
  entered_first_name TEXT,
  entered_last_name TEXT,
  match_type TEXT,             -- auto, alias, manuell
  match_info TEXT,             -- z. B. «2 Personen mit diesem Namen»
  source TEXT NOT NULL CHECK (source IN ('formular','telefon','whatsapp','muendlich','manuell')),
  submission_id INTEGER REFERENCES form_submissions(id),
  answer TEXT,                 -- ja / nein
  shift_wishes JSON NOT NULL DEFAULT '[]',
  remark TEXT,                 -- Bemerkung aus dem Formular
  internal_note TEXT,
  function_id INTEGER REFERENCES functions(id),  -- Funktion an diesem Einsatz; NULL = Standardfunktion (Einsatzteilnehmer)
  status TEXT NOT NULL DEFAULT 'neu' CHECK (status IN ('neu','unsicher','rueckfrage','warteliste','bestaetigt','zurueckgezogen','abgesagt','ungueltig')),
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  confirmation_sent_at TEXT,
  registered_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reg_event ON registrations(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_event_person ON registrations(event_id, person_id) WHERE person_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS shift_assignments (
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  assigned_by INTEGER,
  PRIMARY KEY (registration_id, shift_id)
);

-- Nachfassen: eine Anfrage pro Person und Einsatz, mehrere Kontaktversuche
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons(id),
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','zugesagt','abgesagt','nicht_erreicht','whatsapp','unsicher')),
  registration_id INTEGER REFERENCES registrations(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER,
  UNIQUE (event_id, person_id)
);

CREATE TABLE IF NOT EXISTS contact_attempts (
  id INTEGER PRIMARY KEY,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telefon','whatsapp','muendlich')),
  contacted_at TEXT NOT NULL,  -- YYYY-MM-DDTHH:MM lokal
  sent_by_user_id INTEGER REFERENCES users(id),
  sent_by_name TEXT NOT NULL,
  result TEXT NOT NULL,        -- zugesagt, abgesagt, unsicher, nicht_erreicht, whatsapp
  note TEXT,
  created_at TEXT NOT NULL,
  created_by INTEGER
);

-- Verlauf / Protokoll aller Änderungen
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,   -- event, registration, person, inquiry, shift, user, settings
  entity_id INTEGER,
  event_id INTEGER,            -- für den Reiter «Verlauf» eines Einsatzes
  person_id INTEGER,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,       -- lesbarer Text für «Letzte Aktivität»
  details JSON,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_person ON audit_log(person_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- Ausgehende E-Mails (auch wenn kein SMTP konfiguriert ist, bleibt der Text nachvollziehbar)
CREATE TABLE IF NOT EXISTS mail_outbox (
  id INTEGER PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  body_html TEXT,
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','gesendet','fehler','nicht_konfiguriert')),
  error TEXT,
  registration_id INTEGER,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

-- Kalender: feste UID je Termin, SEQUENCE steigt bei geändertem Inhalt
CREATE TABLE IF NOT EXISTS calendar_exports (
  uid TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  exported_at TEXT NOT NULL
);

-- Zwei-Faktor: angefangene Logins (Passwort ok, Code fehlt noch) und gemerkte Geräte
CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,         -- SHA-256 des Cookie-Tokens
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  next_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trusted_devices (
  id TEXT PRIMARY KEY,         -- SHA-256 des Cookie-Tokens
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
