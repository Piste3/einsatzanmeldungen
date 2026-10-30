'use strict';
// Export jeder Liste als Excel (.xlsx) oder CSV – genau mit den sichtbaren Filtern und Spalten.
const { writeXlsx } = require('./xlsx');
const { writeCsv } = require('./csv');
const { today } = require('./dates');

// columns: [{ label, value: (row) => any }]
function sendTable(res, format, baseName, columns, rows) {
  const headers = columns.map((c) => c.label);
  const data = rows.map((r) => columns.map((c) => {
    const v = c.value(r);
    return v === undefined ? '' : v;
  }));
  const safe = String(baseName).replace(/[^\w\-äöüÄÖÜ]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const file = `${safe}_${today()}`;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(`${file}.csv`));
    return res.send(writeCsv(headers, data));
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', contentDisposition(`${file}.xlsx`));
  return res.send(writeXlsx(headers, data, baseName));
}

function contentDisposition(name) {
  const ascii = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function wantsExport(req) {
  const f = req.query.format;
  return f === 'csv' || f === 'xlsx' ? f : null;
}

module.exports = { sendTable, wantsExport, contentDisposition };
