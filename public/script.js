// ---------- Timezone helpers ----------

function getOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value; return acc;
  }, {});
  const asUTC = Date.UTC(
    parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day),
    parseInt(parts.hour), parseInt(parts.minute), parseInt(parts.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

function zonedTimeToUtc(y, mo, d, h, mi, s, timeZone) {
  let utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const offset = getOffsetMinutes(new Date(utcGuess), timeZone);
    utcGuess = Date.UTC(y, mo - 1, d, h, mi, s) - offset * 60000;
  }
  return new Date(utcGuess);
}

function getZoneAbbrev(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' });
  const part = dtf.formatToParts(date).find(p => p.type === 'timeZoneName');
  return part ? part.value : timeZone;
}

function formatInZone(date, timeZone, opts) {
  const dtf = new Intl.DateTimeFormat('en-US', Object.assign({
    timeZone, year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true
  }, opts || {}));
  return dtf.format(date);
}

const US_ZONE_LABELS = {
  'America/New_York': 'Eastern',
  'America/Chicago': 'Central',
  'America/Denver': 'Mountain',
  'America/Los_Angeles': 'Pacific'
};
const IST_ZONE = 'Asia/Kolkata';

// ---------- Flexible date parsing ----------
// Returns { y, mo, d, h, mi, s } in local wall-clock terms, or null if unparseable.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function parseFlexibleDate(raw) {
  if (!raw) return null;
  const str = raw.trim();
  if (!str) return null;

  let h = 0, mi = 0, s = 0;
  let timePart = null;
  let datePart = str;

  // Extract a trailing/leading time component like "10:00 AM" or "22:30"
  const timeMatch = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (timeMatch) {
    timePart = timeMatch;
    datePart = (str.slice(0, timeMatch.index) + ' ' + str.slice(timeMatch.index + timeMatch[0].length)).trim();
    let hh = parseInt(timeMatch[1]);
    const mm = parseInt(timeMatch[2]);
    const ss = timeMatch[3] ? parseInt(timeMatch[3]) : 0;
    const ampm = timeMatch[4] ? timeMatch[4].toLowerCase() : null;
    if (ampm === 'pm' && hh < 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;
    h = hh; mi = mm; s = ss;
  }
  datePart = datePart.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  let y, mo, d;

  // 1) YYYY-MM-DD or YYYY/MM/DD
  let m = datePart.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    y = parseInt(m[1]); mo = parseInt(m[2]); d = parseInt(m[3]);
    return finalize(y, mo, d, h, mi, s);
  }

  // 2) DD-Mon-YYYY or DD Mon YYYY (e.g. 09-Sep-2026, 27 Sep 1950)
  m = datePart.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) {
      d = parseInt(m[1]); mo = mon; y = parseInt(m[3]);
      return finalize(y, mo, d, h, mi, s);
    }
  }

  // 3) Month DD YYYY (e.g. September 27 1950, Sep 27 1950)
  m = datePart.match(/^([A-Za-z]{3,9})[-\s](\d{1,2})[-\s](\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) {
      mo = mon; d = parseInt(m[2]); y = parseInt(m[3]);
      return finalize(y, mo, d, h, mi, s);
    }
  }

  // 4) MM/DD/YYYY or DD/MM/YYYY (ambiguous - prefer MM/DD if first <=12, else DD/MM)
  m = datePart.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) {
    let a = parseInt(m[1]), b = parseInt(m[2]);
    y = parseInt(m[3]);
    if (y < 100) y += (y < 50 ? 2000 : 1900);
    if (a > 12 && b <= 12) { d = a; mo = b; }
    else { mo = a; d = b; } // default MM/DD/YYYY (US convention)
    return finalize(y, mo, d, h, mi, s);
  }

  // Fallback to native Date parsing as a last resort
  const native = new Date(str);
  if (!isNaN(native.getTime())) {
    return {
      y: native.getFullYear(), mo: native.getMonth() + 1, d: native.getDate(),
      h: timePart ? h : native.getHours(),
      mi: timePart ? mi : native.getMinutes(),
      s: timePart ? s : 0
    };
  }

  return null;
}

function finalize(y, mo, d, h, mi, s) {
  if (mo < 1 || mo > 12) return null;
  const daysInMonth = new Date(y, mo, 0).getDate();
  if (d < 1 || d > daysInMonth) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { y, mo, d, h, mi, s };
}

// ---------- Live clock ----------

function updateLiveClock() {
  const now = new Date();
  document.getElementById('clockUS').textContent = formatInZone(now, 'America/New_York', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', month: undefined, day: undefined, year: undefined });
  document.getElementById('clockUSMeta').textContent =
    formatInZone(now, 'America/New_York', { hour: undefined, minute: undefined }) + ' · ' + getZoneAbbrev(now, 'America/New_York');
  document.getElementById('clockIN').textContent = formatInZone(now, IST_ZONE, { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', month: undefined, day: undefined, year: undefined });
  document.getElementById('clockINMeta').textContent =
    formatInZone(now, IST_ZONE, { hour: undefined, minute: undefined }) + ' · ' + getZoneAbbrev(now, IST_ZONE);
}
setInterval(updateLiveClock, 1000);
updateLiveClock();

// ---------- Tabs ----------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('converterPanel').classList.toggle('hidden', tab !== 'converter');
    document.getElementById('agePanel').classList.toggle('hidden', tab !== 'age');
  });
});

// ---------- Time Converter ----------

let direction = 'US_TO_IN'; // or IN_TO_US

const dirUSBtn = document.getElementById('dirUStoIN');
const dirINBtn = document.getElementById('dirINtoUS');
const usZoneRow = document.getElementById('usZoneRow');
const usZoneSelect = document.getElementById('usZone');
const dateInput = document.getElementById('dateInput');
const dateInputLabel = document.getElementById('dateInputLabel');
const converterResult = document.getElementById('converterResult');
const swapBtn = document.getElementById('swapBtn');

function setDirection(newDir) {
  direction = newDir;
  dirUSBtn.classList.toggle('active', direction === 'US_TO_IN');
  dirINBtn.classList.toggle('active', direction === 'IN_TO_US');
  usZoneRow.style.display = direction === 'US_TO_IN' ? 'block' : 'none';
  dateInputLabel.textContent = direction === 'US_TO_IN' ? 'Date & Time (US side)' : 'Date & Time (India / IST)';
  runConversion();
}

dirUSBtn.addEventListener('click', () => setDirection('US_TO_IN'));
dirINBtn.addEventListener('click', () => setDirection('IN_TO_US'));
swapBtn.addEventListener('click', () => setDirection(direction === 'US_TO_IN' ? 'IN_TO_US' : 'US_TO_IN'));
usZoneSelect.addEventListener('change', runConversion);
dateInput.addEventListener('input', runConversion);

function runConversion() {
  const raw = dateInput.value;
  if (!raw.trim()) { converterResult.innerHTML = ''; return; }

  const parsed = parseFlexibleDate(raw);
  if (!parsed) {
    converterResult.innerHTML = `<div class="error-box">Could not understand that date/time. Try formats like "09-Sep-2026 10:00 AM".</div>`;
    return;
  }

  const sourceZone = direction === 'US_TO_IN' ? usZoneSelect.value : IST_ZONE;
  const targetZone = direction === 'US_TO_IN' ? IST_ZONE : usZoneSelect.value;

  const utcDate = zonedTimeToUtc(parsed.y, parsed.mo, parsed.d, parsed.h, parsed.mi, parsed.s, sourceZone);

  const sourceLabel = direction === 'US_TO_IN' ? US_ZONE_LABELS[usZoneSelect.value] + ' Time' : 'India (IST)';
  const targetLabel = direction === 'US_TO_IN' ? 'India (IST)' : US_ZONE_LABELS[usZoneSelect.value] + ' Time';

  const sourceStr = formatInZone(utcDate, sourceZone) + ' ' + getZoneAbbrev(utcDate, sourceZone);
  const targetStr = formatInZone(utcDate, targetZone) + ' ' + getZoneAbbrev(utcDate, targetZone);

  converterResult.innerHTML = `
    <div class="result-box">
      <div class="result-sub">${sourceLabel}</div>
      <div class="result-main" style="font-size:1.05rem;color:var(--text-dim);font-weight:600;">${sourceStr}</div>
      <div class="result-sub" style="margin-top:10px;">${targetLabel}</div>
      <div class="result-main">${targetStr}</div>
      <button class="copy-btn" id="copyConvBtn">Copy result</button>
    </div>
  `;
  document.getElementById('copyConvBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(`${sourceLabel}: ${sourceStr}  →  ${targetLabel}: ${targetStr}`);
  });
}

// ---------- Age Calculator ----------

const dobInput = document.getElementById('dobInput');
const ageResult = document.getElementById('ageResult');
const clearAgeBtn = document.getElementById('clearAgeBtn');

dobInput.addEventListener('input', runAgeCalc);
clearAgeBtn.addEventListener('click', () => { dobInput.value = ''; ageResult.innerHTML = ''; });

function runAgeCalc() {
  const raw = dobInput.value;
  if (!raw.trim()) { ageResult.innerHTML = ''; return; }

  const parsed = parseFlexibleDate(raw);
  if (!parsed) {
    ageResult.innerHTML = `<div class="error-box">Could not understand that date. Try formats like "27-Sep-1950".</div>`;
    return;
  }

  const dob = new Date(parsed.y, parsed.mo - 1, parsed.d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (dob.getTime() > today.getTime()) {
    ageResult.innerHTML = `<div class="error-box">That date of birth is in the future.</div>`;
    return;
  }

  let years = today.getFullYear() - dob.getFullYear();
  let months = today.getMonth() - dob.getMonth();
  let days = today.getDate() - dob.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthDate = new Date(today.getFullYear(), today.getMonth(), 0);
    days += prevMonthDate.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const totalDays = Math.floor((today - dob) / 86400000);

  ageResult.innerHTML = `
    <div class="stat-card">
      <div class="stat-number">${years}</div>
      <div class="stat-label">Years Old</div>
    </div>
    <div class="result-box">
      <div class="result-main">${years} Years · ${months} Months · ${days} Days</div>
      <div class="result-sub">Total of ${totalDays.toLocaleString()} days lived · Born ${formatInZone(dob, Intl.DateTimeFormat().resolvedOptions().timeZone, { hour: undefined, minute: undefined })}</div>
      <button class="copy-btn" id="copyAgeBtn">Copy age</button>
    </div>
  `;
  document.getElementById('copyAgeBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(`${years} Years, ${months} Months, ${days} Days old`);
  });
}
