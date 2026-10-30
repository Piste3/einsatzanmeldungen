'use strict';
// Reihenfolge für Personenlisten nach Rang, innerhalb des Rangs nach Name. Personen ohne Rang stehen am Schluss.
// Standard: höchster Rang zuerst; umschaltbar auf «tiefster zuerst». Erwartet die Aliase p (persons) und r (ranks).
const NAME = 'p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE';
const BY_RANK = `r.sort IS NULL, r.sort DESC, ${NAME}`;
const BY_RANK_ASC = `r.sort IS NULL, r.sort ASC, ${NAME}`;

// Wert des Auswahlfelds «Sortierung» -> ORDER BY
const rankOrder = (sort) => (sort === 'rang_auf' ? BY_RANK_ASC : BY_RANK);

// Optionen für die Auswahlfelder
const RANK_SORT_OPTIONS = [['rang', 'Rang: hoch → tief'], ['rang_auf', 'Rang: tief → hoch']];

module.exports = { BY_RANK, BY_RANK_ASC, NAME, rankOrder, RANK_SORT_OPTIONS };
