/* ==========================================================================
   CrackHub platform client
   Shared by every page: renders the top bar, keeps the balance chip live and
   turns the raw generator responses into billed, key-gated requests.
   ========================================================================== */

(function () {
    'use strict';

    const CH = {
        state: { role: null, member: null },
        me: null,
    };

    // ------------------------------------------------------------ utils
    CH.money = function (value) {
        const n = Number(value);
        return '₱' + (Number.isFinite(n) ? n : 0).toFixed(2);
    };

    CH.esc = function (value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    CH.when = function (iso) {
        if (!iso) return '—';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    };

    CH.toast = function (message, kind) {
        let box = document.getElementById('chToast');
        if (!box) {
            box = document.createElement('div');
            box.id = 'chToast';
            document.body.appendChild(box);
        }
        const el = document.createElement('div');
        el.className = 'ch-toast ' + (kind || 'info');
        el.textContent = message;
        box.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity .3s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 320);
        }, 4200);
    };

    /** Copy text to the clipboard; resolves true on success. Falls back to a
     *  hidden textarea + execCommand when the async clipboard API is blocked
     *  (http origins, older browsers). */
    CH.copy = async function (text) {
        const value = String(text === undefined || text === null ? '' : text);
        if (!value) return false;

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch (err) { /* fall through to the legacy path */ }

        try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (err) {
            return false;
        }
    };

    CH.isAdminPage = function () {
        return CH.state.adminPage === true || document.body.hasAttribute('data-ch-admin');
    };

    CH.loginUrl = function () {
        // Staff pages send users to the separate staff entrance.
        const page = CH.isAdminPage() ? '/admin-login' : '/login';
        return page + '?next=' + encodeURIComponent(window.location.pathname + window.location.search);
    };

    /** fetch wrapper: JSON in/out, friendly errors, auto re-login on 401. */
    CH.request = async function (url, options) {
        const opts = options || {};
        const init = {
            method: opts.method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
        };
        if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

        const res = await fetch(url, init);
        let data = {};
        try { data = await res.json(); } catch (err) { data = {}; }

        if (!res.ok || data.success === false) {
            const error = new Error(data.error || `Request failed (${res.status})`);
            error.status = res.status;
            error.code = data.code;
            error.payload = data;
            if (res.status === 401) window.location.href = CH.loginUrl();
            throw error;
        }
        return data;
    };

    CH.setBalance = function (value) {
        CH.state.balance = value;
        if (CH.state.member) CH.state.member.balance = value;
        const el = document.getElementById('chBalance');
        if (el && CH.state.role !== 'admin') el.textContent = CH.money(value);
    };

    // ------------------------------------------------------------ nav
    const LINKS = [
        { href: '/', label: 'Store' },
        { href: '/support', label: 'Support' },
        { href: '/guidelines', label: 'Guidelines' },
    ];

    function renderNav() {
        if (document.getElementById('chNav')) return;

        const role = CH.state.role || 'member';
        const path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const links = LINKS.map(l =>
            `<a class="${l.href === path ? 'active' : ''}" href="${l.href}">${l.label}</a>`).join('');

        const adminLinks = role === 'admin'
            ? `<a href="/admin.html"${path === '/admin' ? ' class="active"' : ''}>Admin</a>
               <a href="/tools"${path === '/tools' ? ' class="active"' : ''}>Bulk tools</a>`
            : '';

        const chip = role === 'admin'
            ? '<span class="ch-pill admin" id="chBalance">🛡️ Admin</span>'
            : `<span class="ch-pill" id="chBalance">${CH.state.member ? CH.money(CH.state.member.balance) : '₱0.00'}</span>`;

        const nav = document.createElement('nav');
        nav.className = 'ch-nav';
        nav.id = 'chNav';
        nav.innerHTML = `
            <div class="ch-nav-inner">
                <a class="ch-brand" href="/">⚡ <span>CrackHub</span></a>
                <div class="ch-links">${links}${adminLinks}</div>
                <div class="ch-right">
                    ${chip}
                    <button class="ch-btn ghost sm" id="chLogout" type="button">Log out</button>
                </div>
            </div>`;

        document.body.insertBefore(nav, document.body.firstChild);
        document.body.classList.add('ch-has-nav');

        nav.querySelector('#chLogout').addEventListener('click', async () => {
            try { await CH.request('/api/auth/logout', { method: 'POST' }); } catch (err) { /* ignore */ }
            window.location.href = CH.loginUrl();
        });
    }

    // ------------------------------------------------------------ billing watcher
    const BILLED = [/\/api\/get-random-/, /\/api\/steam-account\//];

    function watchBilling() {
        const nativeFetch = window.fetch.bind(window);

        window.fetch = async function (input, init) {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const res = await nativeFetch(input, init);

            if (!BILLED.some(re => re.test(String(url || '')))) return res;

            if (res.status === 401) {
                CH.toast('Session expired — please sign in again.', 'bad');
                setTimeout(() => { window.location.href = CH.loginUrl(); }, 900);
                return res;
            }
            if (res.status === 403) {
                CH.toast('This access key was disabled. Contact the admin.', 'bad');
                return res;
            }
            if (res.status === 402) {
                CH.toast('Not enough balance — cash in to add funds.', 'bad');
                return res;
            }

            // the page's own script still reads the original body
            res.clone().json().then(data => {
                const billing = data && data.billing;
                if (!billing) return;
                if (billing.balance !== undefined) CH.setBalance(billing.balance);
                if (billing.charged > 0) {
                    CH.toast(`${CH.money(billing.charged)} charged — balance ${CH.money(billing.balance)}`, 'info');
                }
            }).catch(() => {});

            return res;
        };
    }

    // ------------------------------------------------------------ boot
    /**
     * CH.start({ requireRole, onReady })
     *   requireRole: 'member' | 'admin' | null (null = don't care)
     */
    CH.start = async function (options) {
        const opts = options || {};
        if (opts.requireRole === 'admin') CH.state.adminPage = true;
        watchBilling();

        let me;
        try {
            me = await CH.request('/api/auth/me');
        } catch (err) {
            if (err.status === 401) return;             // CH.request already redirected
            if (err.status === 403) {                   // disabled key
                window.location.href = CH.loginUrl();
                return;
            }
            CH.toast(err.message, 'bad');
            return;
        }

        CH.me = me;
        CH.state.role = me.role;
        CH.state.member = me.member || null;
        CH.state.balance = me.member ? me.member.balance : null;

        if (opts.requireRole === 'admin' && me.role !== 'admin') {
            CH.toast('Admin key required.', 'bad');
            window.location.href = '/';
            return;
        }

        renderNav();
        if (opts.onReady) await opts.onReady(me, CH);
        document.dispatchEvent(new CustomEvent('ch:ready', { detail: me }));
    };

    // Service pages include this file only for the nav + billing watcher
    if (document.body.hasAttribute('data-ch-service')) CH.start({ requireRole: 'member' });
    if (document.body.hasAttribute('data-ch-admin')) CH.start({ requireRole: 'admin' });

    window.CH = CH;
})();
