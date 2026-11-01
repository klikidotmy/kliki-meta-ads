// KLIKI Meta Ads — paparan. Data dari Apps Script (lihat apps-script/Code.gs).
(function () {
  'use strict';
  const C = window.CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- storan kecil (boleh gagal dalam private mode) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } },
  };

  const state = { pin: store.get('kads_pin'), period: store.get('kads_period') || 'maximum', tab: 'ringkasan', data: null, sort: { key: 'spend', dir: -1 }, q: '', catOutlet: 'ALL' };

  // ---------- format ----------
  const nf2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });
  const rm = (v) => (v == null || !isFinite(v) ? '—' : 'RM' + nf2.format(v));
  const int = (v) => (v == null || !isFinite(v) ? '—' : nf0.format(v));
  const pct = (v, d = 0) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d) + '%');
  const dec = (v, d = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const div = (a, b) => (b ? a / b : null);
  const PERIOD_LABEL = { maximum: 'Sejak mula', today: 'Hari ini', yesterday: 'Semalam', last_7d: '7 hari lepas', last_14d: '14 hari lepas', this_month: 'Bulan ini', last_month: 'Bulan lepas' };
  const STATUS = { ACTIVE: ['Aktif', 'good'], PAUSED: ['Dihentikan', 'na'], CAMPAIGN_PAUSED: ['Kempen henti', 'na'], ADSET_PAUSED: ['Ad set henti', 'na'], WITH_ISSUES: ['Ada isu', 'bad'], DISAPPROVED: ['Ditolak', 'bad'], PENDING_REVIEW: ['Disemak', 'warn'], IN_PROCESS: ['Diproses', 'warn'], ARCHIVED: ['Arkib', 'na'], DELETED: ['Dipadam', 'na'] };
  const statusPill = (s) => { const m = STATUS[s] || [s || '—', 'na']; return `<span class="pill ${m[1]}">${esc(m[0])}</span>`; };
  const shortOutlet = (n) => {
    let s = String(n || '');
    if (s.includes(' - ')) s = s.split(' - ').slice(1).join(' - ');
    return s.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+\d+\s?km.*$/i, '').trim() || String(n || '—');
  };
  // Nama iklan: "OUTLET | Kategori | Angle"
  const parseAd = (name) => {
    const p = String(name || '').split('|').map((x) => x.trim()).filter(Boolean);
    return { outlet: p[0] || '—', cat: p[1] || 'Lain-lain', angle: p.length > 2 ? p.slice(2).join(' · ') : (p[1] ? 'Utama' : String(name || '—')) };
  };

  // ---------- kiraan (satu tempat) ----------
  function compute(d) {
    const a = d.account || {};
    const days = (d.daily || []).filter((r) => r.spend > 1).length;
    const budgetDay = d.budgetPerDay || 0;
    const chatDay = budgetDay / C.targets.costPerChat;
    const clickDay = chatDay / C.targets.clickToChat;
    const k = {
      spend: a.spend, chats: a.chats, links: a.link_clicks, reach: a.reach, impressions: a.impressions,
      cpm: a.cpm, freq: a.frequency, ctr: a.ctr,
      cpr: a.chats ? a.spend / a.chats : null,
      rate: div(a.chats, a.link_clicks),
      reachShare: div(a.reach, a.impressions),
      days, budgetDay, chatDay, clickDay,
      budget: budgetDay * days, chatTarget: chatDay * days, clickTarget: clickDay * days,
    };
    k.spendPct = k.budget ? a.spend / k.budget : null;
    k.chatPct = k.chatTarget ? a.chats / k.chatTarget : null;
    k.clickPct = k.clickTarget ? a.link_clicks / k.clickTarget : null;
    const adsets = (d.adsets || []).map((s) => ({ ...s, label: shortOutlet(s.name), cpr: s.chats ? s.spend / s.chats : null, rate: div(s.chats, s.link_clicks) }));
    const withChat = adsets.filter((s) => s.cpr != null).sort((x, y) => x.cpr - y.cpr);
    k.best = withChat[0] || null;
    k.worst = withChat.length > 1 ? withChat[withChat.length - 1] : null;
    const ads = (d.ads || []).map((r) => ({ ...r, ...parseAd(r.name), cpr: r.chats ? r.spend / r.chats : null }));
    return { k, adsets, ads };
  }

  // ---------- bar prestasi ----------
  function statusOf(cfg, v) { for (const [upto, s] of cfg.segs) if (v < upto) return s; return cfg.segs[cfg.segs.length - 1][1]; }
  const WORD = { good: 'Bagus', warn: 'Sederhana', bad: 'Lemah' };
  function meter(cfg, v, cap, wordFn) {
    if (v == null || !isFinite(v)) return { pill: '<span class="pill na">Tiada data</span>', html: `<div class="meter"><p class="m-cap">${esc(cap || 'Belum cukup data untuk tempoh ini.')}</p></div>` };
    const s = statusOf(cfg, v);
    const pos = (x) => (Math.max(0, Math.min(x, cfg.max)) / cfg.max) * 100;
    let prev = 0;
    const segs = cfg.segs.map(([upto, z]) => { const w = ((upto - prev) / cfg.max) * 100; prev = upto; return `<i class="m-seg ${z}" style="width:${w}%"></i>`; }).join('');
    const ref = cfg.ref != null ? `<i class="m-ref" style="left:${pos(cfg.ref)}%"></i>` : '';
    const word = wordFn ? wordFn(s, v) : WORD[s];
    return {
      pill: `<span class="pill ${s}">${esc(word)}</span>`,
      html: `<div class="meter" role="img" aria-label="${esc(word + '. ' + cap)}"><div class="m-track">${segs}${ref}<i class="m-needle" style="left:${pos(v)}%"></i></div><p class="m-cap">${esc(cap)}</p></div>`,
    };
  }

  function kpiCard(label, value, def, m) {
    return `<div class="card"><div class="kc-top"><span class="label">${esc(label)}</span>${m.pill}</div><div class="kc-val">${value}</div><div class="kc-def">${esc(def)}</div>${m.html}</div>`;
  }

  // ---------- carta (SVG tangan, gaya Marketing Dashboard) ----------
  function barChart(rows, opt) {
    if (!rows.length) return '<div class="empty">Tiada data untuk tempoh ini.</div>';
    const W = 640, H = 220, m = { t: 22, r: 6, b: 26, l: 30 };
    const max = Math.max(1, ...rows.map((r) => r.v));
    const step = (W - m.l - m.r) / rows.length;
    const bw = Math.min(34, step * 0.62);
    const y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
    const ticks = [0, Math.ceil(max / 2), max];
    const hlIdx = opt.highlight != null ? opt.highlight : -1;
    let s = `<svg class="chart${hlIdx >= 0 ? ' has-hl' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria)}">`;
    ticks.forEach((t) => { s += `<line class="grid-l" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${int(t)}</text>`; });
    const every = Math.ceil(rows.length / 12);
    rows.forEach((r, i) => {
      const x = m.l + i * step + (step - bw) / 2;
      const h = Math.max(0, H - m.b - y(r.v));
      s += `<rect class="b${i === hlIdx ? ' hl' : ''}" x="${x}" y="${y(r.v)}" width="${bw}" height="${h}" rx="4"/>`;
      if (r.v && rows.length <= 16) s += `<text class="tl-lbl" x="${x + bw / 2}" y="${y(r.v) - 6}" text-anchor="middle">${int(r.v)}</text>`;
      if (i % every === 0) s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(r.label)}</text>`;
      s += `<rect class="hit" x="${m.l + i * step}" y="${m.t}" width="${step}" height="${H - m.t - m.b}" data-tip="${esc(r.tip)}"/>`;
    });
    return s + '</svg>';
  }

  // ---------- paparan ----------
  function viewRingkasan(d, c) {
    const k = c.k, M = C.meters, T = C.targets;
    let h = '';
    if (d.tokenDaysLeft != null && d.tokenDaysLeft <= 7) {
      h += `<div class="banner ${d.tokenDaysLeft <= 2 ? 'bad' : 'warn'}">⚠ Token Meta tamat dalam ${int(Math.max(0, d.tokenDaysLeft))} hari. Perbaharui token dan kemas kini META_TOKEN dalam Apps Script.</div>`;
    }
    if (state.period !== 'today' && k.days && k.spendPct != null && k.spendPct < 0.5) {
      h += '<div class="banner warn">⚠ Belanja jauh bawah bajet. Semak baki prepaid akaun Meta, status iklan, dan saiz audiens.</div>';
    }
    const take = k.best
      ? `Outlet paling murah: <b>${esc(k.best.label)}</b> (${rm(k.best.cpr)} sechat)${k.worst ? `. Paling mahal: <b>${esc(k.worst.label)}</b> (${rm(k.worst.cpr)})` : ''}.`
      : 'Belum ada chat dalam tempoh ini.';
    h += `<section class="ov-hero">
      <div class="ov-hero-top"><div><div class="ov-eb">Meta Ads · Click-to-WhatsApp</div><h2>${esc(PERIOD_LABEL[state.period] || state.period)}</h2><p>Akaun KLIKI Kedah · ${int(k.days)} hari aktif</p></div>
      <span class="ov-badge">${d.cached ? 'Cache' : 'Live'} · ${new Date(d.updated).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="ov-hero-grid">
        <div class="ov-hs"><div class="ov-hv"><span>Chat WhatsApp</span><b>${int(k.chats)}</b><small>Keputusan kempen Meta</small></div></div>
        <div class="ov-hs"><div class="ov-hv"><span>Kos sechat</span><b>${rm(k.cpr)}</b><small>Sasaran bawah ${rm(T.costPerChat)}</small></div></div>
        <div class="ov-hs"><div class="ov-hv"><span>Belanja</span><b>${rm(k.spend)}</b><small>Bajet ${rm(k.budgetDay)}/hari</small></div></div>
        <div class="ov-hs"><div class="ov-hv"><span>Klik → chat</span><b>${pct(k.rate, 1)}</b><small>${int(k.links)} klik pautan</small></div></div>
      </div>
      <p class="take">${take}</p>
    </section>`;

    const capPace = (v, target, unit, perDay) => `${pct(v)} daripada sasaran ${int(target)} ${unit} (${int(perDay)}/hari × ${int(k.days)} hari)`;
    const cards = [
      kpiCard('Chat WhatsApp', int(k.chats), 'Berbanding sasaran ikut bajet', meter(M.chats, k.chatPct, k.chatTarget ? capPace(k.chatPct, k.chatTarget, 'chat', k.chatDay) : '')),
      kpiCard('Kos sechat', rm(k.cpr), 'Belanja ÷ chat', meter(M.cpr, k.cpr, `Sasaran bawah ${rm(M.cpr.segs[0][0])} · lemah atas ${rm(M.cpr.segs[1][0])} · titik = median Malaysia ${rm(C.medianMY)}`)),
      kpiCard('Belanja', rm(k.spend), 'Berbanding bajet ad set aktif', meter(M.spend, k.spendPct, k.budget ? `${pct(k.spendPct)} daripada bajet ${rm(k.budget)} (${rm(k.budgetDay)}/hari × ${int(k.days)} hari)` : '', (s, v) => (s === 'good' ? 'Ikut bajet' : v < 1 ? 'Bawah bajet' : 'Lebih bajet'))),
      kpiCard('Klik ke WhatsApp', int(k.links), 'Klik pautan dalam iklan', meter(M.link, k.clickPct, k.clickTarget ? capPace(k.clickPct, k.clickTarget, 'klik', k.clickDay) : '')),
      kpiCard('Klik → chat', pct(k.rate, 1), 'Chat ÷ klik pautan', meter(M.rate, k.rate, `Sasaran ${pct(M.rate.segs[1][0])} ke atas · lemah bawah ${pct(M.rate.segs[0][0])}`)),
      kpiCard('Reach', int(k.reach), 'Akaun Meta unik', meter(M.reach, k.reachShare, `${pct(k.reachShare)} impressions sampai kepada orang baru · sasaran ${pct(M.reach.segs[1][0])} ke atas`)),
      kpiCard('CPM', rm(k.cpm), 'Kos setiap 1,000 impressions', meter(M.cpm, k.cpm, `Sasaran bawah ${rm(M.cpm.segs[0][0])} · mahal atas ${rm(M.cpm.segs[1][0])}`)),
      kpiCard('Frequency', dec(k.freq), 'Purata kali seorang nampak iklan', meter(M.freq, k.freq, `Sihat bawah ${M.freq.segs[0][0]} · atas ${M.freq.segs[1][0]} audiens mula jemu`)),
    ];
    h += `<h2>Prestasi vs sasaran <span class="note">· hijau bagus, kuning sederhana, merah lemah</span></h2><div class="kgrid">${cards.join('')}</div>`;

    const daily = (d.daily || []).map((r) => {
      const dt = new Date(r.date + 'T00:00:00');
      const lbl = dt.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });
      return { v: r.chats, label: lbl, tip: `${lbl}: ${int(r.chats)} chat · ${rm(r.spend)} · ${r.chats ? rm(r.spend / r.chats) + ' sechat' : 'tiada chat'}` };
    });
    const hourly = (d.hourly || []).slice().sort((x, y) => x.hour - y.hour);
    let bestH = -1, bestCpr = Infinity;
    hourly.forEach((r, i) => { const c2 = r.chats ? r.spend / r.chats : Infinity; if (r.chats >= 2 && c2 < bestCpr) { bestCpr = c2; bestH = i; } });
    const hrows = hourly.map((r) => ({ v: r.chats, label: String(r.hour).padStart(2, '0'), tip: `${String(r.hour).padStart(2, '0')}:00: ${int(r.chats)} chat · ${rm(r.spend)} · ${r.chats ? rm(r.spend / r.chats) + ' sechat' : 'tiada chat'}` }));
    h += `<h2>Trend</h2><div class="pair">
      <div class="card"><div class="card-h"><div><h3>Chat per hari</h3><div class="sub">Sentuh bar untuk belanja dan kos sechat</div></div></div>${barChart(daily, { aria: 'Chat WhatsApp setiap hari' })}</div>
      <div class="card"><div class="card-h"><div><h3>Chat ikut jam</h3><div class="sub">${bestH >= 0 ? `Jam paling murah: <b>${esc(hrows[bestH].label)}:00</b> (${rm(bestCpr)} sechat)` : 'Waktu iklan menghasilkan chat'}</div></div></div>${barChart(hrows, { aria: 'Chat ikut jam', highlight: bestH >= 0 ? bestH : null })}</div>
    </div>
    <p class="chart-cap">"Chat" ialah keputusan Meta (messaging conversations started, atribusi lalai Meta). Ia bukan lead yang disahkan outlet: padankan dengan kod [FB-xx] dalam Outlet Tracker sebelum buat keputusan bajet.</p>`;
    return h;
  }

  function viewOutlet(d, c) {
    const rows = c.adsets.slice().sort((x, y) => (x.cpr == null) - (y.cpr == null) || (x.cpr || 0) - (y.cpr || 0));
    if (!rows.length) return '<div class="card empty">Tiada ad set dalam tempoh ini.</div>';
    const M = C.meters;
    return `<h2>Prestasi ikut outlet <span class="note">· satu ad set = satu outlet, disusun dari paling murah</span></h2><div class="ocards">${rows.map((s) => {
      const m = meter(M.cpr, s.cpr, `Sasaran bawah ${rm(M.cpr.segs[0][0])} · lemah atas ${rm(M.cpr.segs[1][0])}`);
      return `<div class="card"><div class="oc-h"><div><h3>${esc(s.label)}</h3><div class="sub">${esc(s.name)}${s.daily_budget != null ? ' · ' + rm(s.daily_budget) + '/hari' : ''}</div></div>${statusPill(s.status)}</div>
        <div class="oc-stats"><div><span>Belanja</span><b>${rm(s.spend)}</b></div><div><span>Chat</span><b>${int(s.chats)}</b></div><div><span>Kos sechat</span><b>${rm(s.cpr)}</b></div></div>
        ${m.html}
        <div class="oc-more"><span>Klik pautan <b>${int(s.link_clicks)}</b></span><span>Klik → chat <b>${pct(s.rate, 1)}</b></span><span>Reach <b>${int(s.reach)}</b></span><span>Freq <b>${dec(s.frequency)}</b></span><span>CPM <b>${rm(s.cpm)}</b></span></div></div>`;
    }).join('')}</div>`;
  }

  function viewKategori(d, c) {
    const outlets = [...new Set(c.ads.map((a) => a.outlet))].sort();
    const ads = state.catOutlet === 'ALL' ? c.ads : c.ads.filter((a) => a.outlet === state.catOutlet);
    const cats = new Map();
    ads.forEach((a) => {
      const g = cats.get(a.cat) || { cat: a.cat, spend: 0, chats: 0, players: new Map() };
      g.spend += a.spend; g.chats += a.chats;
      const p = g.players.get(a.angle) || { angle: a.angle, spend: 0, chats: 0, links: 0, n: 0 };
      p.spend += a.spend; p.chats += a.chats; p.links += a.link_clicks; p.n += 1;
      g.players.set(a.angle, p);
      cats.set(a.cat, g);
    });
    const W = C.winner;
    let h = `<h2>Kategori & angle <span class="note">· kategori = padang, angle = pemain. Semua padang mesti berjalan.</span></h2>
      <div class="controls" style="margin:0 0 12px"><label class="sr" for="cat-outlet">Outlet</label><select id="cat-outlet"><option value="ALL">Semua outlet</option>${outlets.map((o) => `<option value="${esc(o)}"${o === state.catOutlet ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    if (!cats.size) return h + '<div class="card empty">Tiada iklan dalam tempoh ini.</div>';
    h += '<div class="ocards">';
    [...cats.values()].sort((x, y) => y.spend - x.spend).forEach((g) => {
      const players = [...g.players.values()].map((p) => ({ ...p, cpr: p.chats ? p.spend / p.chats : null })).sort((x, y) => (x.cpr == null) - (y.cpr == null) || (x.cpr || 0) - (y.cpr || 0));
      const maxCpr = Math.max(...players.map((p) => p.cpr || 0), 1);
      const ranked = players.filter((p) => p.cpr != null);
      let verdict, vcls = '';
      if (players.length < 2) verdict = 'Hanya satu angle dalam padang ni. Split test perlukan sekurang-kurangnya 2 angle.';
      else if (players.some((p) => p.chats < W.minChats)) verdict = `Belum cukup data. Setiap angle perlu sekurang-kurangnya ${W.minChats} chat sebelum ranking dipercayai.`;
      else if (ranked.length >= 2 && ranked[0].cpr <= ranked[1].cpr * (1 - W.minGap)) { verdict = `Pemenang sementara: ${ranked[0].angle} (${rm(ranked[0].cpr)} sechat, ${pct(1 - ranked[0].cpr / ranked[1].cpr)} lebih murah). Ganti angle paling mahal dengan pemain baru.`; vcls = 'good'; }
      else verdict = `Beza kos bawah ${pct(W.minGap)}. Belum ada pemenang yang jelas.`;
      h += `<div class="card cat"><div class="card-h"><div><h3>${esc(g.cat)}</h3><div class="sub">${rm(g.spend)} · ${int(g.chats)} chat · ${g.chats ? rm(g.spend / g.chats) + ' sechat' : 'tiada chat'}</div></div></div>
        <ul class="players">${players.map((p, i) => {
          const cls = p.cpr == null ? 'na' : ranked.length > 1 && p === ranked[0] ? 'good' : ranked.length > 1 && p === ranked[ranked.length - 1] ? 'bad' : '';
          return `<li><div class="pl-top"><span class="n">${esc(p.angle)}</span><span class="v"><b>${rm(p.cpr)}</b> · ${int(p.chats)} chat · ${rm(p.spend)}</span></div><div class="pl-bar"><i class="${cls}" style="width:${p.cpr == null ? 4 : Math.max(4, (p.cpr / maxCpr) * 100)}%"></i></div></li>`;
        }).join('')}</ul>
        <div class="verdict ${vcls}">${esc(verdict)}</div></div>`;
    });
    return h + '</div><p class="chart-cap">Bar = kos sechat (lebih pendek lebih baik). Kategori dan angle dibaca dari nama iklan: "OUTLET | Kategori | Angle".</p>';
  }

  const COLS = [
    ['name', 'Iklan', (r) => `${esc(r.name)}<span class="sub">${esc(shortOutlet(r.adset))}</span>`, 'text'],
    ['status', 'Status', (r) => statusPill(r.status), 'text'],
    ['spend', 'Belanja', (r) => rm(r.spend)],
    ['chats', 'Chat', (r) => int(r.chats)],
    ['cpr', 'Kos sechat', (r) => rm(r.cpr)],
    ['link_clicks', 'Klik pautan', (r) => int(r.link_clicks)],
    ['ctr', 'CTR', (r) => (r.ctr ? r.ctr.toFixed(2) + '%' : '—')],
    ['cpm', 'CPM', (r) => rm(r.cpm)],
    ['frequency', 'Freq', (r) => dec(r.frequency)],
  ];
  function viewIklan(d, c) {
    const q = state.q.toLowerCase();
    const { key, dir } = state.sort;
    const rows = c.ads.filter((r) => !q || String(r.name).toLowerCase().includes(q) || String(r.adset).toLowerCase().includes(q))
      .sort((x, y) => { const a = x[key], b = y[key]; if (a == null) return 1; if (b == null) return -1; return (typeof a === 'string' ? a.localeCompare(b) : a - b) * dir; });
    const cprs = rows.map((r) => r.cpr).filter((v) => v != null);
    const lo = Math.min(...cprs), hi = Math.max(...cprs);
    return `<h2>Setiap iklan <span class="note">· ${int(rows.length)} iklan</span></h2><div class="card">
      <label class="sr" for="ad-q">Cari iklan</label><input id="ad-q" class="search" type="search" placeholder="Cari nama iklan / outlet" value="${esc(state.q)}">
      <div class="tbl-wrap"><table><thead><tr>${COLS.map(([k2, l]) => `<th class="sortable" data-k="${k2}"${k2 === key ? ` aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}>${esc(l)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${COLS.map(([k2, , f]) => {
        const cls = k2 === 'cpr' && cprs.length > 1 ? (r.cpr == null ? ' class="bad"' : r.cpr === lo ? ' class="good"' : r.cpr === hi ? ' class="bad"' : '') : '';
        return `<td${cls}>${f(r)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  }

  // ---------- render & interaksi ----------
  const TITLES = { ringkasan: 'Ringkasan', outlet: 'Outlet', kategori: 'Kategori & Angle', iklan: 'Setiap Iklan' };
  function render() {
    const v = $('#view');
    $('#page-title').textContent = TITLES[state.tab];
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    if (!state.data) return;
    const c = compute(state.data);
    v.innerHTML = state.tab === 'outlet' ? viewOutlet(state.data, c) : state.tab === 'kategori' ? viewKategori(state.data, c) : state.tab === 'iklan' ? viewIklan(state.data, c) : viewRingkasan(state.data, c);
    bindView();
  }
  function bindView() {
    const co = $('#cat-outlet');
    if (co) co.addEventListener('change', () => { state.catOutlet = co.value; render(); });
    const q = $('#ad-q');
    if (q) q.addEventListener('input', () => { state.q = q.value; const pos = q.selectionStart; render(); const n = $('#ad-q'); n.focus(); n.setSelectionRange(pos, pos); });
    $$('th.sortable').forEach((th) => th.addEventListener('click', () => {
      const k2 = th.dataset.k; state.sort = { key: k2, dir: state.sort.key === k2 ? -state.sort.dir : (k2 === 'name' || k2 === 'status' || k2 === 'cpr' ? 1 : -1) }; render();
    }));
  }

  function setStatus(text, err) { const s = $('#status-line'); s.textContent = text; s.classList.toggle('err', !!err); }
  function showError(title, msg) {
    $('#view').innerHTML = `<div class="card"><div class="card-h"><div><h3>${esc(title)}</h3><div class="sub">${esc(msg)}</div></div></div></div>`;
  }

  async function load(fresh) {
    if (!C.apiUrl) {
      showError('Apps Script belum disambung', 'Isi apiUrl dalam js/config.js dengan URL Web App "KLIKI Meta Ads API". Panduan penuh dalam README repo.');
      setStatus('Belum disambung', true);
      return;
    }
    const btn = $('#refresh'); btn.classList.add('spin');
    setStatus('Memuatkan…');
    try {
      const url = `${C.apiUrl}?pin=${encodeURIComponent(state.pin || '')}&period=${encodeURIComponent(state.period)}${fresh ? '&fresh=1' : ''}`;
      const res = await fetch(url, { redirect: 'follow' });
      const d = await res.json();
      if (!d.ok) {
        if (d.error === 'PIN') { store.del('kads_pin'); state.pin = null; showPin('PIN salah. Cuba lagi.'); return; }
        if (d.error === 'TOKEN') { showError('Token Meta tamat atau tidak sah', 'Buat token baru dan kemas kini META_TOKEN dalam Script Properties. Langkah ada dalam README.'); setStatus('Token Meta perlu diperbaharui', true); return; }
        showError('Gagal ambil data Meta', d.message || 'Ralat tidak diketahui');
        setStatus('Ralat data', true);
        return;
      }
      state.data = d;
      setStatus(`${PERIOD_LABEL[state.period]} · dikemas kini ${new Date(d.updated).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })}`);
      render();
    } catch (e) {
      showError('Tak dapat sambung ke server', 'Semak internet, atau pastikan Web App Apps Script di-deploy dengan akses "Anyone".');
      setStatus('Tiada sambungan', true);
    } finally { btn.classList.remove('spin'); }
  }

  function showPin(err) {
    $('#app').hidden = true; $('#pin-screen').hidden = false;
    $('#pin-err').textContent = err || '';
    setTimeout(() => $('#pin-input').focus(), 50);
  }
  function showApp() { $('#pin-screen').hidden = true; $('#app').hidden = false; }

  function infoBody() {
    const M = C.meters;
    return `<p style="font-size:13px;color:var(--text-2);margin:0 0 10px">Data ditarik terus dari Meta melalui Apps Script setiap kali dibuka (cache 5 minit). Tekan ⟳ untuk data paling baru.</p>
      <ul class="health">
        <li><b>Sasaran chat</b> = bajet harian ad set aktif ÷ ${rm(C.targets.costPerChat)} × hari aktif.</li>
        <li><b>Sasaran klik</b> = sasaran chat ÷ ${pct(C.targets.clickToChat)}.</li>
        <li><b>Kos sechat</b>: bagus bawah ${rm(M.cpr.segs[0][0])}, lemah atas ${rm(M.cpr.segs[1][0])}. Median Malaysia ${rm(C.medianMY)} (ALIQ Studio, Ogos 2026).</li>
        <li><b>Pemenang angle</b>: setiap angle ≥ ${C.winner.minChats} chat dan beza kos ≥ ${pct(C.winner.minGap)}.</li>
        <li>Zon lain ialah sasaran cadangan KLIKI, boleh diubah dalam <code>js/config.js</code>.</li>
      </ul>
      ${state.data && state.data.tokenDaysLeft != null ? `<p style="font-size:13px">Token Meta tamat dalam <b>${int(state.data.tokenDaysLeft)} hari</b>.</p>` : ''}
      <button id="logout" class="icon-btn" style="width:auto;padding:0 14px;font:600 13px Inter,sans-serif">Log keluar (padam PIN)</button>`;
  }

  // tooltip carta
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]'); const tip = $('#tip');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip; tip.hidden = false;
    const r = t.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 120, Math.max(120, r.left + r.width / 2));
    tip.style.left = x + 'px'; tip.style.top = r.top + 30 + 'px';
  });
  document.addEventListener('scroll', () => { $('#tip').hidden = true; }, { passive: true });

  // ---------- mula ----------
  $('#pin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#pin-input').value.trim();
    if (!v) return;
    state.pin = v; store.set('kads_pin', v); showApp(); load();
  });
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
  const sel = $('#period'); sel.value = state.period;
  sel.addEventListener('change', () => { state.period = sel.value; store.set('kads_period', sel.value); load(); });
  $('#refresh').addEventListener('click', () => load(true));
  $('#info').addEventListener('click', () => { $('#info-body').innerHTML = infoBody(); $('#info-dlg').showModal(); const lo = $('#logout'); if (lo) lo.addEventListener('click', () => { store.del('kads_pin'); state.pin = null; state.data = null; $('#info-dlg').close(); showPin(); }); });
  $('#info-close').addEventListener('click', () => $('#info-dlg').close());

  if (!state.pin && C.apiUrl) showPin(); else { showApp(); load(); }
  window.__klikiAds = { compute, state, render };
})();
