// ============ RSS NEWS FEEDS ============
async function loadNewsFeeds() {
    const leftCol = document.getElementById('appNewsLeft') || document.getElementById('newsLeft');
    const rightCol = document.getElementById('appNewsRight') || document.getElementById('newsRight');
    if (!leftCol || !rightCol) return;
    if (leftCol.dataset.loaded === 'true') return;
    leftCol.dataset.loaded = 'true';

    const feeds = [
        { url: 'https://cointelegraph.com/rss', name: 'Cointelegraph' },
        { url: 'https://decrypt.co/feed', name: 'Decrypt' },
        { url: 'https://bitcoinmagazine.com/.rss/full/', name: 'Bitcoin Magazine' }
    ];

    try {
        const results = await Promise.allSettled(
            feeds.map(f =>
                fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(f.url)}`)
                    .then(r => r.json())
                    .then(d => ({ items: d.items || [], name: f.name }))
            )
        );

        let allArticles = [];
        results.forEach(r => {
            if (r.status === 'fulfilled' && r.value.items.length > 0) {
                r.value.items.forEach(item => {
                    allArticles.push({ ...item, source: r.value.name });
                });
            }
        });

        // Sort by date (newest first), take top 12
        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        const top12 = allArticles.slice(0, 12);

        // Split: first 6 → left, next 6 → right
        top12.slice(0, 6).forEach(item => {
            const div = document.createElement('div');
            div.className = 'lp-news-item';
            const date = item.pubDate ? new Date(item.pubDate).toLocaleDateString() : '';
            div.innerHTML = `<a href="${item.link}" target="_blank" rel="noopener">${item.title}</a><div class="lp-news-src">${item.source} <span class="lp-news-date">${date}</span></div>`;
            leftCol.appendChild(div);
        });
        top12.slice(6, 12).forEach(item => {
            const div = document.createElement('div');
            div.className = 'lp-news-item';
            const date = item.pubDate ? new Date(item.pubDate).toLocaleDateString() : '';
            div.innerHTML = `<a href="${item.link}" target="_blank" rel="noopener">${item.title}</a><div class="lp-news-src">${item.source} <span class="lp-news-date">${date}</span></div>`;
            rightCol.appendChild(div);
        });
    } catch(e) {
        console.log('RSS feed error:', e);
    }
}

// ============ LANDING PAGE MARKET WIDGETS ============
let coingeckoCache = null;
let coingeckoCacheTime = 0;
let latestFearGreed = null;
let latestMarketCap = null;
let previousMarketCap = null;

// ── Binance WebSocket Manager (CORS-free, real-time) ──
const WS_TRACKED = ['BTC','ETH','SOL','BNB','XRP','AVAX','LINK','DOGE','ADA','DOT','MATIC','UNI','ATOM','LTC','OP','ARB','APT','FIL','NEAR','TIA','PYTH','INJ','SUI','SEI','RUNE','RNDR','FET','WLD','PEPE','WIF','BONK','SHIB','TON'];
const wsCache = {};
let wsConnection = null;
let wsReconnectDelay = 1000;
let wsReconnecting = false;
let wsLastMessageTime = 0;
let wsHeartbeatInterval = null;

function connectBinanceWS() {
    if (wsConnection && wsConnection.readyState <= 1) return;
    if (wsReconnecting) return;
    wsReconnecting = true;
    const streams = WS_TRACKED.map(s => s.toLowerCase() + 'usdt@ticker').join('/');
    try {
        wsConnection = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    } catch(e) {
        wsReconnecting = false;
        setTimeout(connectBinanceWS, wsReconnectDelay);
        wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
        return;
    }
    wsConnection.onopen = () => {
        console.log('[WS] Binance connected:', WS_TRACKED.length, 'streams');
        wsReconnectDelay = 1000;
        wsReconnecting = false;
        wsLastMessageTime = Date.now();
        // Start heartbeat: detect stale connection every 30s
        if (wsHeartbeatInterval) clearInterval(wsHeartbeatInterval);
        wsHeartbeatInterval = setInterval(() => {
            if (wsLastMessageTime && Date.now() - wsLastMessageTime > 60000) {
                console.log('[WS] No messages for 60s, forcing reconnect');
                if (wsConnection) wsConnection.close();
            }
        }, 30000);
    };
    wsConnection.onmessage = (evt) => {
        wsLastMessageTime = Date.now();
        try {
            const msg = JSON.parse(evt.data);
            const d = msg.data;
            if (d && d.s && d.s.endsWith('USDT')) {
                wsCache[d.s] = {
                    symbol: d.s,
                    price: parseFloat(d.c),
                    priceChangePercent: parseFloat(d.P),
                    volume: parseFloat(d.q),
                    high: parseFloat(d.h),
                    low: parseFloat(d.l),
                    ts: Date.now()
                };
            }
        } catch {}
    };
    wsConnection.onclose = () => {
        wsReconnecting = false;
        if (wsHeartbeatInterval) { clearInterval(wsHeartbeatInterval); wsHeartbeatInterval = null; }
        console.log('[WS] Disconnected, reconnecting in', wsReconnectDelay, 'ms');
        setTimeout(connectBinanceWS, wsReconnectDelay);
        wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
    };
    wsConnection.onerror = () => { if (wsConnection) wsConnection.close(); };
}

async function fetchBinanceMarkets() {
    const STALE_MS = 120000; // 2 min
    const freshCache = Object.values(wsCache).filter(t => Date.now() - t.ts < STALE_MS);
    // REST fallback when WS cache is empty or stale
    if (freshCache.length === 0) {
        try {
            const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
            if (res.ok) {
                const data = await res.json();
                const now = Date.now();
                data.forEach(t => {
                    if (t.symbol && t.symbol.endsWith('USDT')) {
                        wsCache[t.symbol] = {
                            symbol: t.symbol,
                            price: parseFloat(t.lastPrice),
                            priceChangePercent: parseFloat(t.priceChangePercent),
                            volume: parseFloat(t.quoteVolume),
                            high: parseFloat(t.highPrice),
                            low: parseFloat(t.lowPrice),
                            ts: now
                        };
                    }
                });
                wsReconnectDelay = 1000; // Reset delay on REST success
                console.log('[WS] REST fallback populated', Object.keys(wsCache).length, 'symbols');
            }
        } catch(e) {
            console.log('[WS] REST fallback failed:', e.message);
        }
    }
    // If WS is still connecting and cache is empty, wait briefly
    if (Object.keys(wsCache).length === 0) await new Promise(r => setTimeout(r, 2000));
    return WS_TRACKED.map(sym => {
        const t = wsCache[sym + 'USDT'];
        if (!t || Date.now() - t.ts > STALE_MS) return null;
        return {
            symbol: sym, current_price: t.price,
            price_change_percentage_24h: t.priceChangePercent,
            total_volume: t.volume
        };
    }).filter(Boolean);
}

async function fetchMovers() {
    const STALE_MS = 120000;
    const fresh = Object.values(wsCache).filter(t =>
        WS_TRACKED.includes(t.symbol.replace('USDT', '')) && Date.now() - t.ts < STALE_MS
    );
    // REST fallback for movers too
    if (fresh.length === 0) {
        await fetchBinanceMarkets(); // triggers REST fallback if needed
    }
    return Object.values(wsCache)
        .filter(t => WS_TRACKED.includes(t.symbol.replace('USDT', '')) && Date.now() - t.ts < STALE_MS)
        .map(t => ({ symbol: t.symbol, priceChangePercent: String(t.priceChangePercent) }))
        .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
}

function getNewsCol(id) {
    // Return app element if on app view, otherwise landing element
    const appId = 'app' + id.charAt(0).toUpperCase() + id.slice(1);
    const appEl = document.getElementById(appId);
    const landEl = document.getElementById(id);
    // Prefer app element if visible, otherwise use landing element
    if (appEl && !appEl.closest('.hidden')) return appEl;
    return landEl || appEl;
}

function makeWidgetCard(title) {
    const div = document.createElement('div');
    div.className = 'lp-news-item lp-widget';
    div.innerHTML = `<div class="lp-widget-title">// ${title}</div>`;
    return div;
}

function makeWidgetBody(card) {
    const body = document.createElement('div');
    body.className = 'lp-widget-body';
    body.innerHTML = '<span style="color:var(--muted);">loading...</span>';
    card.appendChild(body);
    return body;
}

function widgetUnavailable(body) {
    body.innerHTML = '<span style="color:var(--dim);font-size:0.5rem;">unavailable</span><div class="lp-widget-meta">data source temporarily limited</div>';
}

async function fetchCoingeckoGlobal() {
    const now = Date.now();
    if (coingeckoCache && (now - coingeckoCacheTime) < 300000) return;
    const r = await fetch('https://api.coingecko.com/api/v3/global');
    const d = await r.json();
    coingeckoCache = d.data;
    coingeckoCacheTime = now;
}

async function loadFearGreed() {
    const col = getNewsCol('newsLeft');
    if (!col || col.dataset.fngLoaded === 'true') return;
    col.dataset.fngLoaded = 'true';
    const card = makeWidgetCard('Fear & Greed');
    const body = makeWidgetBody(card);
    col.appendChild(card);

    async function refresh() {
        try {
            const r = await fetch('https://api.alternative.me/fng/?limit=1');
            const d = await r.json();
            if (!d.data || !d.data[0]) return;
            const v = parseInt(d.data[0].value);
            latestFearGreed = v;
            const cls = d.data[0].value_classification || '';
            let color = 'var(--amber)';
            let signal = 'neutral / mixed';
            if (v <= 25) { color = 'var(--green)'; signal = 'extreme fear · accumulation bias'; }
            else if (v <= 45) { color = 'var(--green)'; signal = 'fear · cautious market'; }
            else if (v >= 75) { color = 'var(--red)'; signal = 'extreme greed · overheated'; }
            else if (v >= 60) { color = 'var(--red)'; signal = 'greed · risk-on sentiment'; }
            body.innerHTML = `
                <div class="lp-widget-main-row"><span class="lp-widget-value" style="color:${color}">${v}</span><span class="lp-widget-signal" style="color:${color}">${v >= 55 ? '↗' : v <= 40 ? '↘' : '→'}</span></div>
                <div class="lp-widget-sub">${cls}</div>
                <div class="lp-widget-meta">${signal}</div>`;
        } catch(e) {
            widgetUnavailable(body);
        }
    }
    await refresh();
    setInterval(refresh, 600000);
}

async function loadBTCDominance() {
    const col = getNewsCol('newsLeft');
    if (!col) return;
    const card = makeWidgetCard('BTC Dominance');
    const body = makeWidgetBody(card);
    col.appendChild(card);

    async function refresh() {
        try {
            await fetchCoingeckoGlobal();
            if (coingeckoCache?.market_cap_percentage?.btc) {
                const btc = coingeckoCache.market_cap_percentage.btc.toFixed(1);
                const eth = coingeckoCache.market_cap_percentage.eth ? coingeckoCache.market_cap_percentage.eth.toFixed(1) : '--';
                body.innerHTML = `
                    <div class="lp-widget-main-row"><span class="lp-widget-value" style="color:var(--blue)">${btc}%</span><span class="lp-widget-signal" style="color:var(--blue)">BTC</span></div>
                    <div class="lp-widget-sub">ETH dominance: ${eth}%</div>
                    <div class="lp-widget-meta">higher BTC share = defensive crypto rotation</div>`;
            }
        } catch(e) {
            widgetUnavailable(body);
        }
    }
    await refresh();
    setInterval(refresh, 900000);
}

async function loadStablecoinDominance() {
    const col = getNewsCol('newsLeft');
    if (!col) return;
    const card = makeWidgetCard('Stablecoin Dominance');
    const body = makeWidgetBody(card);
    col.appendChild(card);

    async function refresh() {
        try {
            await fetchCoingeckoGlobal();
            const totalCap = coingeckoCache?.total_market_cap?.usd || 0;
            const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin,dai');
            const coins = await r.json();
            const stableCap = coins.reduce((sum, coin) => sum + (coin.market_cap || 0), 0);
            if (!totalCap || !stableCap) return;
            const dominance = (stableCap / totalCap) * 100;
            const color = dominance < 5 ? 'var(--green)' : dominance <= 8 ? 'var(--amber)' : 'var(--red)';
            const signal = dominance < 5 ? 'neutral liquidity backdrop' : dominance <= 8 ? 'capital partly sidelined' : 'bearish sidelined capital signal';
            body.innerHTML = `
                <div class="lp-widget-main-row"><span class="lp-widget-value" style="color:${color}">${dominance.toFixed(1)}%</span><span class="lp-widget-signal" style="color:${color}">USD</span></div>
                <div class="lp-widget-sub">USDT + USDC + DAI</div>
                <div class="lp-widget-meta">${signal}</div>`;
        } catch(e) {
            widgetUnavailable(body);
        }
    }
    await refresh();
    setInterval(refresh, 900000);
}

async function loadMarketCap() {
    const col = getNewsCol('newsLeft');
    if (!col) return;
    const card = makeWidgetCard('Total Market Cap');
    const body = makeWidgetBody(card);
    col.appendChild(card);

    function fmt(n) {
        if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
        if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
        return '$' + (n / 1e6).toFixed(0) + 'M';
    }

    async function refresh() {
        try {
            await fetchCoingeckoGlobal();
            const mcap = coingeckoCache?.total_market_cap?.usd || 0;
            if (!mcap) return;
            previousMarketCap = Number(localStorage.getItem('aqmath_last_market_cap')) || mcap;
            latestMarketCap = mcap;
            localStorage.setItem('aqmath_last_market_cap', String(mcap));
            const delta = previousMarketCap ? ((mcap - previousMarketCap) / previousMarketCap) * 100 : 0;
            const cls = delta >= 0 ? 'var(--green)' : 'var(--red)';
            body.innerHTML = `
                <div class="lp-widget-main-row"><span class="lp-widget-value" style="color:var(--green)">${fmt(mcap)}</span><span class="lp-widget-signal" style="color:${cls}">${delta >= 0 ? '↗' : '↘'}</span></div>
                <div class="lp-widget-sub">cached trend: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%</div>
                <div class="lp-widget-meta">global crypto market cap · CoinGecko</div>`;
        } catch(e) {
            widgetUnavailable(body);
        }
    }
    await refresh();
    setInterval(refresh, 600000);
}

async function loadTopGainers() {
    const col = getNewsCol('newsRight');
    if (!col) return;
    const card = makeWidgetCard('Top Gainers 24h');
    const body = makeWidgetBody(card);
    col.appendChild(card);

    async function refresh() {
        try {
            const usdt = await fetchMovers();
            const gainers = usdt.slice(0, 3);
            body.innerHTML = gainers.map(t => {
                const sym = t.symbol.replace('USDT', '');
                const pct = parseFloat(t.priceChangePercent).toFixed(2);
                return `<div class="lp-widget-row"><span class="sym">${sym}</span><span class="val up">+${pct}%</span></div>`;
            }).join('') + '<div class="lp-widget-meta">strongest tracked Binance moves</div>';
        } catch(e) {
            widgetUnavailable(body);
        }
    }
    await refresh();
    setInterval(refresh, 300000);
}

async function loadTopLosers() {
    const col = getNewsCol('newsRight');
    if (!col) return;
    const card = makeWidgetCard('Top Losers 24h');
    const body = makeWidgetBody(card);
    col.appendChild(card);

    async function refresh() {
        try {
            const usdt = await fetchMovers();
            const losers = usdt.slice(-3).reverse();
            body.innerHTML = losers.map(t => {
                const sym = t.symbol.replace('USDT', '');
                const pct = parseFloat(t.priceChangePercent);
                const sign = pct >= 0 ? '+' : '';
                return `<div class="lp-widget-row"><span class="sym">${sym}</span><span class="val ${pct >= 0 ? 'up' : 'down'}">${sign}${pct.toFixed(2)}%</span></div>`;
            }).join('') + '<div class="lp-widget-meta">weakest tracked Binance moves</div>';
        } catch(e) {
            widgetUnavailable(body);
        }
    }
    await refresh();
    setInterval(refresh, 300000);
}

function loadHalvingCountdown() {
    const col = getNewsCol('newsRight');
    if (!col) return;
    const card = makeWidgetCard('Bitcoin Halving');
    const body = makeWidgetBody(card);
    col.appendChild(card);
    const nextHalvingDate = new Date('2028-04-20T00:00:00Z');
    const days = Math.max(0, Math.ceil((nextHalvingDate - Date.now()) / 86400000));
    body.innerHTML = `
        <div class="lp-widget-main-row"><span class="lp-widget-value" style="color:var(--amber)">~${days} days</span><span class="lp-widget-signal" style="color:var(--amber)">⏳</span></div>
        <div class="lp-widget-sub">estimated Apr 2028</div>
        <div class="lp-widget-meta">macro cycle clock</div>`;
}

function loadMarketPulse() {
    const col = getNewsCol('newsRight');
    if (!col) return;
    const card = makeWidgetCard('Market Pulse');
    const body = makeWidgetBody(card);
    col.appendChild(card);

    function render() {
        const fear = latestFearGreed;
        const mcap = latestMarketCap;
        const prev = previousMarketCap || mcap;
        const capDelta = mcap && prev ? ((mcap - prev) / prev) * 100 : 0;
        let arrow = '→';
        let color = 'var(--amber)';
        let label = 'mixed / neutral';
        if (fear !== null && fear >= 55 && capDelta >= -0.15) {
            arrow = '↗'; color = 'var(--green)'; label = 'risk-on bias';
        } else if ((fear !== null && fear <= 40) || capDelta < -0.5) {
            arrow = '↘'; color = 'var(--red)'; label = 'defensive bias';
        }
        body.innerHTML = `
            <div class="lp-widget-main-row"><span class="lp-widget-value" style="color:${color}">Trend ${arrow}</span><span class="lp-widget-signal" style="color:${color}">${arrow}</span></div>
            <div class="lp-widget-sub">F&G ${fear ?? '--'} · cap ${capDelta >= 0 ? '+' : ''}${capDelta.toFixed(2)}%</div>
            <div class="lp-widget-meta">${label} from sentiment + market cap</div>`;
    }
    render();
    setInterval(render, 60000);
}

// ── Price Ticker Strip (Binance WebSocket) ──
async function loadPriceTicker() {
    const ticker = document.getElementById('priceTicker');
    if (!ticker || ticker.dataset.loaded === 'true') return;
    ticker.dataset.loaded = 'true';

    const tickerSymbols = new Set(['BTC','ETH','SOL','BNB','XRP','AVAX','LINK','DOGE']);

    async function refresh() {
        try {
            const data = await fetchBinanceMarkets();
            const filtered = data.filter(c => tickerSymbols.has(c.symbol));
            if (!filtered.length) return;
            const items = filtered.map(c => {
                const price = c.current_price || 0;
                const change = c.price_change_percentage_24h || 0;
                const cls = change >= 0 ? 'up' : 'down';
                const sign = change >= 0 ? '+' : '';
                const priceStr = price >= 100 ? price.toFixed(0) : price >= 1 ? price.toFixed(2) : price.toFixed(4);
                return `<div class="lp-ticker-item">
                    <span class="lp-ticker-sym">${c.symbol}</span>
                    <span class="lp-ticker-price">$${priceStr}</span>
                    <span class="lp-ticker-change ${cls}">${sign}${change.toFixed(2)}%</span>
                </div>`;
            }).join('');
            ticker.innerHTML = `<div class="lp-ticker-track">${items}${items}</div>`;
        } catch(e) {
            console.log('Ticker error:', e);
        }
    }
    await refresh();
    setInterval(refresh, 30000); // 30 sec (real-time WS data)
}

async function loadAllWidgets() {
    connectBinanceWS();
    const marketWidgets = document.getElementById('marketWidgets') || document.getElementById('appMarketWidgets');
    if (marketWidgets && marketWidgets.dataset.loaded === 'true') return;
    if (marketWidgets) marketWidgets.dataset.loaded = 'true';
    loadPriceTicker();
    await Promise.all([
        loadFearGreed(),
        loadBTCDominance(),
        loadStablecoinDominance(),
        loadMarketCap(),
        loadTopGainers(),
        loadTopLosers(),
    ]);
    loadHalvingCountdown();
    loadMarketPulse();
}
