'use strict';
// Reihenfolge für Personenlisten nach Rang, innerhalb des Rangs nach Name. Personen ohne Rang stehen am Schluss.
// Standard: tiefster Rang zuerst; umschaltbar auf «höchster zuerst». Erwartet die Aliase p (persons) und r (ranks).
const NAME = 'p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE';
const BY_RANK = `r.sort IS NULL, r.sort ASC, ${NAME}`;
const BY_RANK_DESC = `r.sort IS NULL, r.sort DESC, ${NAME}`;

// Wert des Auswahlfelds «Sortierung» -> ORDER BY. «rang» (Standard) = tief → hoch, «rang_ab» = hoch → tief.
// «rang_auf» stammt aus älteren Links und bedeutet ebenfalls tief → hoch.
const rankOrder = (sort) => (sort === 'rang_ab' ? BY_RANK_DESC : BY_RANK);

// Optionen für die Auswahlfelder
const RANK_SORT_OPTIONS = [['rang', 'Rang: tief → hoch'], ['rang_ab', 'Rang: hoch → tief']];

module.exports = { BY_RANK, BY_RANK_DESC, NAME, rankOrder, RANK_SORT_OPTIONS };
