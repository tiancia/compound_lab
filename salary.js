(function (root, factory) {
  'use strict';
  var compound = typeof module === 'object' && module.exports ? require('./calculator.js') : root.CompoundCalculator;
  var planner = factory(compound);
  if (typeof module === 'object' && module.exports) module.exports = planner;
  if (root) root.SalaryPlanner = planner;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (compound) {
  'use strict';

  var DEFAULTS = Object.freeze({
    monthlyGross: 18000, annualBonus: 20000, bonusMode: 'separate',
    socialBase: 0, pensionRate: 8, medicalRate: 2, unemploymentRate: 0.5, socialFixed: 0,
    fundBase: 0, fundEmployeeRate: 7, fundEmployerRate: 7, specialDeduction: 1500,
    otherIncome: 0, salaryGrowth: 3, salaryYears: 30,
    livingMonthly: 5000, children: 0, childMonthly: 2000, childYears: 18,
    annualOtherExpense: 6000, emergencyMonths: 6, medicalReserve: 100000,
    shockCost: 0, shockYear: 5, fundBalance: 0, fundAnnualRate: 1.5, fundUnlockYear: 0,
    otherLocked: 0, otherUnlockYear: 0, initialCash: 0,
    investmentMode: 'surplus', investShare: 80, withdrawalRate: 3.5, startYear: 2026
  });
  var LABELS = {
    monthlyGross: '税前月薪', annualBonus: '税前年终奖', socialBase: '社保缴费基数',
    pensionRate: '个人养老费率', medicalRate: '个人医疗费率', unemploymentRate: '个人失业费率',
    socialFixed: '每月固定社保扣款', fundBase: '公积金缴费基数',
    fundEmployeeRate: '个人公积金比例', fundEmployerRate: '单位公积金比例',
    specialDeduction: '每月专项附加扣除', otherIncome: '每月其他税后收入', salaryGrowth: '工资年增长率',
    salaryYears: '领取工资年数', livingMonthly: '每月必要开支', children: '孩子人数',
    childMonthly: '每个孩子每月开支', childYears: '子女开支持续年数', annualOtherExpense: '年度其他开支',
    emergencyMonths: '应急储备月数', medicalReserve: '医疗储备', shockCost: '一次性突发开支',
    shockYear: '突发开支发生年', fundBalance: '已有公积金余额', fundAnnualRate: '公积金年利率',
    fundUnlockYear: '公积金提取年', otherLocked: '其他受限资产', otherUnlockYear: '其他资产解锁年',
    initialCash: '已有现金', investShare: '结余投资比例', withdrawalRate: '年提取率', startYear: '起始年份'
  };
  var DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  var ENUMS = { bonusMode: ['separate', 'combined'], investmentMode: ['surplus', 'planned'] };
  var BOUNDS = {
    pensionRate: [0, 100], medicalRate: [0, 100], unemploymentRate: [0, 100],
    fundEmployeeRate: [0, 12], fundEmployerRate: [0, 12], salaryGrowth: [-90, 50],
    salaryYears: [0, 80, true], children: [0, 10, true], childYears: [0, 80, true],
    emergencyMonths: [0, 120], shockYear: [1, 80, true], fundAnnualRate: [-90, 30],
    fundUnlockYear: [0, 80, true], otherUnlockYear: [0, 80, true], investShare: [0, 100],
    withdrawalRate: [0.1, 20], startYear: [2026, 2100, true]
  };
  var ANNUAL_BRACKETS = [36000, 144000, 300000, 420000, 660000, 960000];
  var MONTHLY_BRACKETS = [3000, 12000, 25000, 35000, 55000, 80000];
  var TAX_RATES = [0.03, 0.10, 0.20, 0.25, 0.30, 0.35, 0.45];
  var ANNUAL_DEDUCTIONS = [0, 2520, 16920, 31920, 52920, 85920, 181920];
  var BONUS_DEDUCTIONS = [0, 210, 1410, 2660, 4410, 7160, 15160];

  function plainObject(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('工资规划参数必须为普通对象。');
    }
    var prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('工资规划参数必须为普通对象。');
  }

  function number(value, key) {
    var result;
    if (typeof value === 'number') result = value;
    else if (typeof value === 'string' && DECIMAL.test(value.trim())) result = Number(value.trim());
    else throw new TypeError(LABELS[key] + '必须填写有效数字。');
    if (!Number.isFinite(result)) throw new TypeError(LABELS[key] + '必须是有限数字。');
    var bound = BOUNDS[key] || [0, 100000000];
    if (result < bound[0] || result > bound[1]) {
      throw new RangeError(LABELS[key] + '须在 ' + bound[0] + ' 至 ' + bound[1] + ' 之间。');
    }
    if (bound[2] && !Number.isInteger(result)) throw new RangeError(LABELS[key] + '必须为整数。');
    return result === 0 ? 0 : result;
  }

  function normalizeInputs(raw) {
    if (raw === undefined) raw = {};
    plainObject(raw);
    var inputs = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      var value = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : DEFAULTS[key];
      if (ENUMS[key]) {
        if (ENUMS[key].indexOf(value) === -1) throw new RangeError(key === 'bonusMode' ? '请选择有效的年终奖计税方式。' : '请选择有效的结余投资方式。');
        inputs[key] = value;
      } else inputs[key] = number(value, key);
    });
    if (inputs.pensionRate + inputs.medicalRate + inputs.unemploymentRate > 100) {
      throw new RangeError('个人养老、医疗和失业缴费比例之和不能超过 100%。');
    }
    return inputs;
  }

  function tierFor(amount, brackets) {
    var tier = 0;
    while (tier < brackets.length && amount > brackets[tier]) tier += 1;
    return tier;
  }

  function incomeFor(inputs, yearIndex) {
    var employed = yearIndex < inputs.salaryYears;
    var growth = Math.pow(1 + inputs.salaryGrowth / 100, yearIndex);
    var monthlyGross = employed ? inputs.monthlyGross * growth : 0;
    var salaryGross = monthlyGross * 12;
    var bonus = employed ? inputs.annualBonus * growth : 0;
    var social = employed ? ((inputs.socialBase || inputs.monthlyGross) * growth *
      (inputs.pensionRate + inputs.medicalRate + inputs.unemploymentRate) / 100 + inputs.socialFixed) * 12 : 0;
    var fundBase = employed ? (inputs.fundBase || inputs.monthlyGross) * growth : 0;
    var employeeFund = fundBase * inputs.fundEmployeeRate / 100 * 12;
    var employerFund = fundBase * inputs.fundEmployerRate / 100 * 12;
    // The separate annual-bonus concession has a published end date. Beyond
    // 2027 this projection falls back to comprehensive-income treatment.
    var effectiveBonusMode = inputs.bonusMode === 'separate' && inputs.startYear + yearIndex <= 2027 ? 'separate' : 'combined';
    var taxable = Math.max(0, salaryGross + (effectiveBonusMode === 'combined' ? bonus : 0) -
      60000 - social - employeeFund - inputs.specialDeduction * 12);
    var salaryTier = tierFor(taxable, ANNUAL_BRACKETS);
    var salaryTax = Math.max(0, taxable * TAX_RATES[salaryTier] - ANNUAL_DEDUCTIONS[salaryTier]);
    var bonusTier = tierFor(bonus / 12, MONTHLY_BRACKETS);
    var bonusTax = effectiveBonusMode === 'separate' ? Math.max(0, bonus * TAX_RATES[bonusTier] - BONUS_DEDUCTIONS[bonusTier]) : 0;
    var gross = salaryGross + bonus;
    var takeHome = gross - social - employeeFund - salaryTax - bonusTax;
    var otherIncome = inputs.otherIncome * 12;
    return {
      gross: gross, salaryGross: salaryGross, bonus: bonus, social: social,
      employeeFund: employeeFund, employerFund: employerFund, taxable: taxable,
      salaryTax: salaryTax, bonusTax: bonusTax, tax: salaryTax + bonusTax,
      takeHome: takeHome, monthlyTakeHome: takeHome / 12, otherIncome: otherIncome,
      availableIncome: takeHome + otherIncome, fundAdded: employeeFund + employerFund,
      effectiveBonusMode: effectiveBonusMode
    };
  }

  function annualIncome(raw, yearIndex) {
    var inputs = normalizeInputs(raw);
    if (yearIndex === undefined) yearIndex = 0;
    if (!Number.isInteger(yearIndex) || yearIndex < 0 || yearIndex > 80) throw new RangeError('收入年序号须为 0 至 80 之间的整数。');
    var result = incomeFor(inputs, yearIndex);
    finiteValues(result);
    return result;
  }

  function finiteValues(record) {
    Object.keys(record).forEach(function (key) {
      if (typeof record[key] === 'number' && !Number.isFinite(record[key])) throw new RangeError('计算结果超出可支持的数值范围。');
    });
  }

  function project(raw, investmentRaw) {
    var inputs = normalizeInputs(raw);
    var investment = compound.normalizeInputs(investmentRaw);
    var netAnnualRate = (1 + investment.annualRate / 100) * (1 - investment.annualFee / 100) - 1;
    var monthlyRate = Math.expm1(Math.log1p(netAnnualRate) / 12);
    var monthlyGrowth = 1 + monthlyRate;
    var inflationGrowth = 1 + investment.inflation / 100;
    var plannedAnnualInvestment = investment.frequency === 'daily' ? investment.daily * investment.tradingDays : investment.monthly * 12;
    var portfolio = investment.initial;
    var cash = inputs.initialCash;
    var fund = inputs.fundBalance;
    var otherLocked = inputs.otherLocked;
    var totalShortfall = 0;
    var firstShortfallYear = null;
    var firstFreedomYear = null;
    var years = [];

    function regularExpense(yearIndex) {
      var childExpense = yearIndex < inputs.childYears ? inputs.children * inputs.childMonthly * 12 : 0;
      return (inputs.livingMonthly * 12 + inputs.annualOtherExpense + childExpense) * Math.pow(inflationGrowth, yearIndex);
    }

    function withdraw(amount) {
      var fromCash = Math.min(cash, amount);
      cash -= fromCash;
      amount -= fromCash;
      var fromPortfolio = Math.min(portfolio, amount);
      portfolio -= fromPortfolio;
      return Math.max(0, amount - fromPortfolio);
    }

    function snapshot(year, annual, expense, surplus, invested, investmentGain, shock, shortfall) {
      // At the end of year Y, the target funds the next year's living costs.
      // All reserves use that same valuation date, in nominal yuan.
      var nextExpense = regularExpense(year);
      var inflationFactor = Math.pow(inflationGrowth, year);
      var shockReserve = year < inputs.shockYear ? inputs.shockCost * inflationFactor : 0;
      var reserve = nextExpense / 12 * inputs.emergencyMonths + inputs.medicalReserve * inflationFactor + shockReserve;
      var fiTarget = nextExpense / (inputs.withdrawalRate / 100);
      var target = fiTarget + reserve;
      var liquid = portfolio + cash;
      var freedom = liquid + Math.max(1e-8, target * 1e-12) >= target && totalShortfall <= 1e-8;
      if (freedom && firstFreedomYear === null) firstFreedomYear = year;
      var row = {
        year: year, calendarYear: inputs.startYear + year - 1,
        income: annual ? annual.availableIncome : 0, expense: expense, surplus: surplus,
        invested: invested, investmentGain: investmentGain, shock: shock,
        portfolio: portfolio, cash: cash, liquid: liquid, fund: fund,
        otherLocked: otherLocked, totalAssets: liquid + fund + otherLocked,
        reserve: reserve, target: target, fiCapital: Math.max(0, liquid - reserve),
        fiTarget: fiTarget, progress: target > 0 ? liquid / target : 1,
        freedom: freedom, shortfall: shortfall
      };
      finiteValues(row);
      years.push(row);
    }

    snapshot(0, null, 0, 0, 0, 0, 0, 0);
    for (var year = 1; year <= investment.years; year += 1) {
      var annual = incomeFor(inputs, year - 1);
      finiteValues(annual);
      var expense = regularExpense(year - 1);
      var surplus = annual.availableIncome - expense;
      var contribution = surplus > 0 ? (inputs.investmentMode === 'surplus' ?
        surplus * inputs.investShare / 100 : Math.min(surplus, plannedAnnualInvestment)) / 12 : 0;
      var invested = 0;
      var investmentGain = 0;
      var shortfall = 0;

      // This is a household budget, so monthly wages, annual bonuses and
      // trading-day contributions are smoothed across twelve monthly steps.
      for (var month = 0; month < 12; month += 1) {
        if (surplus < 0) shortfall += withdraw(-surplus / 12);
        else {
          cash += surplus / 12 - contribution;
          if (investment.timing === 'start') portfolio += contribution;
          invested += contribution;
        }
        var monthlyGain = portfolio * monthlyRate;
        investmentGain += monthlyGain;
        portfolio *= monthlyGrowth;
        if (surplus >= 0 && investment.timing === 'end') portfolio += contribution;
      }

      // Fund credits are assumed to arrive at year end; they are not added
      // to salary cash, and pension/social-insurance payments are not assets.
      fund = fund * (1 + inputs.fundAnnualRate / 100) + annual.fundAdded;
      if (inputs.fundUnlockYear > 0 && year >= inputs.fundUnlockYear) {
        cash += fund;
        fund = 0;
      }
      if (inputs.otherUnlockYear > 0 && year >= inputs.otherUnlockYear) {
        cash += otherLocked;
        otherLocked = 0;
      }
      var shock = year === inputs.shockYear ? inputs.shockCost * Math.pow(inflationGrowth, year - 1) : 0;
      shortfall += withdraw(shock);
      // A gap is unfunded spending, not an assumed loan. We do not invent
      // financing or a debt repayment schedule and cannot certify FI after it.
      totalShortfall += shortfall;
      if (shortfall > 1e-8 && firstShortfallYear === null) firstShortfallYear = year;
      snapshot(year, annual, expense, surplus, invested, investmentGain, shock, shortfall);
    }

    var sustainableFreedomYear = null;
    for (var index = years.length - 1; index >= 0; index -= 1) {
      if (!years[index].freedom) break;
      sustainableFreedomYear = years[index].year;
    }
    var income = incomeFor(inputs, 0);
    return {
      inputs: inputs, investment: investment, income: income,
      annualExpense: regularExpense(0), annualSurplus: income.availableIncome - regularExpense(0),
      currentTarget: years[0].target, currentProgress: years[0].progress,
      firstFreedomYear: firstFreedomYear, sustainableFreedomYear: sustainableFreedomYear,
      firstShortfallYear: firstShortfallYear, totalShortfall: totalShortfall,
      netAnnualRate: netAnnualRate, monthlyRate: monthlyRate,
      plannedAnnualInvestment: plannedAnnualInvestment, years: years, final: years[years.length - 1]
    };
  }

  return Object.freeze({ DEFAULTS: DEFAULTS, normalizeInputs: normalizeInputs, annualIncome: annualIncome, project: project });
});
