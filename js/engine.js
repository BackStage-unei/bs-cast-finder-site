/* =============================================================
 * engine.js — スコアリング・絞り込みエンジン（純関数のみ）
 *
 * scripts/finder_lib.py と同一ロジック。変更時は必ずPython側も同時に
 * 変更し、共有ベクタ（scripts/tests/vectors/）を両側で通すこと。
 * ブラウザでは window.FinderEngine、Node(テスト)では globalThis.FinderEngine。
 * ============================================================= */
(function (global) {
  'use strict';

  const SLOT_MINUTES = 60;

  function attrMatches(attrs, attr, value) {
    const have = attrs[attr];
    if (Array.isArray(have)) return have.includes(value);
    return have === value;
  }

  function parseSlotMinutes(timeStr) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr || '');
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function buildShiftIndex(shiftDays, nameToId) {
    const index = {};
    for (const day of shiftDays) {
      for (const slot of day.slots || []) {
        const minutes = parseSlotMinutes(slot.time);
        if (minutes === null) continue;
        for (const name of slot.names || []) {
          const cid = nameToId[name];
          if (cid === undefined) continue;
          (index[cid] = index[cid] || []).push([day.date, minutes, slot.time]);
        }
      }
    }
    for (const cid of Object.keys(index)) {
      index[cid].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    }
    return index;
  }

  /** payload形式（slots[].ids）から直接インデックスを作る（app.js用） */
  function buildShiftIndexFromIds(shiftDays) {
    const index = {};
    for (const day of shiftDays) {
      for (const slot of day.slots || []) {
        const minutes = parseSlotMinutes(slot.time);
        if (minutes === null) continue;
        for (const cid of slot.ids || []) {
          (index[cid] = index[cid] || []).push([day.date, minutes, slot.time]);
        }
      }
    }
    for (const cid of Object.keys(index)) {
      index[cid].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    }
    return index;
  }

  function shiftStatus(shiftIndex, castId, today, nowMinutes) {
    const none = { status: 'none', date: null, time: null };
    const entries = shiftIndex[castId];
    if (!entries || !entries.length) return none;
    let laterToday = null;
    let upcoming = null;
    for (const [date, minutes, timeStr] of entries) {
      if (date === today) {
        if (minutes <= nowMinutes && nowMinutes < minutes + SLOT_MINUTES) {
          return { status: 'now', date, time: timeStr };
        }
        if (minutes > nowMinutes && laterToday === null) {
          laterToday = { status: 'later_today', date, time: timeStr };
        }
      } else if (date > today && upcoming === null) {
        upcoming = { status: 'upcoming', date, time: timeStr };
      }
    }
    return laterToday || upcoming || none;
  }

  function scoreCast(cast, answers, questionsById, shiftIndex, today, nowMinutes) {
    let total = 0;
    for (const qid of Object.keys(answers)) {
      const q = questionsById[qid];
      if (!q) continue;
      const opt = q.options.find((o) => o.id === answers[qid]);
      if (!opt) continue;
      if (opt.special === 'shift_now') {
        const st = shiftStatus(shiftIndex, cast.id, today, nowMinutes);
        if (st.status === 'now') total += 2;
        else if (st.status === 'later_today') total += 1;
        continue;
      }
      const best = {};
      for (const eff of opt.effects || []) {
        if (attrMatches(cast.attrs, eff.attr, eff.value)) {
          best[eff.attr] = Math.max(best[eff.attr] || 0, eff.points);
        }
      }
      for (const attr of Object.keys(best)) total += best[attr];
    }
    return total;
  }

  function scoreAll(casts, answers, questions, shiftIndex, today, nowMinutes) {
    const byId = {};
    for (const q of questions) byId[q.id] = q;
    const scores = {};
    for (const c of casts) scores[c.id] = scoreCast(c, answers, byId, shiftIndex, today, nowMinutes);
    return scores;
  }

  /** 前回プールの中だけからスコア上位 size 名を選ぶ（単調絞り込み）。
   * 全キャストからの取り直しだと一度消えた候補が再登場し得るため、
   * UIの「候補が減っていく」という約束を守るには必ずこれで縮めること。 */
  function narrowPool(pool, scores, tiebreakOrder, size) {
    const scoped = {};
    for (const cid of pool) {
      if (cid in scores) scoped[cid] = scores[cid];
    }
    return poolIds(scoped, tiebreakOrder, size);
  }

  function poolIds(scores, tiebreakOrder, size) {
    const rank = {};
    tiebreakOrder.forEach((cid, i) => { rank[cid] = i; });
    const n = tiebreakOrder.length;
    return Object.keys(scores)
      .sort((a, b) => (scores[b] - scores[a]) || ((rank[a] ?? n) - (rank[b] ?? n)))
      .slice(0, size);
  }

  global.FinderEngine = {
    attrMatches, parseSlotMinutes, buildShiftIndex, buildShiftIndexFromIds,
    shiftStatus, scoreCast, scoreAll, poolIds, narrowPool,
  };
})(typeof window !== 'undefined' ? window : globalThis);
