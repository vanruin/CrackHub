/** Direct test of the per-generation charge path in members.recordGeneration. */
const assert = require('assert');
const members = require('./backend/members');

(async () => {
    const m = await members.createMember({ name: 'Charge Tester', balance: 50 });

    // 1. successful charge
    const rec = await members.recordGeneration(m.id, { service: 'netflix', price: 10, login: 'a@b.c' });
    assert.strictEqual(rec.recorded, 10, 'recorded should be 10');
    assert.strictEqual(rec.balance, 40, 'balance should drop to 40');

    const view = await members.getMember(m.id);
    assert.strictEqual(view.totalSpent, 10, 'totalSpent');
    assert.strictEqual(view.usage[view.usage.length - 1].price, 10, 'usage price');
    const debit = (view.transactions || []).find(t => t.type === 'debit');
    assert(debit && debit.amount === 10 && debit.balanceAfter === 40, 'debit tx recorded');

    // 2. insufficient funds → 402 / INSUFFICIENT_FUNDS, nothing charged
    await assert.rejects(
        () => members.recordGeneration(m.id, { service: 'netflix', price: 100 }),
        err => err.status === 402 && err.code === 'INSUFFICIENT_FUNDS'
    );
    const afterFail = await members.getMember(m.id);
    assert.strictEqual(afterFail.balance, 40, 'balance untouched after failed charge');

    // 3. zero price = free generation
    const free = await members.recordGeneration(m.id, { service: 'hbo', price: 0 });
    assert.strictEqual(free.recorded, 0);
    assert.strictEqual(free.balance, 40);

    // 4. admin top-up (cash-in credit path) then a charge again
    await members.adjustBalance(m.id, { action: 'add', amount: 100, note: 'test top-up' });
    const topped = await members.getMember(m.id);
    assert.strictEqual(topped.balance, 140, 'top-up credited');

    await members.deleteMember(m.id);
    console.log('CHARGE TESTS PASSED');
    process.exit(0);
})().catch(err => {
    console.error('CHARGE TEST FAILED:', err);
    process.exit(1);
});
