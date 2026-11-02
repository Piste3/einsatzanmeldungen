'use strict';
// Formatierte Texte (Bestätigungsmail, Kalendertermin): kleiner HTML-Parser ohne Zusatzbibliothek.
// - sanitize: nur erlaubte Tags, Attribute und CSS-Eigenschaften bleiben übrig
// - toText: Klartext-Fassung (für Mailprogramme ohne HTML und die Kalender-Beschreibung)
// - renderTemplate: Bausteine ersetzen und Zeilen mit leerem Baustein weglassen

const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'wbr', 'area', 'base', 'source']);
// Inhalt komplett verwerfen
const DROP = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'embed', 'svg', 'math', 'template',
  'noscript', 'xml', 'meta', 'link', 'form', 'input', 'button', 'select', 'textarea', 'img', 'video', 'audio', 'canvas']);
const ALLOWED = new Set(['p', 'div', 'span', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup',
  'font', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'small', 'big', 'mark',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col']);
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'blockquote', 'pre', 'hr', 'caption', 'colgroup', 'center']);
const ATTRS = {
  '*': ['style', 'title', 'align', 'dir'],
  a: ['href', 'target'],
  font: ['color', 'face', 'size'],
  table: ['border', 'cellpadding', 'cellspacing', 'width'],
  td: ['colspan', 'rowspan', 'width', 'valign'],
  th: ['colspan', 'rowspan', 'width', 'valign'],
  col: ['span', 'width'],
  ol: ['start', 'type'],
};
const CSS_PROPS = new Set(['color', 'background-color', 'background', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'text-decoration-line', 'text-align', 'vertical-align', 'line-height', 'width', 'min-width', 'max-width', 'height',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-style', 'border-width',
  'border-collapse', 'border-spacing', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'white-space', 'list-style-type']);

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü',
  Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', agrave: 'à', laquo: '«', raquo: '»', ndash: '–',
  mdash: '—', hellip: '…', euro: '€', copy: '©', middot: '·', bull: '•', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
  });
}

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

/** HTML -> Baum aus { tag, attrs, children } und { text } (tolerant, wie ein Browser im Kleinen) */
function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;
  let m;
  const top = () => stack[stack.length - 1];
  while ((m = re.exec(String(html || '')))) {
    const [tok, closeTag, openTag, attrSrc] = m;
    if (closeTag) {
      const tag = closeTag.toLowerCase();
      const idx = stack.map((n) => n.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
    } else if (openTag) {
      const tag = openTag.toLowerCase();
      // implizit schliessen: neues <li>, <tr>, <td>, <p> beendet das vorherige
      const closes = { li: ['li'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], p: ['p'] }[tag];
      while (closes && stack.length > 1 && closes.includes(top().tag)) stack.pop();
      const node = { tag, attrs: parseAttrs(attrSrc || ''), children: [] };
      if (DROP.has(tag) || tag.includes(':')) node.drop = true;
      top().children.push(node);
      const selfClosing = /\/\s*$/.test(attrSrc || '');
      if (!VOID.has(tag) && !selfClosing) stack.push(node);
    } else if (tok[0] !== '<' || tok === '<') {
      const t = top();
      const last = t.children[t.children.length - 1];
      const text = decode(tok);
      if (last && last.text !== undefined) last.text += text;
      else t.children.push({ text });
    }
  }
  return root;
}

function cleanStyle(style) {
  const out = [];
  for (const decl of String(style || '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!CSS_PROPS.has(prop) || !value) continue;
    if (/url\s*\(|expression|javascript:|[<>\\]|@import|behavior/i.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join('; ');
}

function cleanHref(href) {
  const v = String(href || '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(v) || /^\{\{[^}]+\}\}$/.test(v) || v.startsWith('#')) return v;
  if (/^www\./i.test(v)) return `https://${v}`;
  return '';
}

function sanitizeNode(node) {
  const out = [];
  for (const c of node.children) {
    if (c.text !== undefined) { out.push({ text: c.text }); continue; }
    if (c.drop) continue;
    const children = sanitizeNode(c);
    let tag = c.tag;
    if (tag === 'center') tag = 'div';
    if (!ALLOWED.has(tag)) { out.push(...children); continue; } // Tag weg, Inhalt bleibt
    const attrs = {};
    for (const [k, v] of Object.entries(c.attrs)) {
      if (!(ATTRS['*'].includes(k) || (ATTRS[tag] || []).includes(k))) continue;
      if (k === 'style') { const s = cleanStyle(v); if (s) attrs.style = s; continue; }
      if (k === 'href') { const href = cleanHref(v); if (href) attrs.href = href; continue; }
      if (k === 'target') { attrs.target = '_blank'; continue; }
      if (/[<>]|javascript:/i.test(v)) continue;
      attrs[k] = v;
    }
    if (c.tag === 'center') attrs.style = `text-align: center${attrs.style ? `; ${attrs.style}` : ''}`;
    out.push({ tag, attrs, children });
  }
  return out;
}

function serialize(nodes) {
  let s = '';
  for (const n of nodes) {
    if (n.text !== undefined) { s += escText(n.text); continue; }
    const attrs = Object.entries(n.attrs || {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
    s += `<${n.tag}${attrs}>`;
    if (VOID.has(n.tag)) continue;
    s += `${serialize(n.children)}</${n.tag}>`;
  }
  return s;
}

/** Bereinigtes HTML (nur erlaubte Tags/Attribute/Stile) */
function sanitize(html) {
  return serialize(sanitizeNode(parse(html))).trim();
}

/** Klartext aus HTML: Absätze und <br> werden Zeilen, Tabellenzellen mit « | » getrennt */
function toText(html) {
  const nodes = typeof html === 'string' ? sanitizeNode(parse(html)) : html;
  let out = '';
  const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const walk = (list, ctx) => {
    for (const n of list) {
      if (n.text !== undefined) {
        out += ctx.pre ? n.text : n.text.replace(/[ \t\r\n]+/g, ' ');
        continue;
      }
      const tag = n.tag;
      if (tag === 'br') { out += '\n'; continue; }
      if (tag === 'hr') { nl(); out += '————————————\n'; continue; }
      if (tag === 'tr') {
        // Zellen mit « | » getrennt; leere Zellen am Ende und ganz leere Zeilen weglassen
        const cells = n.children.filter((c) => c.tag === 'td' || c.tag === 'th').map((c) => toText(c.children).replace(/\s*\n\s*/g, ' '));
        while (cells.length && !cells[cells.length - 1]) cells.pop();
        if (cells.length) { nl(); out += `${cells.join(' | ')}\n`; }
        continue;
      }
      if (tag === 'ul' || tag === 'ol') {
        nl();
        walk(n.children, { ...ctx, list: { ordered: tag === 'ol', n: Number(n.attrs?.start) || 1 }, depth: (ctx.depth || 0) + 1 });
        nl();
        continue;
      }
      if (tag === 'li') {
        nl();
        const indent = '  '.repeat(Math.max(0, (ctx.depth || 1) - 1));
        out += ctx.list?.ordered ? `${indent}${ctx.list.n++}. ` : `${indent}• `;
        walk(n.children, ctx);
        nl();
        continue;
      }
      if (tag === 'a') {
        const start = out.length;
        walk(n.children, ctx);
        const label = out.slice(start).trim();
        const href = n.attrs?.href || '';
        const plain = href.replace(/^mailto:|^tel:/i, '');
        if (href && label && label !== href && label !== plain) out += ` (${plain})`;
        else if (href && !label) out += plain;
        continue;
      }
      if (BLOCK.has(tag)) {
        nl();
        walk(n.children, { ...ctx, pre: ctx.pre || tag === 'pre' });
        nl();
        if (/^h[1-6]$|^p$|^table$|^blockquote$/.test(tag) && !ctx.inCell) out += '\n';
        continue;
      }
      walk(n.children, ctx);
    }
  };
  walk(nodes, {});
  return out.replace(/ /g, ' ').split('\n').map((l) => l.replace(/[ \t]+$/, '').replace(/^ (?=\S)/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Klartext -> HTML (eine Zeile = ein <div>, wie im Editor) */
function textToHtml(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  return lines.map((l) => `<div>${l ? escText(l) : '<br>'}</div>`).join('');
}

const TOKEN = /\{\{\s*([\w.\-äöüÄÖÜ ]+?)\s*\}\}/g;
const EMPTY = ''; // Platzhalter für einen leeren Baustein

function lookup(values, key) {
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  const lower = key.toLowerCase();
  const found = Object.keys(values).find((k) => k.toLowerCase() === lower);
  return found ? values[found] : '';
}

function replaceTokens(nodes, values) {
  const out = [];
  for (const n of nodes) {
    if (n.text === undefined) {
      if (n.attrs?.href) n.attrs.href = cleanHref(n.attrs.href.replace(TOKEN, (_, k) => encodeURI(String(lookup(values, k) ?? ''))));
      out.push({ ...n, children: replaceTokens(n.children, values) });
      continue;
    }
    let last = 0;
    let buf = '';
    for (const m of n.text.matchAll(TOKEN)) {
      buf += n.text.slice(last, m.index);
      last = m.index + m[0].length;
      const v = lookup(values, m[1]);
      if (v === null || v === undefined || v === '') { buf += EMPTY; continue; }
      const lines = String(v).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (i > 0) { out.push({ text: buf }); out.push({ tag: 'br', attrs: {}, children: [] }); buf = ''; }
        buf += line;
      });
    }
    buf += n.text.slice(last);
    if (buf) out.push({ text: buf });
  }
  return out;
}

const hasEmpty = (n) => (n.text !== undefined ? n.text.includes(EMPTY) : n.children.some(hasEmpty));
const textOf = (n) => (n.text !== undefined ? n.text : n.children.map(textOf).join(''));
const isBlank = (n) => !textOf(n).replace(/[\s ]/g, '') && !(function anyHr(x) { return x.tag === 'hr' || (x.children || []).some(anyHr); }(n));
const isEmptyLine = (n) => n.tag && ['div', 'p'].includes(n.tag) && isBlank(n);

// Zeilen (Text zwischen <br> bzw. Absätzen) mit leerem Baustein entfernen.
// Gibt true zurück, wenn im Inhalt etwas entfernt wurde.
function omitLines(el) {
  let removed = false;
  const kept = [];
  let seg = [];
  const flush = (br) => {
    const all = br ? [...seg, br] : seg;
    if (seg.some(hasEmpty)) removed = true;
    else kept.push(...all);
    seg = [];
  };
  for (const c of el.children) {
    if (c.tag === 'br') { flush(c); continue; }
    if (c.text !== undefined || !BLOCK.has(c.tag)) { seg.push(c); continue; }
    flush(null);
    const had = omitLines(c);
    if (had) removed = true;
    if (c.tag === 'tr' && had) continue; // Tabellenzeile mit leerem Baustein fällt ganz weg
    if (had && isBlank(c) && !['td', 'th'].includes(c.tag)) continue;
    if (had && ['table', 'tbody', 'thead', 'tfoot', 'ul', 'ol'].includes(c.tag) && !c.children.some((x) => x.tag)) continue;
    kept.push(c);
  }
  flush(null);
  el.children = kept;
  return removed;
}

// Mehrere leere Zeilen hintereinander zu einer zusammenfassen, leere Zeilen am Anfang/Ende weg
function tidy(nodes) {
  const out = [];
  for (const n of nodes) {
    if (isEmptyLine(n) && out.length && isEmptyLine(out[out.length - 1])) continue;
    out.push(n);
  }
  while (out.length && isEmptyLine(out[0])) out.shift();
  while (out.length && (isEmptyLine(out[out.length - 1]) || (out[out.length - 1].text !== undefined && !out[out.length - 1].text.trim()))) out.pop();
  return out;
}

function stripMarker(nodes) {
  return nodes.map((n) => (n.text !== undefined ? { text: n.text.replaceAll(EMPTY, '') } : { ...n, children: stripMarker(n.children) }));
}

/** Bausteine in einer HTML-Vorlage ersetzen. Liefert { html, text } */
function renderTemplate(html, values, { omitEmptyLines = false } = {}) {
  const root = { tag: '#root', attrs: {}, children: replaceTokens(sanitizeNode(parse(html)), values) };
  if (omitEmptyLines) omitLines(root);
  const nodes = tidy(stripMarker(root.children));
  return { html: serialize(nodes), text: toText(nodes) };
}

/** Vollständiges HTML-Dokument für Mail und Kalender (Grundschrift, Tabellen) */
function htmlDocument(body, { title = '' } = {}) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `${title ? `<title>${escText(title)}</title>` : ''}`
    + '<style>table{border-collapse:collapse}td,th{vertical-align:top}p{margin:0 0 10px}</style></head>'
    + '<body style="margin:0;padding:12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1c2333">'
    + `${body}</body></html>`;
}

module.exports = { parse, sanitize, toText, textToHtml, renderTemplate, htmlDocument, escText };
