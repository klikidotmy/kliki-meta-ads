/**
 * KLIKI Meta Ads API (Google Apps Script)
 * Tarik data prestasi iklan Meta (Facebook/Instagram) untuk PWA KLIKI Meta Ads.
 *
 * Dua mod sumber data:
 *   1. LIVE  : bila META_TOKEN diset, data ditarik terus dari Meta Graph API.
 *   2. SHEET : bila META_TOKEN kosong, data dibaca dari Google Sheet "KLIKI Meta Ads Data" (tab raw),
 *              yang diisi oleh tugasan berjadual Claude (jawapan mentah sambungan Meta Ads).
 *
 * Rahsia TIDAK disimpan dalam kod ini. Set dalam Project Settings > Script Properties:
 *   META_TOKEN      (pilihan) token akses Meta dengan kebenaran ads_read
 *   DATA_SHEET_ID   (pilihan) ID sheet mod SHEET; lalai = DEFAULT_SHEET_ID
 *   AD_ACCOUNT_ID   2071524496317412 (tanpa "act_")
 *   APP_PIN         PIN untuk buka app
 *   TOKEN_EXPIRES   (pilihan) tarikh token tamat, format YYYY-MM-DD, untuk amaran dalam app
 *
 * Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
 * Bila tukar kod: Deploy > Manage deployments > Edit > Version: New version (URL kekal sama).
 */

const GRAPH_VERSION = 'v23.0'; // naikkan bila Meta umum versi ini akan tamat
const CACHE_SECONDS = 300;     // data disimpan 5 minit supaya tak bazir kuota Meta
const PERIODS = ['maximum', 'today', 'yesterday', 'last_7d', 'last_14d', 'this_month', 'last_month'];
const CHAT_ACTION = 'onsite_conversion.messaging_conversation_started_7d';
const DEFAULT_SHEET_ID = '1EM-VclncjHvfpAHQ2FXCwx7IlZsN5STUtvSGFu-ZvqY';
const SHEET_PERIODS = ['maximum', 'today', 'yesterday', 'last_7d'];
const TZ = 'Asia/Kuala_Lumpur';

function doGet(e) {
  const p = (e && e.parameter) || {};
  const out = handle_(p);
  const json = JSON.stringify(out);
  if (p.callback && /^[A-Za-z_$][\w$]*$/.test(p.callback)) {
    return ContentService.createTextOutput(p.callback + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function handle_(p) {
  const props = PropertiesService.getScriptProperties();
  const pin = props.getProperty('APP_PIN');
  if (!pin) return { ok: false, error: 'SETUP', message: 'APP_PIN belum diset dalam Script Properties.' };
  if (String(p.pin || '') !== String(pin)) return { ok: false, error: 'PIN', message: 'PIN salah.' };

  const live = !!props.getProperty('META_TOKEN');
  const allowed = live ? PERIODS : SHEET_PERIODS;
  const period = allowed.indexOf(p.period) >= 0 ? p.period : 'maximum';
  const cache = CacheService.getScriptCache();
  const key = (live ? 'meta_' : 'sheet_') + period;
  if (p.fresh !== '1') {
    const hit = cache.get(key);
    if (hit) { const o = JSON.parse(hit); o.cached = true; return o; }
  }

  try {
    const data = live ? load_(period, props) : loadSheet_(period, props);
    data.periods = allowed;
    const s = JSON.stringify(data);
    if (s.length < 95000) cache.put(key, s, CACHE_SECONDS);
    return data;
  } catch (err) {
    const msg = String(err && err.message || err);
    const code = /\(#?190\)|code 190|OAuthException/.test(msg) ? 'TOKEN' : 'META';
    return { ok: false, error: code, message: msg };
  }
}

function load_(period, props) {
  const token = props.getProperty('META_TOKEN');
  const acct = String(props.getProperty('AD_ACCOUNT_ID') || '').replace(/^act_/, '');
  if (!token || !acct) throw new Error('META_TOKEN atau AD_ACCOUNT_ID belum diset dalam Script Properties.');
  const base = 'act_' + acct;
  const metricFields = 'spend,impressions,reach,frequency,cpm,ctr,clicks,actions';

  const account = graphAll_(base + '/insights', { level: 'account', fields: metricFields, date_preset: period }, token);
  const daily = graphAll_(base + '/insights', { level: 'account', fields: 'spend,impressions,clicks,actions', date_preset: period, time_increment: 1 }, token);
  let hourly = [];
  try { // pecahan ikut jam: pilihan, jangan gagalkan seluruh data kalau Meta tolak
    hourly = graphAll_(base + '/insights', { level: 'account', fields: 'spend,impressions,actions', date_preset: period, breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone' }, token);
  } catch (e) { hourly = []; }
  const adsetIns = graphAll_(base + '/insights', { level: 'adset', fields: 'adset_id,adset_name,campaign_name,' + metricFields, date_preset: period, limit: 200 }, token);
  const adIns = graphAll_(base + '/insights', { level: 'ad', fields: 'ad_id,ad_name,adset_id,adset_name,' + metricFields, date_preset: period, limit: 500 }, token);
  const adsets = graphAll_(base + '/adsets', { fields: 'id,name,effective_status,daily_budget,lifetime_budget', limit: 200 }, token);
  const ads = graphAll_(base + '/ads', { fields: 'id,name,effective_status,adset_id', limit: 500 }, token);

  const adsetMeta = {}; adsets.forEach(function (a) { adsetMeta[a.id] = a; });
  const adMeta = {}; ads.forEach(function (a) { adMeta[a.id] = a; });

  const adsetRows = adsetIns.map(function (r) {
    const m = adsetMeta[r.adset_id] || {};
    return Object.assign({ id: r.adset_id, name: r.adset_name, campaign: r.campaign_name, status: m.effective_status || null, daily_budget: money_(m.daily_budget) }, metrics_(r));
  });
  // Ad set aktif yang belum ada data dalam tempoh ini tetap dipaparkan
  adsets.forEach(function (a) {
    if (a.effective_status === 'ACTIVE' && !adsetRows.some(function (r) { return r.id === a.id; })) {
      adsetRows.push(Object.assign({ id: a.id, name: a.name, status: a.effective_status, daily_budget: money_(a.daily_budget) }, metrics_({})));
    }
  });

  const adRows = adIns.map(function (r) {
    const m = adMeta[r.ad_id] || {};
    return Object.assign({ id: r.ad_id, name: r.ad_name, adset_id: r.adset_id, adset: r.adset_name, status: m.effective_status || null }, metrics_(r));
  });

  const exp = props.getProperty('TOKEN_EXPIRES');
  let tokenDaysLeft = null;
  if (exp && /^\d{4}-\d{2}-\d{2}$/.test(exp)) {
    tokenDaysLeft = Math.floor((new Date(exp + 'T00:00:00+08:00') - new Date()) / 86400000);
  }

  return {
    ok: true,
    period: period,
    updated: new Date().toISOString(),
    tokenDaysLeft: tokenDaysLeft,
    budgetPerDay: adsets.filter(function (a) { return a.effective_status === 'ACTIVE'; }).reduce(function (t, a) { return t + (money_(a.daily_budget) || 0); }, 0),
    account: account.length ? metrics_(account[0]) : metrics_({}),
    daily: daily.map(function (r) { return Object.assign({ date: r.date_start }, metrics_(r)); }),
    hourly: hourly.map(function (r) { return Object.assign({ hour: Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone).slice(0, 2)) }, metrics_(r)); }),
    adsets: adsetRows,
    ads: adRows,
  };
}

/* ===================== MOD SHEET ===================== */

/** Baca jawapan mentah sambungan Meta Ads dari tab raw (key | json | fetched_at) dan bentukkan seperti mod LIVE. */
function loadSheet_(period, props) {
  const id = props.getProperty('DATA_SHEET_ID') || DEFAULT_SHEET_ID;
  const sh = SpreadsheetApp.openById(id).getSheetByName('raw');
  if (!sh) throw new Error('Tab "raw" tiada dalam sheet data.');
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
  const map = {};
  rows.forEach(function (r) { if (r[0]) map[String(r[0]).trim()] = { json: r[1], at: r[2] }; });
  const used = [];
  function get(k, required) {
    const c = map[k];
    if (!c || c.json === '' || c.json == null) { if (required) throw new Error('Data "' + k + '" belum ada dalam sheet. Tunggu run tugasan berjadual seterusnya.'); return []; }
    used.push(c.at);
    let v = JSON.parse(String(c.json));
    if (typeof v === 'string') v = JSON.parse(v);
    if (v && v.ad_entities) v = typeof v.ad_entities === 'string' ? JSON.parse(v.ad_entities) : v.ad_entities;
    return Array.isArray(v) ? v : [];
  }

  const acct = get(period + '|account', true);
  const adsetsP = get(period + '|adsets', true);
  const adsP = get(period + '|ads', false);
  const adsetsNow = get('maximum|adsets', false);
  const dailyRaw = get('maximum|daily', false);
  const hourlyRaw = get('maximum|hourly', false);

  const adsetRows = adsetsP.map(function (r) {
    return Object.assign({ id: String(r.id), name: r.name, status: r.effective_status || null, daily_budget: r.daily_budget ? mval_(r.daily_budget) : null }, mrow_(r));
  });
  const adRows = adsP.map(function (r) {
    return Object.assign({ id: String(r.id), name: r.name, adset: r.adset_name || null, status: r.effective_status || null }, mrow_(r));
  });

  // Harian: jumlah semua kempen ikut tarikh, kemudian tapis ikut tempoh
  const byDate = {};
  dailyRaw.forEach(function (r) {
    const d = String(r.date_start || '').slice(0, 10); if (!d) return;
    const m = mrow_(r); const t = byDate[d] || (byDate[d] = { date: d, spend: 0, impressions: 0, clicks: 0, link_clicks: 0, chats: 0 });
    t.spend += m.spend; t.impressions += m.impressions; t.clicks += m.clicks; t.link_clicks += m.link_clicks; t.chats += m.chats;
  });
  const range = periodRange_(period);
  const daily = Object.keys(byDate).sort().filter(function (d) { return !range || (d >= range[0] && d <= range[1]); }).map(function (d) { return byDate[d]; });

  const hourBy = {};
  hourlyRaw.forEach(function (r) {
    const h = Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone || '').slice(0, 2)); if (!isFinite(h)) return;
    const m = mrow_(r); const t = hourBy[h] || (hourBy[h] = { hour: h, spend: 0, impressions: 0, link_clicks: 0, chats: 0 });
    t.spend += m.spend; t.impressions += m.impressions; t.link_clicks += m.link_clicks; t.chats += m.chats;
  });

  const account = acct.length ? mrow_(acct[0]) : mrow_({});
  if (!account.chats && adsetRows.length) account.chats = adsetRows.reduce(function (t, a) { return t + a.chats; }, 0);

  const budgetSrc = adsetsNow.length ? adsetsNow : adsetsP;
  const stamps = used.map(function (x) { return x instanceof Date ? x : new Date(String(x)); }).filter(function (d) { return !isNaN(d); });
  const oldest = stamps.length ? new Date(Math.min.apply(null, stamps)) : null;

  return {
    ok: true,
    source: 'sheet',
    period: period,
    updated: oldest ? oldest.toISOString() : null,
    tokenDaysLeft: null,
    hourlyScope: 'maximum',
    budgetPerDay: budgetSrc.filter(function (a) { return a.effective_status === 'ACTIVE'; }).reduce(function (t, a) { return t + (a.daily_budget ? mval_(a.daily_budget) : 0); }, 0),
    account: account,
    daily: daily,
    hourly: Object.keys(hourBy).map(function (h) { return hourBy[h]; }),
    adsets: adsetRows,
    ads: adRows,
  };
}

/** Tarikh mula/akhir (YYYY-MM-DD, waktu Malaysia) untuk tapis data harian. null = semua. */
function periodRange_(period) {
  const fmt = function (d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); };
  const now = new Date();
  const day = function (n) { return fmt(new Date(now.getTime() + n * 86400000)); };
  if (period === 'today') return [day(0), day(0)];
  if (period === 'yesterday') return [day(-1), day(-1)];
  if (period === 'last_7d') return [day(-7), day(-1)];
  return null;
}

/** Nilai format sambungan Meta Ads: {"value":"22.91"} atau "22.91" atau "2.20%". */
function mval_(x) {
  if (x === undefined || x === null || x === '') return 0;
  if (typeof x === 'object') {
    if (Array.isArray(x.values)) return x.values.length ? mval_(x.values[0].value) : 0;
    return mval_(x.value);
  }
  const n = parseFloat(String(x).replace('%', '').replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}
function mrow_(r) {
  return {
    spend: mval_(r.amount_spent), impressions: mval_(r.impressions), reach: mval_(r.reach), frequency: mval_(r.frequency),
    cpm: mval_(r.cpm), ctr: mval_(r.ctr), clicks: mval_(r.clicks), link_clicks: mval_(r.link_click), chats: mval_(r.results),
  };
}

/* ===================== MOD LIVE ===================== */

/** Tukar baris Meta kepada nombor yang app guna. */
function metrics_(r) {
  const acts = {};
  (r.actions || []).forEach(function (a) { acts[a.action_type] = Number(a.value) || 0; });
  return {
    spend: num_(r.spend),
    impressions: num_(r.impressions),
    reach: num_(r.reach),
    frequency: num_(r.frequency),
    cpm: num_(r.cpm),
    ctr: num_(r.ctr),
    clicks: num_(r.clicks),
    link_clicks: acts.link_click || 0,
    chats: acts[CHAT_ACTION] || 0,
  };
}

function num_(v) { if (v === undefined || v === null || v === '') return 0; const n = Number(v); return isFinite(n) ? n : 0; }
// Bajet Meta dalam unit sen (minor unit): 2500 = RM25.00
function money_(v) { if (v === undefined || v === null || v === '') return null; return Number(v) / 100; }

/** Panggil Graph API dan ikut semua halaman (paging.next). */
function graphAll_(path, params, token) {
  const q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
  q.push('access_token=' + encodeURIComponent(token));
  let url = 'https://graph.facebook.com/' + GRAPH_VERSION + '/' + path + '?' + q.join('&');
  const rows = [];
  let guard = 0;
  while (url && guard < 20) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const body = JSON.parse(res.getContentText() || '{}');
    if (body.error) {
      throw new Error('Meta: ' + (body.error.message || 'ralat') + ' (code ' + body.error.code + ')');
    }
    (body.data || []).forEach(function (x) { rows.push(x); });
    url = body.paging && body.paging.next ? body.paging.next : null;
    guard++;
  }
  return rows;
}

/** Jalankan dari editor untuk uji token & akaun. Lihat Execution log. */
function testSetup() {
  const out = handle_({ pin: PropertiesService.getScriptProperties().getProperty('APP_PIN'), period: 'maximum', fresh: '1' });
  if (!out.ok) { Logger.log('GAGAL: ' + out.error + ' — ' + out.message); return; }
  Logger.log('OK (' + (out.source || 'live') + '). Belanja RM' + out.account.spend + ', chat ' + out.account.chats + ', ad set ' + out.adsets.length + ', iklan ' + out.ads.length + ', bajet/hari RM' + out.budgetPerDay);
}
