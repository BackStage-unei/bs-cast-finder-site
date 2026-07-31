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

  /** シフト名⇔キャスト名照合用の正規化（全角空白→半角・連続空白畳み込み・trim） */
  function normalizeCastName(name) {
    return String(name || '').replace(/[\s　]+/g, ' ').trim();
  }

  /** 正規化済み名前 → cast id のマップ（シフト名照合は必ずこれを使う） */
  function buildNameToId(casts) {
    const map = {};
    for (const c of casts) map[normalizeCastName(c.name)] = c.id;
    return map;
  }

  /** shift-data.js の SHIFTCAL 週構造 → shifts正準形（Python: parse_shiftcal_weeks と同一） */
  function parseShiftcalWeeks(shiftcal) {
    const byDate = {};
    const weeks = (shiftcal && shiftcal.weeks) || {};
    for (const weekStart of Object.keys(weeks).sort()) {
      for (const day of weeks[weekStart].days || []) {
        byDate[day.date] = {
          date: day.date,
          slots: (day.slots || []).map((s) => ({ time: s.t, names: s.n || [] })),
        };
      }
    }
    return { days: Object.keys(byDate).sort().map((k) => byDate[k]) };
  }

  function buildShiftIndex(shiftDays, nameToId) {
    const index = {};
    for (const day of shiftDays) {
      for (const slot of day.slots || []) {
        const minutes = parseSlotMinutes(slot.time);
        if (minutes === null) continue;
        for (const name of slot.names || []) {
          const cid = nameToId[normalizeCastName(name)];
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

  /** 「今からいける」該当者: いま出勤中 or 今日この後 windowMinutes 分以内に開始。
   * ids の順序を保持して返す（プールとの積集合に使うため）。 */
  function shiftEligibleIds(shiftIndex, ids, today, nowMinutes, windowMinutes = 60) {
    const out = [];
    for (const cid of ids) {
      const st = shiftStatus(shiftIndex, cid, today, nowMinutes);
      if (st.status === 'now') { out.push(cid); continue; }
      if (st.status === 'later_today') {
        const start = parseSlotMinutes(st.time);
        if (start !== null && start - nowMinutes <= windowMinutes) out.push(cid);
      }
    }
    return out;
  }

  function scoreCast(cast, answers, questionsById, shiftIndex, today, nowMinutes) {
    let total = 0;
    for (const qid of Object.keys(answers)) {
      const q = questionsById[qid];
      if (!q) continue;
      const opt = q.options.find((o) => o.id === answers[qid]);
      if (!opt) continue;
      if (opt.special === 'shift_now') {
        // now+3 / later_today+2: ハード絞り込み時は「出勤中＞これから」の順位、
        // 該当ゼロのフォールバック時は「今日この後の待機者」が相性勢より浮く重み
        const st = shiftStatus(shiftIndex, cast.id, today, nowMinutes);
        if (st.status === 'now') total += 3;
        else if (st.status === 'later_today') total += 2;
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
    attrMatches, parseSlotMinutes, normalizeCastName, buildNameToId, parseShiftcalWeeks, buildShiftIndex, buildShiftIndexFromIds,
    shiftStatus, shiftEligibleIds, scoreCast, scoreAll, poolIds, narrowPool,
  };
})(typeof window !== 'undefined' ? window : globalThis);
