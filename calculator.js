(function (root, factory) {
  'use strict';

  var calculator = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = calculator;
  }
  if (root) {
    root.CompoundCalculator = calculator;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = Object.freeze({
    initial: 100000,
    monthly: 2000,
    daily: 100,
    frequency: 'monthly',
    tradingDays: 252,
    years: 20,
    annualRate: 10,
    annualFee: 0.5,
    inflation: 2,
    timing: 'end'
  });

  var RULES = {
    initial: { min: 0, max: 100000000, label: '初始投资' },
    monthly: { min: 0, max: 100000000, label: '每月定投' },
    daily: { min: 0, max: 100000000, label: '每个交易日定投' },
    tradingDays: { min: 1, max: 366, integer: true, label: '每年交易日' },
    years: { min: 1, max: 80, integer: true, label: '投资年限' },
    annualRate: { min: -90, max: 50, label: '年化收益率' },
    annualFee: { min: 0, max: 5, label: '年度费用率' },
    inflation: { min: 0, max: 20, label: '年通胀率' }
  };

  // Accept ordinary decimal form (including an exponent), never coercible
  // objects, booleans, hexadecimal text, or an empty input field.
  var DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

  function numericValue(value, key) {
    var rule = RULES[key];
    var number;
    if (typeof value === 'number') {
      number = value;
    } else if (typeof value === 'string' && DECIMAL.test(value.trim())) {
      number = Number(value.trim());
    } else {
      throw new TypeError(rule.label + '必须填写有效数字。');
    }
    if (!Number.isFinite(number)) {
      throw new TypeError(rule.label + '必须是有限数字。');
    }
    if (number < rule.min || number > rule.max) {
      throw new RangeError(rule.label + '须在 ' + rule.min + ' 至 ' + rule.max + ' 之间。');
    }
    if (rule.integer && !Number.isInteger(number)) {
      throw new RangeError(rule.label + '必须为整数。');
    }
    // Avoid exporting negative zero, which is inconvenient to format.
    return number === 0 ? 0 : number;
  }

  function normalizeInputs(raw) {
    if (raw === undefined) {
      raw = {};
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('投资参数必须为对象。');
    }
    var prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('投资参数必须为普通对象。');
    }
    var inputs = {};
    Object.keys(RULES).forEach(function (key) {
      var value = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : DEFAULTS[key];
      inputs[key] = numericValue(value, key);
    });
    inputs.frequency = Object.prototype.hasOwnProperty.call(raw, 'frequency') ? raw.frequency : DEFAULTS.frequency;
    if (inputs.frequency !== 'monthly' && inputs.frequency !== 'daily') {
      throw new RangeError('定投频率须为按月或按交易日。');
    }
    inputs.timing = Object.prototype.hasOwnProperty.call(raw, 'timing') ? raw.timing : DEFAULTS.timing;
    if (inputs.timing !== 'start' && inputs.timing !== 'end') {
      throw new RangeError('定投时点须为期初或期末。');
    }
    return inputs;
  }

  function project(raw, rateOverride) {
    var inputs = normalizeInputs(raw);
    if (rateOverride !== undefined) {
      inputs.annualRate = numericValue(rateOverride, 'annualRate');
    }
    var annualRate = inputs.annualRate;
    // Fees reduce assets multiplicatively at the annual rate. Convert the
    // resulting effective annual growth into an equivalent per-period rate.
    var netAnnualRate = (1 + annualRate / 100) * (1 - inputs.annualFee / 100) - 1;
    var monthlyRate = Math.expm1(Math.log1p(netAnnualRate) / 12);
    // Daily mode spreads the selected number of trading days evenly over
    // each year; it does not model an exchange's actual trading calendar.
    var periodsPerYear = inputs.frequency === 'daily' ? inputs.tradingDays : 12;
    var contribution = inputs.frequency === 'daily' ? inputs.daily : inputs.monthly;
    var periodRate = periodsPerYear === 12 ? monthlyRate : Math.expm1(Math.log1p(netAnnualRate) / periodsPerYear);
    var periodGrowth = 1 + periodRate;
    var totalPeriods = inputs.years * periodsPerYear;
    var balance = inputs.initial;
    var years = [{
      year: 0,
      contributed: inputs.initial,
      balance: balance,
      gain: 0,
      annualGain: 0,
      realBalance: balance
    }];

    for (var period = 1; period <= totalPeriods; period += 1) {
      if (inputs.timing === 'start') {
        balance = (balance + contribution) * periodGrowth;
      } else {
        balance = balance * periodGrowth + contribution;
      }
      if (!Number.isFinite(balance)) {
        throw new RangeError('计算结果超出可支持的数值范围。');
      }
      if (period % periodsPerYear === 0) {
        var year = period / periodsPerYear;
        var contributed = inputs.initial + contribution * period;
        var gain = balance - contributed;
        years.push({
          year: year,
          contributed: contributed,
          balance: balance,
          gain: gain,
          annualGain: gain - years[years.length - 1].gain,
          realBalance: balance / Math.pow(1 + inputs.inflation / 100, year)
        });
      }
    }

    var lastYear = years[years.length - 1];
    return {
      inputs: inputs,
      annualRate: annualRate,
      netAnnualRate: netAnnualRate,
      monthlyRate: monthlyRate,
      periodRate: periodRate,
      periodsPerYear: periodsPerYear,
      totalPeriods: totalPeriods,
      totalContributed: lastYear.contributed,
      finalBalance: lastYear.balance,
      totalGain: lastYear.gain,
      realFinalBalance: lastYear.realBalance,
      years: years
    };
  }

  function compare(raw, rates) {
    var inputs = normalizeInputs(raw);
    if (rates === undefined) {
      rates = [6, 10, 14.25];
    }
    if (!Array.isArray(rates) || rates.length === 0) {
      throw new TypeError('对比收益率必须为非空数组。');
    }
    return Array.from(rates, function (rate) {
      // Explicit undefined is invalid in a scenario array, even though an
      // omitted override is valid when calling project directly.
      return project(inputs, numericValue(rate, 'annualRate'));
    });
  }

  return Object.freeze({
    DEFAULTS: DEFAULTS,
    normalizeInputs: normalizeInputs,
    project: project,
    compare: compare
  });
});
