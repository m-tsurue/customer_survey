const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const original = execFileSync('git', ['show', '29109a2:delivery/コード.gs'], { cwd: root, encoding: 'utf8' });
const current = fs.readFileSync(path.join(root, 'delivery/コード.gs'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'delivery/MechanicNotification.gs'), 'utf8');
// These are synthetic test values, not credentials. Never perform real HTTP requests.
const primary = 'https://' + 'hooks.slack.com/services/TEST/PRIMARY/PLACEHOLDER';
const mechanic = 'https://' + 'hooks.slack.com/services/TEST/MECHANIC/PLACEHOLDER';

function runtime({ baseline = false, configured = true, secondary = mechanic, failPrimary, failSecondary, propertyError = false, customerMissing = false } = {}) {
  const sent = [], logs = [];
  let lookupCount = 0;
  const context = vm.createContext({
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push([level, ...args.map(String)])])),
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => {
      if (key === 'SLACK_MECHANIC_WEBHOOK_URL') {
        if (propertyError) throw Error('unavailable ' + mechanic);
        return configured ? secondary : null;
      }
      return key === 'SLACK_WEBHOOK_URL' ? primary : null;
    } }) },
    UrlFetchApp: { fetch: (url, options) => {
      sent.push({ url, options: JSON.parse(JSON.stringify(options)), payload: JSON.parse(options.payload) });
      const failure = url === primary ? failPrimary : failSecondary;
      if (failure === 'throw') throw Error('request failed ' + url);
      return { getResponseCode: () => failure || 200, getContentText: () => 'synthetic error' };
    } }
  });
  vm.runInContext(baseline ? original : current + '\n' + extension, context);
  context.getCustomerInfoFromBigQuery = () => {
    lookupCount++;
    return customerMissing ? null : { customerName: 'テスト顧客', staffName: 'テスト担当', storeName: '高松支社', vehicleName: 'テスト車両' };
  };
  const questions = vm.runInContext('QUESTIONS', context);
  const submit = answers => context.onFormSubmit({
    source: { getTitle: () => 'テスト納車後アンケート' },
    response: { getItemResponses: () => Object.entries(answers).map(([key, value]) => ({ getItem: () => ({ getTitle: () => questions[key] }), getResponse: () => value })) }
  });
  return { context, submit, sent, logs, lookupCount: () => lookupCount };
}

function answers(overrides = {}) {
  return { RESPONSE_ID: 'TEST-ONLY', VEHICLE_STATE: '満足', DELIVERY_DAY: '満足', FLOW: '満足', DIRECT_USE: 'いいえ', ...overrides };
}

test('Existing code is changed only by one additional call after primary send', () => {
  assert.equal(current.replace('    sendDeliveryMechanicNotification(baseSentiment, message);\n', ''), original);
});

test('All 27 satisfaction combinations preserve primary payload and route only red/yellow', () => {
  const values = ['満足', 'やや期待と異なっていた', '不満がある'];
  for (const vehicle of values) for (const day of values) for (const flow of values) {
    const input = answers({ VEHICLE_STATE: vehicle, DELIVERY_DAY: day, FLOW: flow });
    const old = runtime({ baseline: true }); const next = runtime();
    old.submit(input); next.submit(input);
    assert.deepEqual(next.sent[0], old.sent[0]);
    const target = [vehicle, day, flow].some(value => value !== '満足');
    assert.equal(next.sent.length, target ? 2 : 1);
    assert.equal(next.lookupCount(), 1, 'BigQuery is not queried twice');
    if (target) {
      assert.equal(next.sent[1].url, mechanic);
      assert.deepEqual(next.sent[1].payload.blocks.slice(1), old.sent[0].payload.blocks.slice(2));
      assert.equal(next.sent[1].payload.blocks[0].text.text, '<!channel>');
      assert.ok(next.sent[1].payload.text.startsWith('<!channel>\n'));
      assert.ok(!JSON.stringify(next.sent[1].payload).includes('<!subteam^'));
    }
  }
});

for (const [name, input] of [
  ['free text only', answers({ OTHER: '確認をお願いします' })],
  ['DIRECT negative only', answers({ DIRECT_USE: 'はい', DIRECT_GAP: '期待より悪かった', DIRECT_NEXT: '全くしたくない' })],
  ['low referral score only', answers({ NPS: '全くそう思わない' })],
  ['unanswered satisfaction', { RESPONSE_ID: 'TEST-ONLY', DIRECT_USE: 'いいえ' }]
]) test(name + ' does not trigger mechanic notification', () => {
  const r = runtime(); r.submit(input); assert.equal(r.sent.length, 1);
});

for (const [name, options] of [
  ['missing setting', { configured: false }],
  ['same primary URL', { secondary: primary }],
  ['invalid destination', { secondary: 'https://example.invalid/webhook' }],
  ['property failure', { propertyError: true }]
]) test(name + ' preserves existing send and skips additional send', () => {
  const old = runtime({ baseline: true }); const r = runtime(options);
  const input = answers({ FLOW: '不満がある' });
  old.submit(input); r.submit(input);
  assert.deepEqual(r.sent, old.sent);
  assert.ok(!JSON.stringify(r.logs).includes(mechanic));
});

for (const failure of [403, 429, 500, 'throw']) test('Secondary failure ' + failure + ' does not repeat or alter primary notification', () => {
  const old = runtime({ baseline: true }); const r = runtime({ failSecondary: failure });
  const input = answers({ VEHICLE_STATE: '不満がある' });
  old.submit(input); r.submit(input);
  assert.equal(r.sent.length, 2); assert.deepEqual(r.sent[0], old.sent[0]);
  assert.ok(r.logs.some(row => row[0] === 'error'));
  assert.ok(!JSON.stringify(r.logs).includes(mechanic));
});

for (const failure of [500, 'throw']) test('Primary send failure ' + failure + ' still permits additional send', () => {
  const r = runtime({ failPrimary: failure }); r.submit(answers({ FLOW: '不満がある' }));
  assert.equal(r.sent.length, 2); assert.equal(r.sent[1].url, mechanic);
});

test('Missing BigQuery customer record does not suppress mechanic notification', () => {
  const r = runtime({ customerMissing: true }); r.submit(answers({ DELIVERY_DAY: '不満がある' }));
  assert.equal(r.sent.length, 2); assert.match(r.sent[1].payload.text, /顧客名: 不明/);
});

test('Additional sender does not mutate the shared message', () => {
  const r = runtime(); const message = { text: 'synthetic', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'synthetic' } }] };
  const before = JSON.stringify(message);
  assert.equal(r.context.sendDeliveryMechanicNotification({ emoji: '🟡' }, message), 'sent');
  assert.equal(JSON.stringify(message), before);
});

test('Manual connection test sends one clearly labeled synthetic message only to mechanic channel', () => {
  const r = runtime();
  r.context.testDeliveryMechanicNotification();
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].url, mechanic);
  assert.equal(r.lookupCount(), 0);
  assert.match(r.sent[0].payload.text, /^<!channel>\n【動作確認・テスト】/);
  assert.match(r.sent[0].payload.text, /実際のお客様の回答ではありません/);
  const disabled = runtime({ configured: false });
  assert.throws(() => disabled.context.testDeliveryMechanicNotification(), /not_configured/);
  assert.equal(disabled.sent.length, 0);
});
