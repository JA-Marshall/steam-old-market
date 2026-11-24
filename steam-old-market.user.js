// ==UserScript==
// @name         Steam Market: old-style front page
// @namespace    https://github.com/JA-Marshall/steam-old-market
// @version      1.0.0
// @author       JA-Marshall
// @license      MIT
// @homepageURL  https://github.com/JA-Marshall/steam-old-market
// @supportURL   https://github.com/JA-Marshall/steam-old-market/issues
// @description  Brings back the old Steam Community Market front page's own lists on the new page: tabs for My Active Listings (with those waiting for confirmation and on hold), My Buy Orders and My Market History, each with item pictures, prices, sorting and a filter, and Steam's own Remove and Cancel buttons (each asks first). Reads only your own listings, orders and history from Steam; never sends anything anywhere else.
// @match        https://steamcommunity.com/market
// @match        https://steamcommunity.com/market/
// @match        https://steamcommunity.com/market?*
// @match        https://steamcommunity.com/market/?*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/JA-Marshall/steam-old-market/main/steam-old-market.user.js
// @updateURL    https://raw.githubusercontent.com/JA-Marshall/steam-old-market/main/steam-old-market.user.js
// ==/UserScript==

/*
 * Steam's new Community Market page (November 2026) moved "My Active Listings", "My Buy Orders" and "My Market
 * History" off the front page onto their own pages (/market/activelistings, /market/buyorders, /market/history).
 * This puts the old front page's tabbed block back, under the "You have N active sell listings" bar, built from the
 * same JSON Steam's old page used:
 *   GET  /market/mylistings?norender=1   (listings, waiting for confirmation, on hold, buy orders; 100 a page)
 *   GET  /market/myhistory?norender=1    (market history, 100 a page, more on "Load more")
 *   POST /market/removelisting/<id>      (Remove: the old page's button, after you OK it)
 *   POST /market/cancelbuyorder/         (Cancel: the old page's button, after you OK it)
 * Pages are read 1.5 s apart, because Steam's edge blocks a connection that reads its market pages too fast. It talks
 * only to steamcommunity.com. What it cannot bring back: the old page's popular items and recently sold lists, which
 * Steam no longer serves; the new page's own sections stay where they are, below this block.
 *
 * MIT licence, see LICENSE.
 */
(function () {
    'use strict';
    if (window.top !== window.self) return;
    const get = (k, d) => { try { const v = GM_getValue(`om_${k}`); return v === undefined ? d : v; } catch (e) { return d; } };
    const set = (k, v) => { try { GM_setValue(`om_${k}`, v); } catch (e) { /* not kept */ } };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const sessionId = () => (document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/) || [])[1] || null;
    const APPS = { 440: 'Team Fortress 2', 730: 'Counter-Strike 2', 570: 'Dota 2', 753: 'Steam', 252490: 'Rust' };
    // Steam's wallet currency ids (amounts are always in hundredths)
    const ISO = { 1: 'USD', 2: 'GBP', 3: 'EUR', 4: 'CHF', 5: 'RUB', 6: 'PLN', 7: 'BRL', 8: 'JPY', 9: 'NOK', 10: 'IDR', 11: 'MYR', 12: 'PHP', 13: 'SGD', 14: 'THB', 15: 'VND', 16: 'KRW', 17: 'TRY', 18: 'UAH', 19: 'MXN', 20: 'CAD', 21: 'AUD', 22: 'NZD', 23: 'CNY', 24: 'INR', 25: 'CLP', 26: 'PEN', 27: 'COP', 28: 'ZAR', 29: 'HKD', 30: 'TWD', 31: 'SAR', 32: 'AED', 34: 'ARS', 35: 'ILS', 37: 'KZT', 38: 'KWD', 39: 'QAR', 40: 'CRC', 41: 'UYU' };
    const money = (cents, cur) => {
        const c = Number(cur) > 2000 ? Number(cur) - 2000 : Number(cur);
        const v = (Number(cents) || 0) / 100;
        try { if (ISO[c]) return new Intl.NumberFormat(undefined, { style: 'currency', currency: ISO[c] }).format(v); } catch (e) { /* plain below */ }
        return `${v.toFixed(2)} (currency ${c})`;
    };
    const icon = a => (a && a.icon_url ? `https://community.akamai.steamstatic.com/economy/image/${a.icon_url}/62fx62f` : '');
    const itemUrl = a => `https://steamcommunity.com/market/listings/${a.appid}/${encodeURIComponent(a.market_hash_name || a.name || '')}`;
    const day = t => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

    async function getJson(url) {
        const r = await fetch(url, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (r.status === 429) throw new Error('Steam says too many requests: wait a few minutes and press Refresh');
        if (!r.ok) throw new Error(`Steam answered ${r.status}`);
        const j = await r.json();
        if (!j || j.success === false) throw new Error('Steam did not answer (are you signed in?)');
        return j;
    }
    async function postForm(url, fields) {
        const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: new URLSearchParams(fields).toString() });
        return r.ok;
    }

    // ---- the data, as the old page had it
    const data = { listings: [], confirm: [], hold: [], orders: [], history: [], historyTotal: 0, historyNext: 0, error: '', loading: false };
    const row = (l, state) => ({ id: String(l.listingid), a: l.asset || {}, buyer: (Number(l.converted_price) || 0) + (Number(l.converted_fee) || 0), net: Number(l.converted_price) || 0, cur: l.converted_currencyid || l.currencyid, at: Number(l.time_created) || 0, state });
    async function loadListings() {
        const seen = new Set();
        const out = { listings: [], confirm: [], hold: [], orders: [] };
        let start = 0;
        let total = 1;
        for (let n = 0; start < total && n < 40; n++) {
            const j = await getJson(`https://steamcommunity.com/market/mylistings?norender=1&count=100&start=${start}`);
            total = Number(j.total_count) || 0;
            for (const l of j.listings || []) if (!seen.has(l.listingid)) { seen.add(l.listingid); out.listings.push(row(l, 'live')); }
            if (n === 0) {
                out.confirm = (j.listings_to_confirm || []).map(l => row(l, 'confirm'));
                out.hold = (j.listings_on_hold || []).map(l => row(l, 'hold'));
                out.orders = (j.buy_orders || []).map(o => ({ id: String(o.buy_orderid), a: { ...(o.description || {}), appid: o.appid, market_hash_name: o.hash_name, name: (o.description && o.description.name) || o.hash_name }, price: Number(o.price) || 0, cur: o.wallet_currency, qty: Number(o.quantity) || 0, left: Number(o.quantity_remaining) || 0 }));
            }
            if (!(j.listings || []).length) break;
            start += 100;
            if (start < total) await sleep(1500);
        }
        Object.assign(data, out);
    }
    const EVENTS = { 1: 'Listed', 2: 'Listing cancelled', 3: 'Sold', 4: 'Purchased' };
    async function loadHistory(more) {
        const start = more ? data.historyNext : 0;
        const j = await getJson(`https://steamcommunity.com/market/myhistory?norender=1&count=100&start=${start}`);
        const assets = j.assets || {};
        const assetOf = x => (x && assets[x.appid] && assets[x.appid][x.contextid] && assets[x.appid][x.contextid][x.id]) || x || {};
        const rows = (j.events || []).map(e => {
            const p = (j.purchases || {})[`${e.listingid}_${e.purchaseid}`];
            const l = (j.listings || {})[e.listingid];
            const a = assetOf((p && p.asset) || (l && l.asset));
            let amount = '';
            if (e.event_type === 3 && p) amount = `+ ${money(p.paid_amount, p.currencyid)}`;
            else if (e.event_type === 4 && p) amount = `− ${money((Number(p.paid_amount) || 0) + (Number(p.paid_fee) || 0), p.currencyid)}`;
            else if (l) amount = money((Number(l.original_price || l.price) || 0) + (Number(l.fee) || 0), l.currencyid);
            return { a, what: EVENTS[e.event_type] || `Event ${e.event_type}`, type: e.event_type, at: Number(e.time_event) || 0, amount };
        });
        data.history = more ? data.history.concat(rows) : rows;
        data.historyTotal = Number(j.total_count) || data.history.length;
        data.historyNext = start + 100;
    }

    // ---- the block
    const css = `
        #om-box{max-width:940px;margin:16px auto;background:rgba(0,0,0,.25);border-radius:4px;font:13px/1.4 "Motiva Sans",Arial,Helvetica,sans-serif;color:#c6d4df}
        #om-box .om-tabs{display:flex;gap:2px;background:rgba(0,0,0,.3);padding:6px 6px 0}
        #om-box .om-tab{padding:8px 14px;cursor:pointer;color:#8f98a0;background:rgba(103,193,245,.08);border-radius:3px 3px 0 0;font-size:14px}
        #om-box .om-tab.on{color:#fff;background:#2a475e}
        #om-box .om-bar{display:flex;gap:10px;align-items:center;padding:8px 10px;background:#2a475e;flex-wrap:wrap}
        #om-box .om-bar input{background:#1b2838;border:1px solid #4b5f73;color:#fff;border-radius:3px;padding:3px 6px}
        #om-box .om-btn{background:linear-gradient(to bottom,#799905 5%,#536904 95%);color:#d2e885;border:0;border-radius:2px;padding:3px 10px;cursor:pointer;font:inherit}
        #om-box .om-btn.grey{background:linear-gradient(to bottom,#67707b 5%,#3d4450 95%);color:#fff}
        #om-box h3{margin:12px 10px 4px;font-size:13px;font-weight:normal;color:#fff;text-transform:uppercase;letter-spacing:.5px}
        #om-box .om-row{display:grid;grid-template-columns:62px 1fr 150px 110px 90px;gap:10px;align-items:center;padding:6px 10px;background:rgba(0,0,0,.2);border-top:1px solid rgba(255,255,255,.04)}
        #om-box .om-row:nth-child(even){background:rgba(0,0,0,.3)}
        #om-box .om-row img{width:62px;height:62px;background:#1b2838;border-radius:2px}
        #om-box .om-row a{color:#fff;text-decoration:none;font-weight:bold}
        #om-box .om-head{display:grid;grid-template-columns:62px 1fr 150px 110px 90px;gap:10px;padding:4px 10px;color:#8f98a0;font-size:11px;text-transform:uppercase}
        #om-box .om-head span[data-sort]{cursor:pointer}
        #om-box .om-sub{color:#8f98a0;font-size:11px}
        #om-box .om-price{color:#fff;text-align:right}
        #om-box .om-msg{padding:10px;color:#8f98a0}
        #om-box .om-list{max-height:640px;overflow:auto}`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const box = document.createElement('div');
    box.id = 'om-box';
    // under the new page's "You have N active sell listings" bar, else at the top of the page's content
    function place() {
        // the "You have N active sell listings" row: from its link up to the whole row (any Steam language)
        const link = document.querySelector('a[href*="/market/activelistings"]');
        let at = link;
        while (at && at.parentElement && at.parentElement.textContent.length < 200) at = at.parentElement;
        if (at && at.parentElement) at.parentElement.insertBefore(box, at.nextSibling);
        else (document.querySelector('main') || document.body).prepend(box);
    }

    let tab = get('tab', 'listings');
    let sort = get('sort', 'new');
    let filter = '';
    const label = a => `<a href="${esc(itemUrl(a))}" target="_blank" rel="noopener" style="color:#${esc(a.name_color || 'fff')}">${esc(a.market_name || a.name || a.market_hash_name || '?')}</a><div class="om-sub">${esc(APPS[a.appid] || `App ${a.appid || '?'}`)}${a.type ? ` · ${esc(a.type)}` : ''}</div>`;
    const sorted = rows => {
        const f = filter.toLowerCase();
        const r = rows.filter(x => !f || String(x.a.market_name || x.a.name || x.a.market_hash_name || '').toLowerCase().includes(f));
        const by = { new: (x, y) => y.at - x.at, old: (x, y) => x.at - y.at, name: (x, y) => String(x.a.market_name || x.a.name || '').localeCompare(String(y.a.market_name || y.a.name || '')), dear: (x, y) => (y.buyer || y.price || 0) - (x.buyer || x.price || 0), cheap: (x, y) => (x.buyer || x.price || 0) - (y.buyer || y.price || 0) }[sort];
        return by ? r.slice().sort(by) : r;
    };
    function listingRows(rows) {
        return sorted(rows).map(l => `<div class="om-row"><img src="${esc(icon(l.a))}" loading="lazy" alt=""><div>${label(l.a)}</div><div class="om-sub">${l.at ? `Listed ${esc(day(l.at))}` : ''}${l.state === 'confirm' ? '<br><span style="color:#e4ae39">Waiting for confirmation</span>' : l.state === 'hold' ? '<br><span style="color:#e4ae39">On hold</span>' : ''}</div><div class="om-price">${esc(money(l.buyer, l.cur))}<div class="om-sub">(${esc(money(l.net, l.cur))} to you)</div></div><div><button class="om-btn grey" data-remove="${esc(l.id)}">Remove</button></div></div>`).join('');
    }
    const head = cols => `<div class="om-head"><span></span><span data-sort="name">Name</span><span data-sort="${sort === 'new' ? 'old' : 'new'}">${cols[0]}</span><span data-sort="${sort === 'dear' ? 'cheap' : 'dear'}" style="text-align:right">${cols[1]}</span><span></span></div>`;
    function draw() {
        const n = { listings: data.listings.length + data.confirm.length + data.hold.length, orders: data.orders.length };
        let body = '';
        if (data.error) body = `<div class="om-msg" style="color:#ff7b7b">${esc(data.error)}</div>`;
        else if (data.loading && !n.listings && !n.orders && !data.history.length) body = '<div class="om-msg">Reading your listings from Steam…</div>';
        else if (tab === 'listings') {
            body = (data.confirm.length ? `<h3>My listings awaiting confirmation (${data.confirm.length})</h3>${head(['Listed on', 'Price'])}<div class="om-list">${listingRows(data.confirm)}</div>` : '')
                + (data.hold.length ? `<h3>My listings on hold (${data.hold.length})</h3>${head(['Listed on', 'Price'])}<div class="om-list">${listingRows(data.hold)}</div>` : '')
                + `<h3>My sell listings (${data.listings.length})</h3>${head(['Listed on', 'Price'])}<div class="om-list">${listingRows(data.listings) || '<div class="om-msg">No active listings.</div>'}</div>`;
        } else if (tab === 'orders') {
            body = `<h3>My buy orders (${data.orders.length})</h3><div class="om-head"><span></span><span data-sort="name">Name</span><span>Quantity</span><span data-sort="${sort === 'dear' ? 'cheap' : 'dear'}" style="text-align:right">Price</span><span></span></div><div class="om-list">`
                + (sorted(data.orders).map(o => `<div class="om-row"><img src="${esc(icon(o.a))}" loading="lazy" alt=""><div>${label(o.a)}</div><div class="om-sub">${o.left} of ${o.qty} left</div><div class="om-price">${esc(money(o.price, o.cur))}</div><div><button class="om-btn grey" data-cancel="${esc(o.id)}">Cancel</button></div></div>`).join('') || '<div class="om-msg">No buy orders.</div>') + '</div>';
        } else {
            body = `<h3>My market history (${data.history.length} of ${data.historyTotal})</h3><div class="om-list">`
                + (data.history.filter(h => !filter || String(h.a.market_name || h.a.name || '').toLowerCase().includes(filter.toLowerCase())).map(h => `<div class="om-row"><img src="${esc(icon(h.a))}" loading="lazy" alt=""><div>${label(h.a)}</div><div class="om-sub">${esc(h.what)}<br>${h.at ? esc(day(h.at)) : ''}</div><div class="om-price" style="color:${h.type === 3 ? '#a4d007' : h.type === 4 ? '#ff7b7b' : '#c6d4df'}">${esc(h.amount)}</div><div></div></div>`).join('') || '<div class="om-msg">No history read yet.</div>')
                + `</div>${data.historyNext < data.historyTotal ? '<div class="om-msg"><button class="om-btn grey" id="om-more">Load more</button></div>' : ''}`;
        }
        box.innerHTML = `<div class="om-tabs"><div class="om-tab${tab === 'listings' ? ' on' : ''}" data-tab="listings">My Active Listings <span class="om-sub">(${n.listings})</span></div><div class="om-tab${tab === 'orders' ? ' on' : ''}" data-tab="orders">My Buy Orders <span class="om-sub">(${n.orders})</span></div><div class="om-tab${tab === 'history' ? ' on' : ''}" data-tab="history">My Market History</div></div>`
            + `<div class="om-bar"><input id="om-filter" placeholder="Filter by name" value="${esc(filter)}"><button class="om-btn" id="om-refresh">Refresh</button><span class="om-sub">${data.loading ? 'Reading from Steam…' : ''}</span></div>${body}`;
        for (const t of box.querySelectorAll('[data-tab]')) t.onclick = () => { tab = t.dataset.tab; set('tab', tab); if (tab === 'history' && !data.history.length) refresh('history'); else draw(); };
        for (const s of box.querySelectorAll('[data-sort]')) s.onclick = () => { sort = s.dataset.sort; set('sort', sort); draw(); };
        const fi = box.querySelector('#om-filter');
        fi.oninput = () => { filter = fi.value; const pos = fi.selectionStart; draw(); const again = box.querySelector('#om-filter'); again.focus(); again.setSelectionRange(pos, pos); };
        box.querySelector('#om-refresh').onclick = () => refresh(tab === 'history' ? 'history' : 'listings');
        const more = box.querySelector('#om-more');
        if (more) more.onclick = () => refresh('more');
        for (const b of box.querySelectorAll('[data-remove]')) b.onclick = () => remove(b.dataset.remove);
        for (const b of box.querySelectorAll('[data-cancel]')) b.onclick = () => cancel(b.dataset.cancel);
    }
    async function refresh(what) {
        if (data.loading) return;
        data.loading = true;
        data.error = '';
        draw();
        try {
            if (what === 'history') await loadHistory(false);
            else if (what === 'more') await loadHistory(true);
            else await loadListings();
        } catch (err) {
            data.error = `Could not read from Steam: ${err.message}`;
        } finally {
            data.loading = false;
            draw();
        }
    }
    async function remove(id) {
        const l = [...data.listings, ...data.confirm, ...data.hold].find(x => x.id === id);
        if (!l || !sessionId()) return;
        if (!confirm(`Remove your listing of ${l.a.market_name || l.a.name} (${money(l.buyer, l.cur)}) from the market? The item goes back to your inventory.`)) return;
        if (await postForm(`https://steamcommunity.com/market/removelisting/${id}`, { sessionid: sessionId() })) {
            for (const k of ['listings', 'confirm', 'hold']) data[k] = data[k].filter(x => x.id !== id);
        } else data.error = `Steam did not remove the listing of ${l.a.market_name || l.a.name}: press Refresh and try again.`;
        draw();
    }
    async function cancel(id) {
        const o = data.orders.find(x => x.id === id);
        if (!o || !sessionId()) return;
        if (!confirm(`Cancel your buy order for ${o.a.name} (${o.left} at ${money(o.price, o.cur)})?`)) return;
        if (await postForm('https://steamcommunity.com/market/cancelbuyorder/', { sessionid: sessionId(), buy_orderid: id })) data.orders = data.orders.filter(x => x.id !== id);
        else data.error = `Steam did not cancel the order for ${o.a.name}: press Refresh and try again.`;
        draw();
    }

    // the new page draws itself after load: wait for its listings bar (up to 10 s), then place the block once
    let tries = 0;
    (function wait() {
        if (document.getElementById('om-box')) return;
        const ready = [...document.querySelectorAll('a[href*="/market/activelistings"]')].length > 0;
        if (!ready && tries++ < 20) return setTimeout(wait, 500);
        place();
        draw();
        refresh(tab === 'history' ? 'history' : 'listings');
        // the new page can redraw itself and drop the block: put it back (with what was already read)
        setInterval(() => { if (!document.contains(box)) place(); }, 2000);
    })();
})();
