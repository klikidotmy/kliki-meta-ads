/**
 * KLIKI Meta Ads API (Google Apps Script)
 * Tarik data prestasi iklan Meta (Facebook/Instagram) untuk PWA KLIKI Meta Ads.
 *
 * Rahsia TIDAK disimpan dalam kod ini. Set dalam Project Settings > Script Properties:
 *   META_TOKEN      token akses Meta dengan kebenaran ads_read
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

  const period = PERIODS.indexOf(p.period) >= 0 ? p.period : 'maximum';
  const cache = CacheService.getScriptCache();
  const key = 'meta_' + period;
  if (p.fresh !== '1') {
    const hit = cache.get(key);
    if (hit) { const o = JSON.parse(hit); o.cached = true; return o; }
  }

  try {
    const data = load_(period, props);
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
  Logger.log('OK. Belanja RM' + out.account.spend + ', chat ' + out.account.chats + ', ad set ' + out.adsets.length + ', iklan ' + out.ads.length + ', bajet/hari RM' + out.budgetPerDay);
}
