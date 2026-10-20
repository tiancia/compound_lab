'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const calculator = require('./calculator.js');

function close(actual, expected, message) {
  const tolerance = Math.max(1e-8, Math.abs(expected) * 1e-11);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message || 'Values differ'}: actual ${actual}, expected ${expected}`);
}

test('a lump sum compounds at the effective annual rate', () => {
  const result = calculator.project({ initial: 100000, monthly: 0, years: 20, annualRate: 10, annualFee: 0 });
  close(result.finalBalance, 100000 * 1.1 ** 20);
  assert.equal(result.years.length, 21);
  assert.deepEqual(result.years[0], { year: 0, contributed: 100000, balance: 100000, gain: 0, realBalance: 100000 });
  close(result.years[10].balance, 100000 * 1.1 ** 10);
  close(result.totalGain, result.finalBalance - result.totalContributed);
});

test('zero returns preserve the exact sum of initial and monthly contributions', () => {
  for (const timing of ['start', 'end']) {
    const result = calculator.project({ initial: 1200, monthly: 150, years: 3, annualRate: 0, annualFee: 0, inflation: 0, timing });
    assert.equal(result.monthlyRate, 0);
    assert.equal(result.finalBalance, 6600);
    assert.equal(result.totalContributed, 6600);
    assert.equal(result.totalGain, 0);
    assert.equal(result.realFinalBalance, 6600);
  }
  assert.equal(calculator.project({ initial: 0, monthly: 0 }).finalBalance, 0);
});

test('zero-return trading-day deposits accumulate exactly in every annual snapshot', () => {
  for (const timing of ['start', 'end']) {
    const result = calculator.project({ initial: 1200, monthly: 99999, daily: 150, frequency: 'daily', tradingDays: 252,
      years: 3, annualRate: 0, annualFee: 0, inflation: 0, timing });
    assert.equal(result.periodRate, 0);
    assert.equal(result.periodsPerYear, 252);
    assert.equal(result.totalPeriods, 756);
    assert.equal(result.finalBalance, 114600);
    assert.equal(result.totalContributed, 114600);
    assert.equal(result.totalGain, 0);
    assert.equal(result.realFinalBalance, 114600);
    assert.equal(result.years.length, 4);
    for (const point of result.years) {
      assert.equal(point.contributed, 1200 + 150 * 252 * point.year);
      assert.equal(point.balance, point.contributed);
    }
  }
});

test('negative returns remain negative and reduce invested assets', () => {
  const result = calculator.project({ initial: 100000, monthly: 0, years: 2, annualRate: -25, annualFee: 0 });
  close(result.finalBalance, 56250);
  assert.ok(result.monthlyRate < 0);
  close(result.totalGain, -43750);
  const minimum = calculator.project({ annualRate: -90, annualFee: 5, years: 80 });
  assert.ok(Number.isFinite(minimum.finalBalance));
  assert.ok(minimum.finalBalance >= 0);
});

test('annual fees reduce growth multiplicatively', () => {
  const result = calculator.project({ initial: 100000, monthly: 0, years: 1, annualRate: 10, annualFee: 0.5 });
  close(result.netAnnualRate, 0.0945);
  close(result.finalBalance, 109450);
  close((1 + result.monthlyRate) ** 12, 1.0945);
  const declining = calculator.project({ initial: 100000, monthly: 0, years: 1, annualRate: 0, annualFee: 1 });
  close(declining.finalBalance, 99000);
});

test('monthly deposits match an independent closed form for both deposit timings', () => {
  for (const annualRate of [-20, 0.000001, 6, 14.25, 50]) {
    for (const timing of ['end', 'start']) {
      const inputs = { initial: 12345.67, monthly: 789.12, years: 17, annualRate, annualFee: 0.35, timing };
      const result = calculator.project(inputs);
      const annualGrowth = (1 + annualRate / 100) * (1 - inputs.annualFee / 100);
      const rate = annualGrowth ** (1 / 12) - 1;
      const months = inputs.years * 12;
      const growth = (1 + rate) ** months;
      const annuity = inputs.monthly * (growth - 1) / rate * (timing === 'start' ? 1 + rate : 1);
      close(result.finalBalance, inputs.initial * growth + annuity);
      assert.equal(result.totalContributed, inputs.initial + inputs.monthly * months);
    }
  }
});

test('trading-day deposits match the annuity formula for gains, losses, and both timings', () => {
  for (const annualRate of [-20, 6, 14.25, 50]) {
    for (const tradingDays of [1, 252, 366]) {
      for (const timing of ['end', 'start']) {
        const inputs = { initial: 12345.67, monthly: 99999, daily: 78.91, frequency: 'daily', tradingDays,
          years: 17, annualRate, annualFee: 0.35, timing };
        const result = calculator.project(inputs);
        const annualGrowth = (1 + annualRate / 100) * (1 - inputs.annualFee / 100);
        const rate = annualGrowth ** (1 / tradingDays) - 1;
        const growth = annualGrowth ** inputs.years;
        const annuity = inputs.daily * (growth - 1) / rate * (timing === 'start' ? 1 + rate : 1);
        close(result.finalBalance, inputs.initial * growth + annuity);
        close(result.periodRate, rate);
        assert.equal(result.totalContributed, inputs.initial + inputs.daily * tradingDays * inputs.years);
        assert.equal(result.totalPeriods, tradingDays * inputs.years);
      }
    }
  }
});

test('lump-sum annual growth and fees agree across monthly and trading-day frequencies', () => {
  for (const annualRate of [-25, 0, 10, 50]) {
    const inputs = { initial: 100000, monthly: 0, daily: 0, years: 20, annualRate, annualFee: 0.5 };
    const monthly = calculator.project(inputs);
    assert.equal(monthly.periodsPerYear, 12);
    assert.equal(monthly.totalPeriods, 240);
    assert.equal(monthly.periodRate, monthly.monthlyRate);
    for (const tradingDays of [1, 12, 252, 366]) {
      const daily = calculator.project({ ...inputs, frequency: 'daily', tradingDays });
      close(daily.finalBalance, monthly.finalBalance);
      assert.equal(daily.monthlyRate, monthly.monthlyRate);
      close((1 + daily.periodRate) ** tradingDays, 1 + daily.netAnnualRate);
      for (let year = 0; year <= inputs.years; year += 1) {
        close(daily.years[year].balance, inputs.initial * (1 + daily.netAnnualRate) ** year);
      }
    }
  }
});

test('80-year monthly and trading-day projections match the annuity formula', () => {
  for (const frequency of ['monthly', 'daily']) {
    for (const timing of ['end', 'start']) {
      const inputs = { initial: 100000, monthly: 2000, daily: 100, frequency, tradingDays: 252,
        years: 80, annualRate: 10, annualFee: 0.5, timing };
      const result = calculator.project(inputs);
      const periodsPerYear = frequency === 'daily' ? inputs.tradingDays : 12;
      const contribution = frequency === 'daily' ? inputs.daily : inputs.monthly;
      const annualGrowth = (1 + inputs.annualRate / 100) * (1 - inputs.annualFee / 100);
      const rate = annualGrowth ** (1 / periodsPerYear) - 1;
      const growth = annualGrowth ** inputs.years;
      const annuity = contribution * (growth - 1) / rate * (timing === 'start' ? 1 + rate : 1);
      close(result.finalBalance, inputs.initial * growth + annuity);
      assert.equal(result.totalPeriods, periodsPerYear * 80);
      assert.equal(result.totalContributed, inputs.initial + contribution * periodsPerYear * 80);
      assert.equal(result.years.length, 81);
      assert.equal(result.years[80].year, 80);
      close(result.years[80].balance, result.finalBalance);
      close(result.totalGain, result.finalBalance - result.totalContributed);
    }
  }
});

test('month-start contributions receive one more month of growth', () => {
  const inputs = { initial: 0, monthly: 1000, years: 1, annualRate: 12, annualFee: 0 };
  const end = calculator.project({ ...inputs, timing: 'end' });
  const start = calculator.project({ ...inputs, timing: 'start' });
  close(start.finalBalance, end.finalBalance * (1 + end.monthlyRate));
  assert.ok(start.finalBalance > end.finalBalance);
  const negativeEnd = calculator.project({ ...inputs, annualRate: -12, timing: 'end' });
  const negativeStart = calculator.project({ ...inputs, annualRate: -12, timing: 'start' });
  assert.ok(negativeStart.finalBalance < negativeEnd.finalBalance);
});

test('inflation adjusts every annual snapshot to present purchasing power', () => {
  const result = calculator.project({ initial: 100000, monthly: 1000, years: 10, inflation: 3 });
  for (const point of result.years) {
    close(point.realBalance, point.balance / 1.03 ** point.year);
  }
  close(result.realFinalBalance, result.finalBalance / 1.03 ** 10);
  assert.ok(result.realFinalBalance < result.finalBalance);
});

test('normalization applies omitted defaults without mutating callers', () => {
  assert.deepEqual(calculator.normalizeInputs(), calculator.DEFAULTS);
  const raw = { initial: ' 123.45 ', monthly: '.5', years: '12', annualRate: '-2.5', annualFee: '0', inflation: '2e0', timing: 'start' };
  const normalized = calculator.normalizeInputs(raw);
  assert.deepEqual(normalized, { initial: 123.45, monthly: 0.5, daily: 100, frequency: 'monthly', tradingDays: 252,
    years: 12, annualRate: -2.5, annualFee: 0, inflation: 2, timing: 'start' });
  assert.equal(raw.initial, ' 123.45 ');
  assert.ok(Object.isFrozen(calculator.DEFAULTS));
});

test('monthly and trading-day amounts are preserved independently and old inputs stay monthly', () => {
  const raw = { initial: 1000, monthly: 200, daily: 30, tradingDays: 250, years: 2, annualRate: 8, annualFee: 0.2, timing: 'start' };
  const monthly = calculator.project(raw);
  const daily = calculator.project({ ...raw, frequency: 'daily' });
  assert.equal(monthly.inputs.frequency, 'monthly');
  assert.equal(monthly.inputs.monthly, 200);
  assert.equal(monthly.inputs.daily, 30);
  assert.equal(daily.inputs.monthly, 200);
  assert.equal(daily.inputs.daily, 30);
  assert.equal(monthly.totalContributed, 5800);
  assert.equal(daily.totalContributed, 16000);
  assert.deepEqual(calculator.project({ ...raw, frequency: 'monthly' }), monthly);
  assert.deepEqual(calculator.project({ ...raw, daily: 999, tradingDays: 1 }).years, monthly.years);
  const oldInputs = { initial: 1000, monthly: 200, years: 2, annualRate: 8, annualFee: 0.2, timing: 'start' };
  assert.deepEqual(calculator.project(oldInputs).years, monthly.years);
  assert.equal(raw.frequency, undefined);
});

test('blank, coercible objects, nonfinite values, and numeric overflow are rejected', () => {
  for (const value of ['', ' ', null, undefined, false, true, [], [10], {}, { valueOf: () => 10 }, NaN, Infinity, -Infinity, 'Infinity', '1e309', '0x10', '0b10', '1_000', '1,000']) {
    assert.throws(() => calculator.normalizeInputs({ initial: value }), undefined, `Unexpectedly accepted ${String(value)}`);
  }
  for (const raw of [null, [], '100', 100, false, new Date(), new Map(), new Set()]) {
    assert.throws(() => calculator.normalizeInputs(raw));
  }
});

test('each supported range and integer year constraint is enforced', () => {
  for (const [key, values] of Object.entries({
    initial: [-0.01, 100000001], monthly: [-1, 100000001], daily: [-1, 100000001],
    tradingDays: [0, 367, 251.5], years: [0, 81, 2.5],
    annualRate: [-90.01, 50.01], annualFee: [-0.01, 5.01], inflation: [-0.01, 20.01]
  })) {
    for (const value of values) assert.throws(() => calculator.normalizeInputs({ [key]: value }), RangeError);
  }
  for (const timing of ['', 'middle', null, 0]) assert.throws(() => calculator.normalizeInputs({ timing }));
  for (const frequency of ['', 'weekly', null, 0, undefined]) assert.throws(() => calculator.normalizeInputs({ frequency }), RangeError);
  for (const tradingDays of ['', ' ', null, undefined, NaN, Infinity, '0x10', []]) {
    assert.throws(() => calculator.normalizeInputs({ tradingDays }));
  }
  assert.equal(calculator.normalizeInputs({ tradingDays: '252', daily: '12.5', frequency: 'daily' }).tradingDays, 252);
  const upper = calculator.project({ initial: 1e8, monthly: 1e8, years: 80, annualRate: 50, annualFee: 0, inflation: 20 });
  assert.ok(Number.isFinite(upper.finalBalance));
});

test('comparison uses independent rates and does not mutate input or rate arrays', () => {
  const raw = { initial: 1000, monthly: 0, years: 1, annualRate: 8, annualFee: 0 };
  const rates = [6, 10, 14.25];
  const results = calculator.compare(raw, rates);
  assert.deepEqual(results.map(result => result.annualRate), rates);
  assert.deepEqual(results.map(result => result.inputs.annualRate), rates);
  close(results[0].finalBalance, 1060);
  close(results[1].finalBalance, 1100);
  close(results[2].finalBalance, 1142.5);
  assert.equal(raw.annualRate, 8);
  assert.deepEqual(rates, [6, 10, 14.25]);
  assert.deepEqual(calculator.compare(raw).map(result => result.annualRate), rates);
  assert.throws(() => calculator.compare(raw, []));
  assert.throws(() => calculator.compare(raw, [undefined]));
  assert.throws(() => calculator.compare(raw, new Array(2)));
  assert.throws(() => calculator.project(raw, 100));
});

test('classic script exposes a browser global without requiring a module loader', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('./calculator.js'), 'utf8'), context);
  assert.equal(typeof context.CompoundCalculator.project, 'function');
  const result = vm.runInContext('CompoundCalculator.project({ initial: 1000, monthly: 0, years: 1, annualRate: 10, annualFee: 0 })', context);
  close(result.finalBalance, 1100);
});
