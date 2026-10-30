'use strict';
// Standard-Reihenfolge für Personenlisten: vom tiefsten zum höchsten Rang, innerhalb des Rangs nach Name.
// Personen ohne Rang stehen am Schluss. Erwartet die Aliase p (persons) und r (ranks).
const BY_RANK = 'coalesce(r.sort, 9999), p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE';

module.exports = { BY_RANK };
