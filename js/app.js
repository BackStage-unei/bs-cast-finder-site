/* =============================================================
 * app.js — 画面遷移と描画（DOM生成は el() のみ。innerHTML禁止）
 *
 * 状態はこのファイルのローカル変数のみ（URLパラメータ・localStorage不使用）。
 * リロード＝導入画面に戻る（隠し紹介ページへの直リンクは存在しない）仕様。
 * ============================================================= */
(function () {
  'use strict';

  const app = document.getElementById('app');

  // ?bg=clear / ?bg=veil / ?bg=RRGGBB（埋め込み先に馴染ませる背景モードのみURLを見る）
  // STUDIOはカスタム埋め込みを不透明なサンドボックスiframeで包むため完全透過(clear)が
  // 効かない。その場合は埋め込み先セクションの色を ?bg=RRGGBB で指定して擬似透過にする
  const bg = new URLSearchParams(location.search).get('bg') || '';
  if (bg === 'clear') document.body.classList.add('bg-clear');
  else if (bg === 'veil') document.body.classList.add('bg-veil');
  else if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(bg)) document.body.style.background = '#' + bg;

  if (!window.FINDER || !window.FinderEngine) {
    app.appendChild(el('p', 'intro-lead', '準備中です。しばらくお待ちください。'));
    return;
  }

  const DATA = window.FINDER;
  const E = window.FinderEngine;

  // シフトは焼き込みデータで即座に動き、実行時にカレンダー公開データへ差し替える。
  // shift-data.js は同一オリジン（backstage-unei.github.io）なので CSP: script-src 'self' で
  // 読める（fetch は connect-src が無いため不可）。失敗時は焼き込みのまま＝従来動作。
  const LIVE_SHIFT_URL = 'https://backstage-unei.github.io/bs-shift-calendar-site/shift-data.js';
  let shiftIndex = E.buildShiftIndexFromIds(DATA.shifts.days);
  (function loadLiveShifts() {
    const s = document.createElement('script');
    s.src = LIVE_SHIFT_URL;
    s.async = true;
    s.onload = () => {
      try {
        const days = E.parseShiftcalWeeks(window.SHIFTCAL).days;
        const idx = E.buildShiftIndex(days, E.buildNameToId(DATA.casts));
        // ライブ側が空＝スキーマ変化や全滅の可能性。その場合は焼き込み（最大24h前）を使い続ける
        if (Object.keys(idx).length) shiftIndex = idx;
      } catch (e) { /* 変換不能なら焼き込みデータのまま */ }
    };
    document.head.appendChild(s);
  })();

  // 属性値 → 表示ラベル（マッチ理由タグ用）
  const ATTR_LABELS = {
    gender: { girl: '女の子', boy: '男の子' },
    avatar: { vtuber: 'VTuber', human: '大人な雰囲気', creature: '人外・どうぶつ' },
    time: { hiru: '昼活動', yoru: '夜型', shinya: '深夜組' },
    vibe: { iyashi: '癒し系', genki: '元気印', mystery: 'ミステリアス', otona: '大人っぽい' },
    genre: { zatsudan: '雑談', game: 'ゲーム', koe: '声', sake: 'お酒' },
    talk: { lead: 'リード上手', listen: '聞き上手', both: 'どんな話も' },
    beginner_ok: { true: 'はじめてさん歓迎' },
  };

  // ---- セッション状態（メモリのみ） ----
  let answers = {};
  let tiebreak = shuffle(DATA.casts.map((c) => c.id));
  let pool = [...tiebreak]; // 表示中の候補プール。縮むだけで、増えない
  let scoringCount = 0; // 加点のあった回答の数（無加点の「どちらでも」等ではプールを減らさない）
  let history = []; // 回答ごとのスナップショット（戻る用）: {qid, prevPool, prevScoring}

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function nowMinutesJST() {
    const parts = new Intl.DateTimeFormat('en-GB',
      { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date()).split(':');
    return (Number(parts[0]) % 24) * 60 + Number(parts[1]);
  }

  function currentScores() {
    return E.scoreAll(DATA.casts, answers, DATA.questions, shiftIndex, todayJST(), nowMinutesJST());
  }

  /** 加点のあった回答を1つ確定するたびに、現在のプールの中だけからスコア上位を残す。
   * 全キャストから取り直すと一度消えた候補が再登場してしまう（単調絞り込みの保証）。
   * スケジュールは「加点のあった回答の数」で進む——希望を伝えたときだけ減る。 */
  function shrinkPool(scoringAnswerCount) {
    const schedule = DATA.poolSchedule;
    const size = schedule[Math.min(scoringAnswerCount, schedule.length) - 1];
    pool = E.narrowPool(pool, currentScores(), tiebreak, size);
    return pool;
  }

  function castById(cid) {
    return DATA.casts.find((c) => c.id === cid);
  }

  function show(node) {
    app.textContent = '';
    node.classList.add('view-anim');
    app.appendChild(node);
    // アニメ再生し直し（同一クラスの再適用）
    void node.offsetWidth;
  }

  // ---- 導入 ----
  function renderIntro() {
    answers = {};
    tiebreak = shuffle(DATA.casts.map((c) => c.id));
    pool = [...tiebreak];
    scoringCount = 0;
    history = [];
    const v = el('div', 'intro');
    v.appendChild(el('h1', 'intro-title', 'あなたが話しやすいキャスト、\nさがします'));
    v.appendChild(el('p', 'intro-lead',
      'はじめてでも大丈夫。7つのしつもんに答えるだけで、あなたにぴったりのキャストが見つかります。'));
    v.appendChild(el('p', 'intro-count', `いま ${DATA.casts.length} 人のキャストが待っています`));
    const btn = el('button', 'btn-primary', 'はじめる');
    btn.addEventListener('click', () => renderQuestion(0));
    v.appendChild(btn);
    show(v);
  }

  // ---- 質問 ----
  function renderQuestion(qIndex) {
    const q = DATA.questions[qIndex];
    const v = el('div', 'question');

    if (qIndex > 0) {
      const back = el('button', 'back-link', '← まえの質問へ');
      back.addEventListener('click', () => {
        const last = history.pop();
        if (!last) return;
        delete answers[last.qid];
        pool = last.prevPool;
        scoringCount = last.prevScoring;
        renderQuestion(qIndex - 1);
      });
      v.appendChild(back);
    }

    const dots = el('div', 'dots');
    DATA.questions.forEach((_, i) => {
      const d = el('span', 'dot');
      if (i < qIndex) d.classList.add('done');
      if (i === qIndex) d.classList.add('current');
      dots.appendChild(d);
    });
    v.appendChild(dots);

    v.appendChild(el('p', 'q-text', q.text));

    const opts = el('div', 'q-options');
    let advancing = false; // フェード中の多重クリック防止
    for (const o of q.options) {
      const btn = el('button', 'q-option');
      btn.appendChild(el('span', 'emoji', o.emoji || ''));
      btn.appendChild(el('span', null, o.label));
      btn.addEventListener('click', () => {
        if (advancing) return;
        advancing = true;
        history.push({ qid: q.id, prevPool: pool, prevScoring: scoringCount });
        answers[q.id] = o.id;
        // 「今からいける！」は出勤該当者（出勤中 or 60分以内開始）がいれば
        // その人たちだけに絞る（ハード絞り込み）。いない時間帯は絞らず続行＝
        // 今日この後の待機者がスコア加点(+2)で浮き、相性上位と混ざって出る
        // フォールバック（バッジが「今日 HH:MM〜 出勤」等を説明する）
        if (o.special === 'shift_now') {
          const eligible = new Set(
            E.shiftEligibleIds(shiftIndex, pool, todayJST(), nowMinutesJST()));
          const filtered = pool.filter((cid) => eligible.has(cid));
          if (filtered.length) pool = filtered;
        }
        const next = () => {
          if (qIndex + 1 < DATA.questions.length) renderQuestion(qIndex + 1);
          else renderResult();
        };
        // 無加点の選択肢（どちらでも/まだ決めてない等）ではプールを減らさない
        const isNeutral = !o.special && !(o.effects || []).length;
        if (isNeutral) { next(); return; }
        scoringCount += 1;
        const keep = new Set(shrinkPool(scoringCount)); // ここでプール確定（単調減少）
        // 脱落するアイコンをフェードアウトさせてから次へ
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const grid = v.querySelector('.pool-grid');
        if (reduced || !grid) { next(); return; }
        let leaving = 0;
        for (const img of grid.children) {
          if (!keep.has(img.dataset.cid)) { img.classList.add('out'); leaving += 1; }
        }
        if (!leaving) { next(); return; }
        setTimeout(next, 420);
      });
      opts.appendChild(btn);
    }
    v.appendChild(opts);

    // 絞り込みプール（セッション状態の pool をそのまま描画。再計算しない）
    const poolBox = el('div', 'pool');
    const label = el('p', 'pool-label');
    label.appendChild(el('span', null, '残りの候補 '));
    label.appendChild(el('span', 'pool-count', String(pool.length)));
    label.appendChild(el('span', null, ' 人'));
    poolBox.appendChild(label);
    const grid = el('div', 'pool-grid');
    for (const cid of pool) {
      const c = castById(cid);
      const img = el('img', 'pool-icon');
      img.src = c.icon;
      img.alt = '';
      img.dataset.cid = cid;
      grid.appendChild(img);
    }
    poolBox.appendChild(grid);
    v.appendChild(poolBox);

    show(v);
  }

  // ---- マッチ理由タグ ----
  function matchTags(cast) {
    const tags = [];
    const byId = {};
    for (const q of DATA.questions) byId[q.id] = q;
    for (const qid of Object.keys(answers)) {
      const q = byId[qid];
      const opt = q && q.options.find((o) => o.id === answers[qid]);
      if (!opt) continue;
      if (opt.special === 'shift_now') continue; // 出勤はバッジで表現
      for (const eff of opt.effects || []) {
        if (E.attrMatches(cast.attrs, eff.attr, eff.value) && eff.points >= 2) {
          const label = (ATTR_LABELS[eff.attr] || {})[String(eff.value)];
          if (label && !tags.includes(label)) tags.push(label);
        }
      }
    }
    return tags;
  }

  // ---- 出勤バッジ ----
  function shiftBadge(cast) {
    const st = E.shiftStatus(shiftIndex, cast.id, todayJST(), nowMinutesJST());
    if (st.status === 'now') {
      const b = el('span', 'shift-badge now', '🟢 いま出勤中');
      return b;
    }
    if (st.status === 'later_today') return el('span', 'shift-badge', `今日 ${st.time}〜 出勤`);
    if (st.status === 'upcoming') return el('span', 'shift-badge', `次の出勤: ${formatDateJa(st.date)}`);
    return el('span', 'shift-badge', '次の出勤: 未定');
  }

  // ---- 結果 ----
  function renderResult() {
    // pool は最終プール（質問中に見えていた候補と必ず一致する）。
    // TOP1は最上部に大きく、残りは横カルーセル（縦の高さを一定に保ち、
    // iframe内部スクロールを発生させない=埋め込み先のスクロールを奪わない）
    const v = el('div', 'result');
    v.appendChild(el('p', 'result-heading', 'あなたにぴったりなのは……'));
    v.appendChild(castCard(castById(pool[0]), true));

    // 最後まで残った候補は全員そのままカルーセルへ（「もっと見る」は置かない）
    const others = pool.slice(1);
    if (others.length) {
      v.appendChild(el('p', 'result-heading', 'このキャストたちも気が合いそう'));
      const wrap = el('div', 'car-wrap');
      const car = el('div', 'carousel');
      for (const cid of others) car.appendChild(castCard(castById(cid), false));
      wrap.appendChild(car);
      // 左右にスワイプできることを示す浮遊矢印（端に達した側は消える）
      const prev = el('button', 'car-arrow car-prev', '‹');
      prev.setAttribute('aria-label', 'まえのキャストを見る');
      prev.addEventListener('click', () => car.scrollBy({ left: -212, behavior: 'smooth' }));
      const next = el('button', 'car-arrow car-next', '›');
      next.setAttribute('aria-label', '次のキャストを見る');
      next.addEventListener('click', () => car.scrollBy({ left: 212, behavior: 'smooth' }));
      const updateArrows = () => {
        prev.hidden = car.scrollLeft <= 16;
        next.hidden = car.scrollLeft + car.clientWidth >= car.scrollWidth - 16;
      };
      car.addEventListener('scroll', updateArrows, { passive: true });
      wrap.appendChild(prev);
      wrap.appendChild(next);
      v.appendChild(wrap);
      requestAnimationFrame(updateArrows); // 初期状態（1枚しか無い等）でも正しく判定
    }

    const retry = el('button', 'retry', 'もう一度さがす');
    retry.addEventListener('click', renderIntro);
    v.appendChild(retry);
    show(v);
  }

  function castCard(cast, isTop) {
    const card = el('div', `cast-card ${isTop ? 'top' : 'sub'}`);
    const img = el('img', 'cast-icon');
    img.src = cast.icon;
    img.alt = cast.name;
    card.appendChild(img);
    card.appendChild(el('p', 'cast-name', cast.name));
    if (cast.rank) card.appendChild(el('p', `rank-badge ${cast.rank}`, cast.rank.toUpperCase()));
    card.appendChild(shiftBadge(cast));
    const tags = matchTags(cast);
    if (tags.length) {
      const wrap = el('div', 'match-tags');
      for (const t of tags) wrap.appendChild(el('span', 'match-tag', t));
      card.appendChild(wrap);
    }
    // 全員サイト内の紹介ページへ（画面から離れないUXで統一。2026-07-25にshowcase遷移を廃止）
    const btn = el('button', 'cast-cta', 'プロフィールを見る →');
    btn.addEventListener('click', () => renderProfile(cast));
    card.appendChild(btn);
    return card;
  }

  // ---- 紹介ページ（URLなし・テスト通過者のみ。ランク勢はextraで情報量が厚い） ----
  function renderProfile(cast) {
    const v = el('div', 'profile');
    // ランク勢はCastRank(showcase)の意匠（明朝・二重罫線・CLASSバッジ・ヘアライン）を移植
    const ranked = !!cast.rank;
    const card = el('div', `cast-card top profile-card${ranked ? ` ranked rank-${cast.rank}` : ''}`);
    if (ranked) {
      card.appendChild(el('div', 'pr-frame'));
      card.appendChild(el('span', 'pr-watermark', cast.rank.toUpperCase()));
    }
    const img = el('img', 'cast-icon');
    img.src = cast.icon;
    img.alt = cast.name;
    card.appendChild(img);
    card.appendChild(el('p', `cast-name${ranked ? ' pr-name' : ''}`, cast.name));
    if (ranked) card.appendChild(el('p', `rank-badge ${cast.rank}`, `${cast.rank.toUpperCase()} CLASS`));
    card.appendChild(shiftBadge(cast));
    if (cast.profile && cast.profile.catch) {
      card.appendChild(el('p', `profile-catch${ranked ? ' pr-catch' : ''}`, cast.profile.catch));
    }
    if (cast.appUrl) {
      // BackStageアプリで直接会いに行けるDeeplink（未インストール時はストアへ）
      const a = el('a', 'btn-primary app-link', 'アプリで会いにいく');
      a.href = cast.appUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      card.appendChild(a);
    }
    if (cast.extra) {
      // ランク勢の追加情報（公開showcase由来: タグ・スペック・Xリンク）
      if (cast.extra.tags.length) {
        const wrap = el('div', 'match-tags');
        for (const t of cast.extra.tags) wrap.appendChild(el('span', 'match-tag', t));
        card.appendChild(wrap);
      }
      if (cast.extra.specs.length) {
        const list = el('dl', 'spec-list');
        for (const s of cast.extra.specs) {
          list.appendChild(el('dt', 'spec-label', s.label));
          list.appendChild(el('dd', 'spec-value', s.value));
        }
        card.appendChild(list);
      }
      if (cast.extra.xUrl) {
        const x = el('a', 'cast-cta', 'X（旧Twitter）を見る →');
        x.href = cast.extra.xUrl;
        x.target = '_blank';
        x.rel = 'noopener';
        card.appendChild(x);
      }
    }
    if (cast.profile && cast.profile.intro) {
      card.appendChild(el('p', 'profile-intro', cast.profile.intro));
    } else {
      // 暫定期: 属性タグの軽量表示
      const wrap = el('div', 'match-tags');
      for (const attr of ['vibe', 'talk', 'time', 'genre']) {
        const values = Array.isArray(cast.attrs[attr]) ? cast.attrs[attr] : [cast.attrs[attr]];
        for (const val of values) {
          const label = (ATTR_LABELS[attr] || {})[String(val)];
          if (label) wrap.appendChild(el('span', 'match-tag', label));
        }
      }
      card.appendChild(wrap);
    }
    v.appendChild(card);

    const back = el('button', 'retry', '結果にもどる');
    back.addEventListener('click', renderResult);
    v.appendChild(back);
    show(v);
  }

  renderIntro();

  // テスト検証用フック（Playwrightが全キャストのプロフィール高さを検査するために使う。
  // データは元々finder-data.jsで全公開されているため、これによる秘匿性の低下はない）
  window.__openProfile = (cid) => {
    const c = castById(cid);
    if (c) renderProfile(c);
    return !!c;
  };
})();
