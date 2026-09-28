import {plain, TYPE_LABELS, byteLength} from './value-codec.mjs';

// Firestore field paths: dots inside quoted names are literal, not nesting.
export function parseFieldPath(path) {
  if (typeof path !== 'string' || !path || byteLength(path) > 1500 || /[\u0000-\u001f\u007f]/.test(path))
    throw new Error('검색할 필드 경로를 확인하세요.');
  const parts = []; let i = 0;
  while (i < path.length) {
    let part = '';
    if (path[i] === '`') {
      i++; let closed = false;
      while (i < path.length) {
        const ch = path[i++];
        if (ch === '`') { closed = true; break; }
        if (ch === '\\') {
          if (!['`', '\\'].includes(path[i])) throw new Error('필드 경로의 이스케이프를 확인하세요.');
          part += path[i++];
        } else part += ch;
      }
      if (!closed) throw new Error('필드 경로의 닫는 백틱을 입력하세요.');
    } else {
      while (i < path.length && path[i] !== '.') {
        if (['`', '\\'].includes(path[i])) throw new Error('특수문자가 있는 필드 이름은 백틱으로 감싸세요.');
        part += path[i++];
      }
    }
    if (!part || (i < path.length && path[i] !== '.')) throw new Error('필드 경로를 확인하세요.');
    parts.push(part);
    if (path[i] === '.' && ++i === path.length) throw new Error('필드 경로가 점으로 끝날 수 없습니다.');
  }
  if (parts.length === 1 && parts[0] === '__name__') throw new Error('문서 ID는 전체 경로로 조회하세요.');
  return parts;
}

export function formatFieldPath(parts) {
  return parts.map(part => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? part : '`' + part.replaceAll('\\', '\\\\').replaceAll('`', '\\`') + '`').join('.');
}

export function fieldValue(fields, parts) {
  let value;
  for (const part of typeof parts === 'string' ? parseFieldPath(parts) : parts) {
    if (!plain(fields) || !Object.hasOwn(fields, part)) return undefined;
    value = fields[part]; fields = value?.mapValue?.fields;
  }
  return value;
}

export function collectFieldPaths(documents, limit = 500) {
  const found = new Map(); let truncated = false;
  function visit(fields, parents = []) {
    if (!plain(fields) || parents.length > 20) return;
    for (const [key, value] of Object.entries(fields)) {
      const parts = [...parents, key], path = formatFieldPath(parts), type = Object.keys(value || {})[0];
      if (!Object.hasOwn(TYPE_LABELS, type) || byteLength(path) > 1500 || path === '__name__') continue;
      if (!found.has(path)) {
        if (found.size >= limit) { truncated = true; continue; }
        found.set(path, new Set());
      }
      found.get(path).add(type);
      // Array element properties are not queryable field paths in Core queries.
      if (type === 'mapValue') visit(value.mapValue.fields, parts);
    }
  }
  for (const doc of documents) visit(doc.fields);
  return {fieldPaths: [...found].map(([path, types]) => ({path, types: [...types].sort()})).sort((a, b) => a.path.localeCompare(b.path)), fieldsTruncated: truncated};
}
