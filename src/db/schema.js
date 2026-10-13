'use strict';
/**
 * SQL-Schema + Migrationen.
 * Jede Migration wird genau einmal ausgeführt; die erreichte Version steht in meta.schema_version.
 */

const MIGRATIONS = [
  // ---------- Version 1 ----------
  `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Geräte / Prüflinge
  CREATE TABLE devices (
    id                   INTEGER PRIMARY KEY,
    inventory_no         TEXT NOT NULL UNIQUE,          -- Inventar-/Prüflingsnummer (z. B. G-0001)
    name                 TEXT NOT NULL,                 -- Bezeichnung
    manufacturer         TEXT,
    model                TEXT,                          -- Typ / Modell
    serial_no            TEXT,
    category             TEXT,                          -- z. B. Elektrowerkzeug, Haushalt, IT …
    protection_class     TEXT NOT NULL DEFAULT 'SK I'
                         CHECK (protection_class IN ('SK I','SK II','SK III')),
    device_type          TEXT NOT NULL DEFAULT 'standard', -- standard|heating|electronic|it|extension|battery
    connection_type      TEXT NOT NULL DEFAULT 'plug',     -- plug|fixed|terminals
    phases               INTEGER NOT NULL DEFAULT 1,
    rated_voltage        REAL,                          -- V
    rated_power          REAL,                          -- W
    rated_current        REAL,                          -- A
    heating_power_kw     REAL,                          -- kW (für Grenzwerte bei Heizgeräten)
    cable_length_m       REAL,                          -- Länge Anschluss-/Verlängerungsleitung
    cable_cross_section  REAL,                          -- mm²
    location             TEXT,                          -- Standort / Raum
    owner                TEXT,                          -- Eigentümer / Nutzer
    purchase_date        TEXT,
    interval_months      INTEGER NOT NULL DEFAULT 12,   -- Prüfintervall
    status               TEXT NOT NULL DEFAULT 'aktiv', -- aktiv|gesperrt|reparatur|ausgemustert
    reminder_enabled     INTEGER NOT NULL DEFAULT 1,
    last_inspection_date TEXT,
    last_result          TEXT,
    next_due_date        TEXT,
    notes                TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_devices_due    ON devices(next_due_date);
  CREATE INDEX idx_devices_status ON devices(status);

  -- Prüfungen (eine Zeile je durchgeführter Prüfung)
  CREATE TABLE inspections (
    id               INTEGER PRIMARY KEY,
    device_id        INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    inspection_date  TEXT NOT NULL,                     -- Prüfdatum (automatisch: Prüftag)
    started_at       TEXT,
    finished_at      TEXT,
    standard         TEXT NOT NULL,                     -- VDE 0701 | VDE 0702
    reason           TEXT,                              -- erstpruefung|wiederholung|instandsetzung|aenderung
    procedure        TEXT NOT NULL,                     -- AUTO|SK1|SK2|SK3|EDV|VL|FEST
    mode             TEXT NOT NULL,                     -- secutest-geraet|secutest-pc|manuell
    protection_class TEXT,
    limit_profile    TEXT,
    inspector        TEXT,
    result           TEXT NOT NULL,                     -- bestanden|nicht_bestanden|abgebrochen
    device_verdict   TEXT,                              -- Bewertung durch das SECUTEST selbst (PRO?)
    action           TEXT,                              -- Maßnahme bei Nichtbestehen
    action_note      TEXT,
    interval_months  INTEGER,
    next_due_date    TEXT,
    meter_idn        TEXT,                              -- Identifikation des Prüfgeräts (IDN?)
    raw_protocol     TEXT,                              -- Rohdaten (PRO?-String)
    notes            TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_inspections_device ON inspections(device_id, inspection_date);

  -- Messwerte einer Prüfung
  CREATE TABLE measurements (
    id            INTEGER PRIMARY KEY,
    inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    step          TEXT,
    key           TEXT NOT NULL,      -- RSL, RISO, UISO, IEA, IB, ISONDE, UAC, UDC, DI, P, S, PF, U, I, F, W …
    label         TEXT,
    point         TEXT,               -- Messpunkt
    value         REAL,
    value_text    TEXT,               -- Originalanzeige, z. B. ">310.0"
    unit          TEXT,
    limit_value   REAL,
    limit_op      TEXT,               -- '<=' | '>='
    limit_text    TEXT,
    passed        INTEGER,            -- 1 = ok, 0 = nicht ok, NULL = nur Information
    source        TEXT,               -- secutest | manuell
    sort          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_measurements_inspection ON measurements(inspection_id);

  -- Sicht- und Funktionsprüfung (Checklisten)
  CREATE TABLE inspection_checks (
    id            INTEGER PRIMARY KEY,
    inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    group_name    TEXT NOT NULL,      -- sicht | funktion | sonstiges
    item          TEXT NOT NULL,
    label         TEXT,
    passed        INTEGER,            -- 1 ok, 0 Mangel, NULL nicht zutreffend
    note          TEXT,
    sort          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_checks_inspection ON inspection_checks(inspection_id);

  -- Fotos / Dokumente (verschlüsselt in der DB)
  CREATE TABLE attachments (
    id            INTEGER PRIMARY KEY,
    device_id     INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    inspection_id INTEGER REFERENCES inspections(id) ON DELETE SET NULL,
    filename      TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    data          BLOB NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_attachments_device ON attachments(device_id);

  -- Versendete Erinnerungen (verhindert Doppelversand)
  CREATE TABLE reminder_log (
    id         INTEGER PRIMARY KEY,
    device_id  INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    due_date   TEXT,
    kind       TEXT NOT NULL,         -- z. B. before-30, before-7, due, overdue-2026-11-01, invite
    channel    TEXT NOT NULL,         -- mail | calendar
    recipient  TEXT,
    sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
    ok         INTEGER NOT NULL DEFAULT 1,
    error      TEXT
  );
  CREATE INDEX idx_reminder_device ON reminder_log(device_id, due_date, kind);

  -- Änderungsprotokoll
  CREATE TABLE audit_log (
    id        INTEGER PRIMARY KEY,
    ts        TEXT NOT NULL DEFAULT (datetime('now')),
    action    TEXT NOT NULL,
    entity    TEXT,
    entity_id INTEGER,
    details   TEXT
  );
  `,
];

module.exports = { MIGRATIONS, SCHEMA_VERSION: MIGRATIONS.length };
