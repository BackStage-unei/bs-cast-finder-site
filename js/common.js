/* =============================================================
 * common.js — 日付・時刻ユーティリティ（フレームワーク非依存の純関数）
 *
 * 日付は常に "YYYY-MM-DD" 文字列で扱う。
 * `new Date("YYYY-MM-DD")` のローカル解釈ずれを避けるため、
 * Date は必ず Date.UTC 経由で組み立てる。
 * ============================================================= */

/** 日本時間での今日を "YYYY-MM-DD" で返す */
function todayJST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

/** "YYYY-MM-DD" → [year, month, day]（数値） */
function dateParts(s) {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

/** "YYYY-MM-DD" に日数を加算 */
function addDays(s, n) {
  const [y, m, d] = dateParts(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 曜日番号（0=月 〜 6=日）。shift-manager と同じ月曜始まり */
function weekdayIndex(s) {
  const [y, m, d] = dateParts(s);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** その日を含む週の月曜日を返す（データ週の単位。shift-manager と同じ） */
function weekStartOf(s) {
  return addDays(s, -weekdayIndex(s));
}

/** その日を含む「日曜始まりの週」の日曜日を返す（月カレンダー表示用） */
function sundayStartOf(s) {
  return addDays(s, -((weekdayIndex(s) + 1) % 7));
}

const WEEKDAY_JA = ['月', '火', '水', '木', '金', '土', '日'];
const WEEKDAY_EN = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** "2026-07-21" → "7/21（火）" */
function formatDateJa(s) {
  const [, m, d] = dateParts(s);
  return `${m}/${d}（${WEEKDAY_JA[weekdayIndex(s)]}）`;
}

/** "2026-07" → "2026年7月" */
function formatMonthJa(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

/** "YYYY-MM"（月キー）を n ヶ月ずらす */
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

/**
 * 夜順スロットの時刻ラベル変換（scripts/shiftcal_lib.py の time_labels と同仕様）。
 * - raw（デフォルト）: 素の表記のまま（0:00〜3:00）。実X画像と同じ表記
 *   であることを 2026-07-23 に実データと突合して確定済み。
 * - plus24: 折り返し以降を +24 表記（例: 0:00 → 24:00）。
 * 変更時は Python 側も合わせること。
 */
function timeLabels(slotTimes, style = 'raw') {
  if (style === 'raw') return [...slotTimes];
  const labels = [];
  let firstHour = null;
  let wrapped = false;
  for (const t of slotTimes) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    if (!m) { labels.push(t); continue; }
    const hour = Number(m[1]);
    if (firstHour === null) firstHour = hour;
    else if (hour < firstHour) wrapped = true;
    labels.push(`${wrapped ? hour + 24 : hour}:${m[2]}`);
  }
  return labels;
}

/** createElement ヘルパー（テキストは常に textContent 経由 = XSS安全） */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
