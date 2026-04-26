/**
 * Natural language task parser
 * "remind David to pay rent the 1st of every month"
 * "buy groceries by Friday at 5pm 🔴"
 * "call dentist tomorrow 📍 clinic 🟡"
 */
const PRIORITY_MAP = { '🔴': 'high', '🟡': 'medium', '🟢': 'low', 'red': 'high', 'yellow': 'medium', 'green': 'low' };

function parseNLP(raw) {
  let text = raw.trim();
  let result = { title: text, priority: 'medium', tags: [], due_at: null, owner_hint: null };

  // Extract priority emoji/word
  for (const [k, v] of Object.entries(PRIORITY_MAP)) {
    if (text.includes(k)) { result.priority = v; text = text.replace(k, '').trim(); }
  }

  // Extract tags (📍, #tag, @location)
  const tagMatches = text.match(/(#\w+|@\w+)/g);
  if (tagMatches) {
    result.tags = tagMatches.map(t => t.slice(1));
    text = text.replace(/(#\w+|@\w+)/g, '').trim();
  }

  // Location hint
  const loc = text.match(/📍\s*([^\n🔴🟡🟢#@$]+)/);
  if (loc) { result.tags.push(loc[1].trim()); text = text.replace(loc[0], '').trim(); }

  // Owner hint (mention)
  const owner = text.match(/(@\w+)/);
  if (owner) { result.owner_hint = owner[1].slice(1); text = text.replace(owner[0], '').trim(); }

  // Date parsing
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // "today", "tomorrow", day names
  const DAY_MAP = { today: today };
  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  DAYS.forEach((d, i) => {
    const target = new Date(now);
    const diff = i - now.getDay();
    target.setDate(now.getDate() + (diff <= 0 ? diff + 7 : diff));
    DAY_MAP[d] = target.toISOString().slice(0, 10);
    DAY_MAP[d.slice(0, 3)] = DAY_MAP[d];
  });

  // Replace day names
  for (const [name, date] of Object.entries(DAY_MAP)) {
    if (text.toLowerCase().includes(` on ${name}`) || text.toLowerCase().includes(` ${name}`)) {
      result.due_at = date;
      text = text.replace(new RegExp(`\\b${name}\\b`, 'i'), '').trim();
    }
  }

  // "tomorrow"
  if (text.toLowerCase().includes('tomorrow')) {
    const tmrw = new Date(now); tmrw.setDate(now.getDate() + 1);
    result.due_at = tmrw.toISOString().slice(0, 10);
    text = text.replace(/tomorrow/gi, '').trim();
  }

  // "next week"
  if (text.toLowerCase().includes('next week')) {
    const nw = new Date(now); nw.setDate(now.getDate() + 7);
    result.due_at = nw.toISOString().slice(0, 10);
    text = text.replace(/next week/gi, '').trim();
  }

  // "1st of every month" / "the 15th" → recurrence
  const recur = text.match(/the\s+(\d+)(st|nd|rd|th)\s+of\s+every\s+month/i);
  if (recur) {
    result.recurrence = `monthly:${recur[1]}`;
    text = text.replace(recur[0], '').trim();
  }

  // Explicit date: YYYY-MM-DD or MM/DD or "December 5"
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) { result.due_at = dateMatch[1]; text = text.replace(dateMatch[0], '').trim(); }
  const md = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (md && !result.due_at) {
    const m = parseInt(md[1]) - 1;
    result.due_at = `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}-${String(parseInt(md[2])).padStart(2, '0')}`;
    text = text.replace(md[0], '').trim();
  }

  // "by Friday" or "due Friday"
  if (!result.due_at) {
    for (const [name, date] of Object.entries(DAY_MAP)) {
      if (text.toLowerCase().includes(`by ${name}`) || text.toLowerCase().includes(`due ${name}`)) {
        result.due_at = date;
        text = text.replace(new RegExp(`\\bby\\s+${name}\\b`, 'i'), '').replace(new RegExp(`\\bdue\\s+${name}\\b`, 'i'), '').trim();
      }
    }
  }

  // "by Friday at 5pm"
  if (result.due_at) {
    const timeMatch = text.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1]);
      if (timeMatch[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
      if (timeMatch[3]?.toLowerCase() === 'am' && h === 12) h = 0;
      const m = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      result.due_at = `${result.due_at}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
      text = text.replace(timeMatch[0], '').trim();
    }
  }

  // Clean up "remind X to" / "don't forget to"
  text = text.replace(/^(remind\s+\w+\s+to\s*)/i, '');
  text = text.replace(/^(don'?t\s+forget\s+to\s*)/i, '');

  result.title = text || raw.trim();
  return result;
}

module.exports = { parseNLP };
