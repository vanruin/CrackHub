/**
 * Platform API — key login, members, balance, tickets, cash-ins, pricing.
 * Mounted from server.js:  mountPlatformApi(app, { counters, generators })
 */

const express = require('express');

const auth = require('./auth');
const config = require('./config');
const members = require('./members');
const tickets = require('./tickets');
const { money } = require('./money');
const cashins = require('./cashins');
const pricing = require('./pricing');
const accountPool = require('./accountPool');
const { CATALOG, getservice, view: catalogView } = require('./catalog');

/** async handler + consistent JSON error shape */
function wrap(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (err) {
            const status = err.status || err.statusCode || 500;
            if (status >= 500) console.error('❌ API error:', err);
            res.status(status).json({
                success: false,
                error: err.message || 'Unexpected server error',
                ...(err.code ? { code: err.code } : {}),
            });
        }
    };
}

/** Ticket view for the member — hides internal member identifiers. */
function ticketForMember(ticket) {
    if (!ticket) return null;
    const { memberId, memberKey, ...rest } = ticket;
    return rest;
}

function mountPlatformApi(app, options = {}) {
    const counters = options.counters || {};
    const generators = options.generators || {};
    const poolCounter = accountPool.poolCounter(counters);

    // ========================================================= AUTH
    // Brute-force limiter for the login endpoint (per IP, in-memory).
    const loginHits = new Map();
    const LOGIN_WINDOW_MS = 60 * 1000;
    const LOGIN_MAX_ATTEMPTS = 10;

    function loginTooFast(ip) {
        const now = Date.now();
        const list = (loginHits.get(ip) || []).filter(t => now - t < LOGIN_WINDOW_MS);
        list.push(now);
        loginHits.set(ip, list);
        if (loginHits.size > 5000) loginHits.clear();   // bound memory
        return list.length > LOGIN_MAX_ATTEMPTS;
    }

    app.post('/api/auth/login', wrap(async (req, res) => {
        const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
        if (loginTooFast(ip)) {
            res.setHeader('Retry-After', '60');
            return res.status(429).json({
                success: false,
                code: 'RATE_LIMITED',
                error: 'Too many login attempts — wait a minute before trying again.',
            });
        }

        const rawKey = req.body && req.body.key;
        const key = typeof rawKey === 'string' ? rawKey.trim().slice(0, 128) : '';
        if (!key) return res.status(400).json({ success: false, error: 'Enter your access key' });

        // Each login page pins its portal: /login = members, /admin-login = staff.
        const portal = req.body && typeof req.body.portal === 'string' ? req.body.portal : '';
        if (portal && portal !== 'member' && portal !== 'admin') {
            return res.status(400).json({ success: false, error: 'Unknown login portal.' });
        }

        const secure = !!req.secure || req.headers['x-forwarded-proto'] === 'https';
        const adminKey = await config.getAdminKey();

        if (key.toUpperCase() === adminKey.toUpperCase()) {
            if (portal === 'member') {
                return res.status(401).json({
                    success: false,
                    code: 'INVALID_KEY',
                    error: 'That is a staff key — use the staff entrance to sign in.',
                    loginUrl: '/admin-login',
                });
            }
            const token = await auth.createToken({ k: 'admin' });
            auth.setSessionCookie(res, token, undefined, { secure });
            return res.json({ success: true, role: 'admin', redirect: '/admin.html' });
        }

        if (portal === 'admin') {
            return res.status(401).json({
                success: false,
                code: 'INVALID_KEY',
                error: 'Staff key not recognized — members sign in next door.',
                loginUrl: '/login',
            });
        }

        const member = await members.findByKey(key);
        if (!member) {
            return res.status(401).json({
                success: false,
                code: 'INVALID_KEY',
                error: 'That access key is not valid. Double-check it or ask your admin for a new one.',
            });
        }
        if ((member.status || 'active') !== 'active') {
            return res.status(403).json({
                success: false,
                code: 'KEY_DISABLED',
                error: 'This access key has been disabled. Contact your admin.',
            });
        }

        const token = await auth.createToken({ k: 'member', id: member.id });
        auth.setSessionCookie(res, token, undefined, { secure });
        return res.json({ success: true, role: 'member', member: members.publicView(member), redirect: '/' });
    }));

    app.post('/api/auth/logout', (req, res) => {
        const secure = !!req.secure || req.headers['x-forwarded-proto'] === 'https';
        auth.clearSessionCookie(res, { secure });
        res.json({ success: true });
    });

    app.get('/api/auth/me', auth.attachIdentity, wrap(async (req, res) => {
        const identity = req.crackhub;
        if (!identity) {
            return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'No active session' });
        }
        if (identity.kind === 'admin') return res.json({ success: true, role: 'admin' });
        if (identity.kind === 'disabled') {
            return res.status(403).json({ success: false, code: 'KEY_DISABLED', error: 'Key disabled', member: identity.member });
        }
        return res.json({ success: true, role: 'member', member: identity.member });
    }));

    // ========================================================= PUBLIC
    app.get('/api/services', wrap(async (req, res) => {
        const prices = await pricing.getAll();
        res.json({ success: true, services: await catalogView(poolCounter, prices) });
    }));

    // Pool counts are member-only — consistent with /api/test-* and /api/account-counts.
    app.get('/api/counts', auth.requireMember, wrap(async (req, res) => {
        const entries = await Promise.all(CATALOG.map(async svc => [svc.key, await poolCounter(svc.key)]));
        res.json({ success: true, counts: Object.fromEntries(entries) });
    }));

    // ========================================================= MEMBER
    const memberApi = express.Router();

    memberApi.get('/me', wrap(async (req, res) => {
        const member = await members.getMember(req.member.id);
        if (!member) return res.status(404).json({ success: false, error: 'Member no longer exists' });
        const [tickets_, usage, counts] = await Promise.all([
            tickets.listTickets({ memberId: member.id }),
            members.getUsage(member.id),
            Promise.all(CATALOG.map(async svc => [svc.key, await poolCounter(svc.key)])),
        ]);
        const openTickets = tickets_.filter(t => tickets.OPEN_STATES.includes(t.status)).length;
        res.json({
            success: true,
            member: members.publicView(member),
            stats: {
                generations: (member.usage || []).length,
                tickets: tickets_.length,
                openTickets,
                totalSpent: (member.transactions || [])
                    .filter(t => t.type === 'debit')
                    .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0),
            },
            counts: Object.fromEntries(counts),
            usage: usage.slice(0, 12),
        });
    }));

    memberApi.get('/usage', wrap(async (req, res) => {
        const usage = await members.getUsage(req.member.id);
        res.json({ success: true, usage });
    }));

    memberApi.get('/transactions', wrap(async (req, res) => {
        const member = await members.getMember(req.member.id);
        const list = ((member && member.transactions) || [])
            .filter(t => t.type !== 'usage')
            .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        res.json({ success: true, transactions: list });
    }));

    // ------------------------------------------------- member: cash-ins
    // The member picks a denomination, scans the QR in Assets/prices with
    // GCash and attaches the receipt — the admin approves it into balance.
    memberApi.get('/cashin', wrap(async (req, res) => {
        const member = await members.getMember(req.member.id);
        if (!member) return res.status(404).json({ success: false, error: 'Member no longer exists' });

        const requests = await cashins.listForMember(member.id);
        res.json({
            success: true,
            balance: members.publicView(member).balance,
            denominations: cashins.DENOMINATIONS,
            requests,
            pending: requests.filter(r => r.status === 'pending').length,
        });
    }));

    memberApi.post('/cashin', wrap(async (req, res) => {
        const body = req.body || {};
        const member = await members.getMember(req.member.id);
        if (!member) return res.status(404).json({ success: false, error: 'Member no longer exists' });

        const request = await cashins.createRequest({
            member,
            amount: body.amount,
            reference: body.reference,
            note: body.note,
            receipt: body.receipt,
        });

        res.status(201).json({
            success: true,
            request,
            message: 'Cash-in received — the admin will verify your GCash receipt shortly.',
        });
    }));

    memberApi.get('/tickets', wrap(async (req, res) => {
        const list = await tickets.listTickets({ memberId: req.member.id });
        res.json({ success: true, tickets: list.map(ticketForMember) });
    }));

    memberApi.post('/tickets', wrap(async (req, res) => {
        const body = req.body || {};
        const svc = getservice(body.service);
        if (!svc) return res.status(400).json({ success: false, error: 'Unknown service' });

        const member = await members.getMember(req.member.id);
        if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

        const usage = await members.getUsage(member.id);
        const entry = body.usageId ? usage.find(u => u.id === body.usageId) : null;
        const charged = entry ? Number(entry.price) || 0 : 0;

        const ticket = await tickets.createTicket({
            member,
            service: svc.key,
            serviceLabel: svc.label,
            account: body.account,
            reason: body.reason,
            usageId: entry ? entry.id : null,
            charged,
        });

        // remember which generation was reported (blocks duplicate reports)
        if (entry) await members.markUsageTicketed(member.id, entry.id, ticket.id);

        res.status(201).json({
            success: true,
            ticket: ticketForMember(ticket),
            message: 'Ticket opened — the admin will replace the account or refund anything that was charged.',
        });
    }));

    memberApi.get('/tickets/:id', wrap(async (req, res) => {
        const ticket = await tickets.getTicketForMember(req.params.id, req.member.id);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
        res.json({ success: true, ticket: ticketForMember(ticket) });
    }));

    memberApi.post('/tickets/:id/reply', wrap(async (req, res) => {
        const text = String((req.body && req.body.text) || '').trim();
        const existing = await tickets.getTicketForMember(req.params.id, req.member.id);
        if (!existing) return res.status(404).json({ success: false, error: 'Ticket not found' });

        const ticket = await tickets.reply(req.params.id, { from: 'member', text });
        res.json({ success: true, ticket: ticketForMember(ticket) });
    }));

    memberApi.post('/tickets/:id/close', wrap(async (req, res) => {
        const existing = await tickets.getTicketForMember(req.params.id, req.member.id);
        if (!existing) return res.status(404).json({ success: false, error: 'Ticket not found' });

        const ticket = await tickets.setStatus(req.params.id, 'closed', { note: 'Closed by the member.' });
        res.json({ success: true, ticket: ticketForMember(ticket) });
    }));

    app.use('/api/member', auth.requireMember, memberApi);

    // ========================================================= ADMIN
    const adminApi = express.Router();

    async function memberCards(query = '') {
        const [list, allTickets] = await Promise.all([
            members.listMembers(),
            tickets.listTickets(),
        ]);
        const needle = String(query || '').trim().toLowerCase();

        return list
            .map(m => {
                const mine = allTickets.filter(t => t.memberId === m.id);
                return {
                    ...m,
                    transactions: undefined,
                    usage: undefined,
                    stats: {
                        generations: (m.usage || []).length,
                        tickets: mine.length,
                        openTickets: mine.filter(t => tickets.OPEN_STATES.includes(t.status)).length,
                        totalSpent: (m.transactions || [])
                            .filter(t => t.type === 'debit')
                            .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0),
                        totalRefunded: (m.transactions || [])
                            .filter(t => t.type === 'refund')
                            .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0),
                    },
                    recentUsage: (m.usage || []).slice(0, 8),
                };
            })
            .filter(m => !needle || [m.name, m.key, m.id, m.note]
                .some(field => String(field || '').toLowerCase().includes(needle)));
    }

    adminApi.get('/stats', wrap(async (req, res) => {
        const [list, prices, ticketCounts, cashinCounts] = await Promise.all([
            members.listMembers(),
            pricing.getAll(),
            tickets.counts(),
            cashins.counts(),
        ]);
        const catalog = await catalogView(poolCounter, prices);

        const revenue = list.reduce((sum, m) => sum + (m.transactions || [])
            .filter(t => t.type === 'debit')
            .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0), 0);
        const refunded = list.reduce((sum, m) => sum + (m.transactions || [])
            .filter(t => t.type === 'refund')
            .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0), 0);

        res.json({
            success: true,
            stats: {
                members: list.length,
                activeMembers: list.filter(m => (m.status || 'active') === 'active').length,
                outstandingBalance: money(list.reduce((sum, m) => sum + (Number(m.balance) || 0), 0)),
                revenue: money(revenue),
                refunded: money(refunded),
                net: money(revenue - refunded),
                generations: list.reduce((sum, m) => sum + (m.usage || []).length, 0),
                totalGenerated: list.reduce((sum, m) => sum + (m.totalGenerated || 0), 0),
                tickets: ticketCounts,
                cashIns: cashinCounts,
            },
            services: catalog,
        });
    }));

    adminApi.get('/members', wrap(async (req, res) => {
        res.json({ success: true, members: await memberCards(req.query.query || req.query.q || '') });
    }));

    adminApi.post('/members', wrap(async (req, res) => {
        const member = await members.createMember(req.body || {});
        res.status(201).json({
            success: true,
            member,
            message: `Member created — access key: ${member.key}`,
        });
    }));

    adminApi.get('/members/:id', wrap(async (req, res) => {
        const member = await members.getMember(req.params.id);
        if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

        const [usage, mine] = await Promise.all([
            members.getUsage(member.id),
            tickets.listTickets({ memberId: member.id }),
        ]);

        res.json({
            success: true,
            member: members.publicView(member),
            usage,
            transactions: (member.transactions || []).slice().reverse(),
            tickets: mine,
        });
    }));

    adminApi.patch('/members/:id', wrap(async (req, res) => {
        const member = await members.updateMember(req.params.id, req.body || {});
        res.json({ success: true, member });
    }));

    adminApi.post('/members/:id/key/rotate', wrap(async (req, res) => {
        const member = await members.rotateKey(req.params.id);
        res.json({ success: true, member, message: `New access key: ${member.key}` });
    }));

    adminApi.delete('/members/:id', wrap(async (req, res) => {
        const removed = await members.deleteMember(req.params.id);
        res.json({ success: true, removed, message: `${removed.name} removed` });
    }));

    adminApi.post('/members/:id/balance', wrap(async (req, res) => {
        const body = req.body || {};
        const actionMap = {
            topup: 'add', add: 'add', credit: 'add',
            debit: 'subtract', deduct: 'subtract', subtract: 'subtract',
            set: 'set',
        };
        const action = actionMap[String(body.action || 'topup').toLowerCase()];
        if (!action) {
            return res.status(400).json({ success: false, error: 'action must be topup, debit or set' });
        }
        const member = await members.adjustBalance(req.params.id, {
            action,
            amount: body.amount,
            note: body.note,
            by: 'admin',
        });
        res.json({ success: true, member, message: `Balance is now ₱${member.balance}` });
    }));

    adminApi.get('/pool/:service', wrap(async (req, res) => {
        const svc = getservice(req.params.service);
        if (!svc) return res.status(404).json({ success: false, error: 'Unknown service' });

        const limit = Math.min(Number(req.query.limit) || 200, 1000);
        const [entries, count] = await Promise.all([
            accountPool.listPool(svc.key, { limit }),
            poolCounter(svc.key),
        ]);

        res.json({ success: true, service: svc.key, label: svc.label, count, entries });
    }));

    // ------------------------------------------------- admin: tickets
    adminApi.get('/tickets', wrap(async (req, res) => {
        const list = await tickets.listTickets({
            status: req.query.status || '',
            query: req.query.query || '',
        });
        res.json({ success: true, tickets: list, counts: await tickets.counts() });
    }));

    adminApi.get('/tickets/:id', wrap(async (req, res) => {
        const ticket = await tickets.getTicket(req.params.id);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
        const member = await members.getMember(ticket.memberId);
        res.json({ success: true, ticket, member: members.publicView(member) });
    }));

    adminApi.post('/tickets/:id/reply', wrap(async (req, res) => {
        const body = req.body || {};
        const text = String(body.text || '').trim();
        if (!text) return res.status(400).json({ success: false, error: 'Message cannot be empty' });

        await tickets.reply(req.params.id, { from: 'admin', text });
        const ticket = body.status
            ? await tickets.setStatus(req.params.id, body.status, {})
            : await tickets.getTicket(req.params.id);
        res.json({ success: true, ticket });
    }));

    adminApi.post('/tickets/:id/status', wrap(async (req, res) => {
        const body = req.body || {};
        const ticket = await tickets.setStatus(req.params.id, body.status, { note: body.note });
        res.json({ success: true, ticket });
    }));

    adminApi.post('/tickets/:id/refund', wrap(async (req, res) => {
        const body = req.body || {};
        const ticket = await tickets.getTicket(req.params.id);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
        if (ticket.refunded) return res.status(409).json({ success: false, error: 'This ticket was already refunded' });

        const amount = Number(body.amount || ticket.charged) || 0;
        if (amount <= 0) return res.status(400).json({ success: false, error: 'Nothing to refund on this ticket' });

        const member = await members.refund(ticket.memberId, {
            amount,
            note: `Refund — ticket ${ticket.id} (${ticket.serviceLabel})`,
            by: 'admin',
        });
        const updated = await tickets.markRefunded(ticket.id, amount);

        res.json({
            success: true,
            ticket: updated,
            member,
            message: `₱${amount} refunded — new balance ₱${member.balance}`,
        });
    }));

    adminApi.post('/tickets/:id/replace', wrap(async (req, res) => {
        const body = req.body || {};
        const ticket = await tickets.getTicket(req.params.id);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

        let replacement;
        if (body.mode === 'manual' || body.account) {
            if (!String(body.account || '').trim()) {
                return res.status(400).json({ success: false, error: 'Provide the replacement account' });
            }
            replacement = {
                account: String(body.account).trim(),
                password: String(body.password || ''),
                note: String(body.note || 'Manual replacement by admin'),
                source: 'manual',
            };
        } else {
            replacement = await accountPool.buildReplacement(ticket.service, ticket.account, generators);
            if (body.note) replacement.note = [replacement.note, body.note].filter(Boolean).join(' — ');
        }

        const wantsRefund = body.refund === true || body.refund === 'true';
        const updated = await tickets.applyReplacement(ticket.id, {
            replacement,
            note: String(body.message || ''),
            refundAmount: wantsRefund ? ticket.charged : 0,
        });

        let member = null;
        let finalTicket = updated;
        if (wantsRefund && Number(ticket.charged) > 0 && !ticket.refunded) {
            member = await members.refund(ticket.memberId, {
                amount: ticket.charged,
                note: `Refund + replacement — ticket ${ticket.id}`,
                by: 'admin',
            });
            finalTicket = await tickets.markRefunded(ticket.id, ticket.charged);
        }

        res.json({
            success: true,
            ticket: finalTicket,
            member,
            message: `Replacement issued: ${replacement.account}${wantsRefund ? ` (₱${ticket.charged} refunded)` : ''}`,
        });
    }));

    // ------------------------------------------------- admin: cash-ins
    adminApi.get('/cashins', wrap(async (req, res) => {
        const list = await cashins.listRequests({
            status: req.query.status || '',
            query: req.query.query || '',
        });
        res.json({
            success: true,
            denominations: cashins.DENOMINATIONS,
            requests: list,
            counts: await cashins.counts(),
        });
    }));

    adminApi.get('/cashins/:id', wrap(async (req, res) => {
        const request = await cashins.getRequest(req.params.id);
        if (!request) return res.status(404).json({ success: false, error: 'Cash-in request not found' });
        const member = await members.getMember(request.memberId);
        res.json({ success: true, request, member: members.publicView(member) });
    }));

    adminApi.post('/cashins/:id/approve', wrap(async (req, res) => {
        const body = req.body || {};
        const request = await cashins.getRequest(req.params.id);
        if (!request) return res.status(404).json({ success: false, error: 'Cash-in request not found' });
        if (request.status === 'approved') {
            return res.status(409).json({ success: false, error: 'This cash-in was already approved' });
        }

        // Credit the member's balance with the paid amount…
        const member = await members.adjustBalance(request.memberId, {
            action: 'add',
            amount: request.amount,
            note: `Cash-in approved — ${request.id}${request.reference ? ` · ref ${request.reference}` : ''}`,
            by: 'admin',
        });

        // …then mark the request so it can never credit twice.
        const updated = await cashins.setStatus(request.id, 'approved', {
            note: body.note || 'GCash payment verified — balance credited.',
            by: 'admin',
            creditedTo: member.balance,
        });

        res.json({
            success: true,
            request: updated,
            member,
            message: `₱${money(request.amount)} credited — new balance ₱${money(member.balance)}`,
        });
    }));

    adminApi.post('/cashins/:id/reject', wrap(async (req, res) => {
        const body = req.body || {};
        const existing = await cashins.getRequest(req.params.id);
        if (!existing) return res.status(404).json({ success: false, error: 'Cash-in request not found' });
        if (existing.status === 'approved') {
            return res.status(409).json({ success: false, error: 'This cash-in was already approved' });
        }

        const request = await cashins.setStatus(req.params.id, 'rejected', {
            note: body.note || 'Receipt could not be verified.',
            by: 'admin',
        });
        res.json({ success: true, request, message: 'Cash-in rejected — the member can submit a new one.' });
    }));

    // ------------------------------------------------- admin: pricing
    adminApi.get('/pricing', wrap(async (req, res) => {
        res.json({ success: true, prices: await pricing.list() });
    }));

    adminApi.post('/pricing', wrap(async (req, res) => {
        const body = req.body || {};
        const patch = body.prices && typeof body.prices === 'object' ? body.prices : body;
        await pricing.setPrices(patch);
        res.json({
            success: true,
            prices: await pricing.list(),
            message: 'Service prices updated — members see them on the store right away.',
        });
    }));

    // ------------------------------------------------- admin: settings
    adminApi.get('/config', wrap(async (req, res) => {
        const data = await config.load();
        res.json({
            success: true,
            config: {
                adminKey: data.adminKey,
                siteName: data.siteName || 'CrackHub',
                currency: data.currency || '₱',
            },
        });
    }));

    adminApi.post('/config/admin-key', wrap(async (req, res) => {
        const body = req.body || {};
        const next = body.newKey ? String(body.newKey).trim() : '';
        if (next && !/^[A-Za-z0-9-]{6,64}$/.test(next)) {
            return res.status(400).json({ success: false, error: 'Admin key must be 6-64 letters, numbers or dashes' });
        }
        const adminKey = await config.rotateAdminKey(next);
        res.json({
            success: true,
            adminKey,
            message: next ? 'Admin key updated — keep it somewhere safe' : 'A new admin key was generated',
        });
    }));

    app.use('/api/admin', auth.requireAdmin, adminApi);

    return { memberApi, adminApi };
}

module.exports = { mountPlatformApi };

