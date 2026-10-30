'use strict';
// Minimaler multipart/form-data-Parser für einen einzelnen Datei-Upload (Import)

function single(fieldName, maxBytes) {
  return (req, res, next) => {
    const type = String(req.headers['content-type'] || '');
    const m = type.match(/^multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) return next();
    const boundary = Buffer.from(`--${m[1] || m[2]}`);
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes && !aborted) {
        aborted = true;
        next(new Error('Die Datei ist zu gross.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const buf = Buffer.concat(chunks);
        req.body = req.body || {};
        let pos = buf.indexOf(boundary);
        while (pos !== -1) {
          const start = pos + boundary.length;
          if (buf.subarray(start, start + 2).toString() === '--') break;
          const headerEnd = buf.indexOf('\r\n\r\n', start);
          const next = buf.indexOf(boundary, headerEnd);
          if (headerEnd === -1 || next === -1) break;
          const headers = buf.subarray(start + 2, headerEnd).toString('utf8');
          const content = buf.subarray(headerEnd + 4, next - 2);
          const name = headers.match(/name="([^"]*)"/i)?.[1];
          const filename = headers.match(/filename="([^"]*)"/i)?.[1];
          if (filename !== undefined) {
            if (name === fieldName && content.length) req.file = { filename, buffer: content };
          } else if (name) req.body[name] = content.toString('utf8');
          pos = next;
        }
        next();
      } catch (err) {
        next(err);
      }
    });
  };
}

module.exports = { single };
