// KLIKI Meta Ads — konfigurasi. Tiada token atau PIN di sini: repo ini public.
(function (root) {
  root.CONFIG = {
    // URL Web App Apps Script "KLIKI Meta Ads API" (Deploy > Manage deployments). Kosong = app tunjuk panduan setup.
    apiUrl: '',

    // Sasaran KLIKI (cadangan, ubah di sini). Bajet harian dibaca terus dari ad set aktif di Meta.
    targets: {
      costPerChat: 5,      // RM: sasaran kos sechat → sasaran chat = bajet ÷ nilai ini
      clickToChat: 0.3,    // 30% klik pautan jadi chat → sasaran klik = sasaran chat ÷ nilai ini
    },

    // Zon bar prestasi: [had atas, status]. good = hijau, warn = kuning, bad = merah.
    meters: {
      chats:  { max: 1.5, segs: [[0.7, 'bad'], [1, 'warn'], [1.5, 'good']] },
      cpr:    { max: 15,  segs: [[5, 'good'], [8, 'warn'], [15, 'bad']], ref: 13.43 },
      spend:  { max: 1.5, segs: [[0.7, 'bad'], [0.9, 'warn'], [1.1, 'good'], [1.25, 'warn'], [1.5, 'bad']] },
      link:   { max: 1.5, segs: [[0.7, 'bad'], [1, 'warn'], [1.5, 'good']] },
      rate:   { max: 0.6, segs: [[0.2, 'bad'], [0.3, 'warn'], [0.6, 'good']] },
      reach:  { max: 1,   segs: [[1 / 3, 'bad'], [0.5, 'warn'], [1, 'good']] },
      cpm:    { max: 25,  segs: [[10, 'good'], [15, 'warn'], [25, 'bad']] },
      freq:   { max: 5,   segs: [[2, 'good'], [3, 'warn'], [5, 'bad']] },
    },
    // Median kos sechat Malaysia: ALIQ Studio, data Ogos 2026 (akaun SME KL/Selangor)
    medianMY: 13.43,

    // Split test dalam satu kategori (padang): bila boleh isytihar pemenang
    winner: { minChats: 10, minGap: 0.2 },
  };
})(window);
