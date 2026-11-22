// A fast, dependency-free reader for broken CSV text.
//
// run(input) answers {columns, rows, errors} for {text, header}, matching
// csv-reader 1.0.0's reading of the same input: one left-to-right pass,
// fields kept as strings, every broken thing recorded in the order it is met.
//
// How it stays fast: the common unquoted field is scanned once with
// charCodeAt and returned as a single slice (no per-character string
// building); quoted fields jump to their closing quote with indexOf and
// slice the value out, only walking the span character by character when it
// holds a line break. Nothing is allocated per field on the clean path.

const COMMA = 0;
const BREAK = 1;
const END = 2;

const CODE_COMMA = 44; // ,
const CODE_QUOTE = 34; // "
const CODE_CR = 13; // \r
const CODE_LF = 10; // \n
const CODE_BOM = 0xfeff;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === CODE_BOM) pos = 1;

  // The record being read: the line it starts on, and the index it takes in
  // rows (null while the header is still unread). Every error a record
  // meets is stamped with these two, never with the live line.
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended (COMMA, BREAK or END) and, for a field
  // read as unquoted, how many characters that read itself kept. Shared
  // out-parameters, so the hot path allocates no per-field result object.
  let fieldEnded = END;
  let fieldAdded = 0;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos, onto `prefix` ('' normally;
  // the opening quote for an unterminated field, or a quoted value plus its
  // junk). Returns the field string; how it ended lands in fieldEnded and
  // how many characters the unquoted read itself kept in fieldAdded.
  function readUnquoted(prefix) {
    let start = pos;
    let parts = null;
    let added = 0;
    let i = pos;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === CODE_COMMA) {
        const kept = parts === null
          ? text.slice(start, i)
          : parts.join('') + text.slice(start, i);
        pos = i + 1;
        fieldEnded = COMMA;
        fieldAdded = added + (i - start);
        return prefix === '' ? kept : prefix + kept;
      }
      if (c === CODE_LF) {
        const kept = parts === null
          ? text.slice(start, i)
          : parts.join('') + text.slice(start, i);
        pos = i + 1;
        line += 1;
        fieldEnded = BREAK;
        fieldAdded = added + (i - start);
        return prefix === '' ? kept : prefix + kept;
      }
      if (c === CODE_CR) {
        if (text.charCodeAt(i + 1) === CODE_LF) {
          const kept = parts === null
            ? text.slice(start, i)
            : parts.join('') + text.slice(start, i);
          pos = i + 2;
          line += 1;
          fieldEnded = BREAK;
          fieldAdded = added + (i - start);
          return prefix === '' ? kept : prefix + kept;
        }
        // A CR not followed by LF is dropped, and the field goes on.
        pushError('stray_cr');
        if (parts === null) parts = [];
        parts.push(text.slice(start, i));
        added += i - start;
        i += 1;
        start = i;
        continue;
      }
      i += 1;
    }
    const kept = parts === null
      ? text.slice(start, i)
      : parts.join('') + text.slice(start, i);
    pos = i;
    fieldEnded = END;
    fieldAdded = added + (i - start);
    return prefix === '' ? kept : prefix + kept;
  }

  // Reads a quoted field whose opening quote is at pos. One manual pass
  // finds the closing quote, folds line breaks to LF and counts them, and
  // turns doubled quotes into one -- so no second scan of the span.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let i = pos + 1;
    let start = i;
    let parts = null;
    let closed = -1;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === CODE_QUOTE) {
        if (text.charCodeAt(i + 1) === CODE_QUOTE) {
          if (parts === null) parts = [];
          parts.push(text.slice(start, i));
          parts.push('"');
          i += 2;
          start = i;
          continue;
        }
        closed = i;
        break;
      }
      if (c === CODE_CR) {
        if (parts === null) parts = [];
        parts.push(text.slice(start, i));
        parts.push('\n');
        line += 1;
        i += text.charCodeAt(i + 1) === CODE_LF ? 2 : 1;
        start = i;
        continue;
      }
      if (c === CODE_LF) {
        if (parts === null) parts = [];
        parts.push(text.slice(start, i));
        parts.push('\n');
        line += 1;
        i += 1;
        start = i;
        continue;
      }
      i += 1;
    }
    if (closed === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      pushError('unterminated_quote');
      return readUnquoted('"');
    }
    const value = parts === null
      ? text.slice(open + 1, closed)
      : parts.join('') + text.slice(start, closed);
    pos = closed + 1;
    if (pos >= n) {
      fieldEnded = END;
      fieldAdded = 0;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === CODE_COMMA) {
      pos += 1;
      fieldEnded = COMMA;
      fieldAdded = 0;
      return value;
    }
    if (c === CODE_LF) {
      pos += 1;
      line += 1;
      fieldEnded = BREAK;
      fieldAdded = 0;
      return value;
    }
    if (c === CODE_CR && text.charCodeAt(pos + 1) === CODE_LF) {
      pos += 2;
      line += 1;
      fieldEnded = BREAK;
      fieldAdded = 0;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (fieldAdded > 0) pushError('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines left with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === CODE_LF) {
        pos += 1;
        line += 1;
      } else if (c === CODE_CR && text.charCodeAt(pos + 1) === CODE_LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === CODE_QUOTE;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
      ended = fieldEnded;
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
