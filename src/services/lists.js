'use strict';
// Teilnehmerliste und Verpflegungsliste als PDF, Excel oder CSV.
// Beide gibt es für den ganzen Einsatz, pro Schicht (je ein Block) oder für eine einzelne Schicht.
const settings = require('./settings');
const registrations = require('./registrations');
const externals = require('./externals');
const functions = require('./functions');
const h = require('../lib/view-helpers');
const { tablePdf } = require('../lib/pdf');
const { REG_STATUS } = require('../lib/labels');

const SORT_TEXT = { rang_ab: 'höchster Rang zuerst', funktion: 'nach Funktion, dann Rang' };
const sortText = (sort) => SORT_TEXT[sort] || 'tiefster Rang zuerst';
const persons = (n) => `${n} ${n === 1 ? 'Person' : 'Personen'}`;
const meals = (n) => `${n} Essen`;
const HINT_NOTE = '«Hinweis vorhanden»: Nach dem Einsatz sieht die genaue Angabe nur noch ein Admin.';

// Kopfzeilen: Datum, Antreten, Leitung (bei einer Schicht eines mehrtägigen Einsatzes deren Tag und Zeit)
function headLine(e, shift) {
  const leader = e.leader_person_id ? `Leitung ${[e.leader_rank, e.leader_first, e.leader_last].filter(Boolean).join(' ')}` : '';
  return [shift && h.isMultiDay(e) ? h.fmtShiftWhen(shift, true) : h.fmtEventDate(e, 'wd'), e.start_time ? `Antreten ${e.start_time}${e.start_place ? ` · ${e.start_place}` : ''}` : '', leader].filter(Boolean).join('  ·  ');
}

const footer = () => `${settings.get('verein_name') || 'KKB'} · KKB-Einsatzplaner · Stand ${h.fmtDateTime(h.nowIso())}`;
const scopeLabel = (filters) => registrations.PARTICIPANT_SCOPES[filters.umfang].label;
const modeLabel = (v) => (v.shift ? '' : v.perShift ? 'pro Schicht' : 'ganzer Einsatz');
const fileName = (base) => base.replace(/[^\w\-äöüÄÖÜ]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

// Essenseinschränkung einer Person als Zelle
const dietCell = (r) => (!r.diet.has ? { text: '–', muted: true } : !r.diet.visible ? { text: r.diet.label, muted: true } : { text: r.diet.label, bold: true });
const dietLine = (summary) => summary.map(([l, n]) => `${n} ${l}`).join(' · ');

// ---------- Teilnehmerliste ----------

function participantColumns(e, v, { showShift }) {
  const columns = [
    { label: 'Nr.', fit: true, align: 'right', value: (r, i) => String(i + 1) },
    ...(v.showFunction ? [{ label: 'Fkt.', fit: true, value: (r) => (r.func.is_default ? { text: r.func.short, muted: true } : { text: r.func.short, bold: true }) }] : []),
    { label: 'Rang', fit: true, value: (r) => r.rank_short || '' },
    { label: 'Name', width: 2, value: (r) => ({ text: `${r.first_name} ${r.last_name}`, bold: true }) },
    { label: 'Mobil', fit: true, value: (r) => r.mobile || '–' },
    { label: 'Essenseinschränkungen', width: 2.6, value: dietCell },
  ];
  if (showShift) columns.push({ label: 'Schicht', width: 1.5, value: v.shiftOf });
  if (v.showStatus) columns.push({ label: 'Status', fit: true, value: (r) => REG_STATUS[r.status].short });
  const extColumns = [
    { label: 'Abteilung', width: 2, value: (x) => ({ text: x.unit_name, bold: true }) },
    { label: 'Personen', fit: true, align: 'right', value: (x) => ({ text: String(x.person_count), bold: true }) },
    ...(v.showFunction ? [{ label: 'Fkt.', fit: true, value: (x) => x.func.short }] : []),
    ...(showShift ? [{ label: 'Schicht', width: 1.3, value: (x) => externals.shiftLabel(x, e.shifts) }] : []),
    { label: 'Essenseinschränkungen', width: 2.2, value: (x) => (x.dietLabel ? { text: x.dietLabel, bold: true } : { text: '–', muted: true }) },
    { label: 'Kontakt', width: 1.6, value: (x) => x.contact || '–' },
    { label: 'Bemerkung', width: 1.4, value: (x) => x.note || '' },
  ];
  return { columns, extColumns };
}

const rowsOf = (columns, list) => list.map((r, i) => columns.map((c) => c.value(r, i)));

function verpflegungAfter(list, exts) {
  if (!list.length && !exts.length) return [];
  const summary = registrations.dietSummary(list, exts);
  return [
    { label: 'Verpflegung:', text: dietLine(summary) },
    ...(summary.some(([l]) => l === 'Hinweis vorhanden') ? [{ text: HINT_NOTE, muted: true }] : []),
  ];
}

function participantPdf(e, v) {
  const extTotal = v.extTotal;
  const subtitle = [
    headLine(e, v.shift),
    [scopeLabel(v.filters), modeLabel(v), `${persons(v.list.length)}${extTotal ? ` + ${extTotal} extern = ${v.list.length + extTotal} total` : ''}`, sortText(v.filters.sort)].filter(Boolean).join(' · '),
  ];
  const title = `Teilnehmerliste · ${e.name}${v.shift ? ` · ${v.shift.name}` : ''}`;
  if (v.perShift) {
    const { columns, extColumns } = participantColumns(e, v, { showShift: false });
    const sections = [];
    v.groups.forEach((g) => {
      const head = {
        title: `${g.title} · ${persons(g.list.length)}${g.extTotal ? ` + ${g.extTotal} extern` : ''}`,
        pageBreak: true,
        subtitle: v.showFunction && g.fnSummary ? [`Funktionen (Ist/Soll): ${functions.line(g.fnSummary)}`] : [],
        columns, rows: rowsOf(columns, g.list), empty: 'Niemand eingeteilt.',
      };
      sections.push(head);
      if (g.exts.length) sections.push({ title: `Externe Abteilungen · ${persons(g.extTotal)}`, small: true, columns: extColumns, rows: rowsOf(extColumns, g.exts) });
      sections[sections.length - 1].after = verpflegungAfter(g.list, g.exts);
    });
    return tablePdf({ title, subtitle, sections, footer: footer() });
  }
  const { columns, extColumns } = participantColumns(e, v, { showShift: v.showShift });
  return tablePdf({
    title,
    subtitle: [...subtitle, ...(v.showFunction ? [`Funktionen (Ist/Soll): ${functions.line(v.fnSummary)}`] : [])],
    columns, rows: rowsOf(columns, v.list), empty: 'Noch niemand angemeldet.',
    sections: v.exts.length ? [{ title: `Externe Abteilungen · ${persons(extTotal)}`, columns: extColumns, rows: rowsOf(extColumns, v.exts) }] : [],
    after: verpflegungAfter(v.list, v.exts),
    footer: footer(),
  });
}

// Excel/CSV: eine Zeile pro Person; externe Abteilungen als eigene Zeilen (Rang «extern», Spalte «Anzahl»).
// Pro Schicht: vorne die Spalte «Schicht», jede Schicht nacheinander.
function participantTable(e, v) {
  const blocks = v.perShift ? v.groups.map((g) => ({ g, list: g.list, exts: g.exts })) : [{ g: null, list: v.list, exts: v.exts }];
  const anyExt = blocks.some((b) => b.exts.length);
  const rows = blocks.flatMap((b) => [...b.list.map((r, i) => ({ r, i, g: b.g })), ...b.exts.map((x) => ({ ext: x, g: b.g }))]);
  const col = (label, person, ext = () => '') => ({ label, value: (row) => (row.ext ? ext(row.ext) : person(row.r, row.i)) });
  const cols = [
    ...(v.perShift ? [{ label: 'Schicht', value: (row) => row.g.title }] : []),
    col('Nr.', (r, i) => i + 1),
    ...(anyExt ? [col('Anzahl', () => 1, (x) => x.person_count)] : []),
    ...(v.showFunction ? [col('Funktion', (r) => r.func.short, (x) => x.func.short)] : []),
    col('Rang', (r) => r.rank_short || '', () => 'extern'),
    col('Nachname', (r) => r.last_name, (x) => x.unit_name),
    col('Vorname', (r) => r.first_name),
    col('Mobil', (r) => r.mobile || '', (x) => x.contact || ''),
    col('Essenseinschränkung', (r) => (r.diet.visible ? r.diet.category : r.diet.label), (x) => x.dietLabel),
    col('Details', (r) => r.diet.text, (x) => x.note || ''),
    ...(v.showShift ? [col('Schicht', v.shiftOf, (x) => externals.shiftLabel(x, e.shifts))] : []),
    ...(v.showStatus ? [col('Status', (r) => REG_STATUS[r.status].short)] : []),
  ];
  return { cols, rows };
}

const participantName = (e, v) => `Teilnehmerliste ${e.name}${v.shift ? ` ${v.shift.name}` : v.perShift ? ' pro Schicht' : ''}`;

// ---------- Verpflegungsliste ----------

// Tabelle «Essen»: Bezeichnung + Anzahl, unten das Total
function summaryTable(block) {
  const columns = [
    { label: 'Essen', width: 3 },
    { label: 'Anzahl', fit: true, align: 'right' },
  ];
  const rows = block.summary.map(([l, n]) => [l === 'ohne Einschränkung' ? l : { text: l, bold: true }, String(n)]);
  rows.push([{ text: 'Total Essen', bold: true }, { text: String(block.total), bold: true }]);
  return { columns, rows };
}

// Tabelle Bezeichnung × Schicht mit Total (ganzer Einsatz mit mehreren Schichten)
function matrixTable(m) {
  const columns = [
    { label: 'Essen', width: 2.4 },
    ...m.cols.map((c) => ({ label: c.label, width: 1, align: 'right' })),
    { label: 'Ganzer Einsatz', fit: true, align: 'right' },
  ];
  const rows = m.rows.map((r) => [r.label === 'ohne Einschränkung' ? r.label : { text: r.label, bold: true }, ...r.values.map((n) => (n ? String(n) : { text: '–', muted: true })), { text: String(r.total), bold: true }]);
  rows.push([{ text: 'Total Essen', bold: true }, ...m.totals.map((n) => ({ text: String(n), bold: true })), { text: String(m.total), bold: true }]);
  return { columns, rows };
}

function peopleColumns(e, { showShift, shiftOf }) {
  return [
    { label: 'Nr.', fit: true, align: 'right', value: (r, i) => String(i + 1) },
    { label: 'Rang', fit: true, value: (r) => r.rank_short || '' },
    { label: 'Name', width: 2, value: (r) => ({ text: `${r.first_name} ${r.last_name}`, bold: true }) },
    { label: 'Essenseinschränkung', fit: true, value: (r) => (r.diet.visible ? { text: r.diet.category || 'andere', bold: true } : { text: r.diet.label, muted: true }) },
    { label: 'Details', width: 2.6, value: (r) => r.diet.text || '' },
    ...(showShift ? [{ label: 'Schicht', width: 1.4, value: shiftOf }] : []),
  ];
}

function extDietColumns(e, { showShift }) {
  return [
    { label: 'Abteilung', width: 2, value: (x) => ({ text: x.unit_name, bold: true }) },
    { label: 'Personen', fit: true, align: 'right', value: (x) => String(x.person_count) },
    { label: 'Essenseinschränkungen', width: 3, value: (x) => (x.dietLabel ? { text: x.dietLabel, bold: true } : { text: 'keine Angaben', muted: true }) },
    ...(showShift ? [{ label: 'Schicht', width: 1.3, value: (x) => externals.shiftLabel(x, e.shifts) }] : []),
  ];
}

// Abschnitte für einen Block (ganzer Einsatz, eine Schicht): Personen mit Einschränkung und externe Abteilungen mit Angaben
function detailSections(e, block, { showShift, shiftOf }) {
  const out = [];
  const pc = peopleColumns(e, { showShift, shiftOf });
  out.push({ title: `Personen mit Essenseinschränkungen · ${block.people.length}`, small: true, columns: pc, rows: rowsOf(pc, block.people), empty: 'Keine eigenen Personen mit Essenseinschränkungen.' });
  const ex = [...block.extDiets, ...block.extNoInfo];
  if (ex.length) {
    const xc = extDietColumns(e, { showShift });
    out.push({ title: `Externe Abteilungen · ${persons(block.extTotal)}`, small: true, columns: xc, rows: rowsOf(xc, ex) });
  }
  return out;
}

const mealCount = (b) => `${meals(b.total)}${b.extTotal ? ` (${persons(b.persons)} + ${b.extTotal} extern)` : ''}`;

function mealPdf(e, v) {
  const title = `Verpflegungsliste · ${e.name}${v.shift ? ` · ${v.shift.name}` : ''}`;
  const subtitle = [
    headLine(e, v.shift),
    [scopeLabel(v.filters), modeLabel(v), v.perShift ? '' : mealCount(v.all), sortText(v.filters.sort)].filter(Boolean).join(' · '),
  ];
  const hint = v.all.summary.some(([l]) => l === 'Hinweis vorhanden') ? [{ text: HINT_NOTE, muted: true }] : [];
  if (v.perShift) {
    const sections = [];
    for (const g of v.groups) {
      const t = summaryTable(g);
      sections.push({ title: `${g.title} · ${mealCount(g)}`, ...t });
      sections.push(...detailSections(e, g, { showShift: false }));
    }
    return tablePdf({ title, subtitle, sections, after: hint, footer: footer() });
  }
  const t = v.matrix ? matrixTable(v.matrix) : summaryTable(v.all);
  const after = [
    ...(v.matrix?.overlap ? [{ text: 'Wer in mehreren Schichten eingeteilt ist, zählt in jeder dieser Schichten. In «Ganzer Einsatz» zählt jede Person einmal.', muted: true }] : []),
    ...hint,
  ];
  return tablePdf({
    title, subtitle, ...t,
    sections: detailSections(e, v.all, { showShift: v.showShift, shiftOf: v.shiftOf }),
    after, footer: footer(),
  });
}

// Excel/CSV: eine Zeile pro Schicht und Bezeichnung, mit Anzahl und den Namen dazu
function mealTable(e, v) {
  const blocks = v.shiftBlocks
    ? [...v.shiftBlocks.map((g) => ({ label: g.title, b: g })), ...(v.perShift ? [] : [{ label: 'Ganzer Einsatz', b: v.all }])]
    : [{ label: v.shift ? registrations.shiftTitle(e, v.shift) : 'Ganzer Einsatz', b: v.all }];
  const key = (r) => (!r.diet.has ? 'ohne Einschränkung' : !r.diet.visible ? 'Hinweis vorhanden' : r.diet.category || 'andere');
  const who = (b, label) => {
    if (label === 'ohne Einschränkung') return '';
    const own = b.list.filter((r) => key(r) === label)
      .map((r) => `${[r.rank_short, r.first_name, r.last_name].filter(Boolean).join(' ')}${r.diet.visible && r.diet.text ? ` (${r.diet.text})` : ''}`);
    const ext = b.exts.flatMap((x) => (label === 'extern (keine Angaben)' ? (!x.dietList.length ? [`${x.unit_name} ${x.person_count}×`] : [])
      : x.dietList.filter((d) => d.label === label).map((d) => `${x.unit_name} ${d.count}×${d.text ? ` (${d.text})` : ''}`)));
    return [...own, ...ext].join(', ');
  };
  const rows = blocks.flatMap(({ label, b }) => [
    ...b.summary.map(([l, n]) => ({ schicht: label, essen: l, anzahl: n, wer: who(b, l) })),
    { schicht: label, essen: 'Total Essen', anzahl: b.total, wer: '' },
  ]);
  const cols = [
    { label: 'Schicht', value: (r) => r.schicht },
    { label: 'Essen', value: (r) => r.essen },
    { label: 'Anzahl', value: (r) => r.anzahl },
    { label: 'Wer', value: (r) => r.wer },
  ];
  return { cols, rows };
}

const mealName = (e, v) => `Verpflegungsliste ${e.name}${v.shift ? ` ${v.shift.name}` : v.perShift ? ' pro Schicht' : ''}`;

module.exports = { participantPdf, participantTable, participantName, mealPdf, mealTable, mealName, fileName };
