'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const planner = require('./salary.js');
const compound = require('./calculator.js');

function close(actual, expected, message = 'Values differ') {
  const tolerance = Math.max(1e-8, Math.abs(expected) * 1e-10);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
}

const clean = {
  monthlyGross: 0, annualBonus: 0, socialBase: 0, pensionRate: 0,
  medicalRate: 0, unemploymentRate: 0, socialFixed: 0,
  fundEmployeeRate: 0, fundEmployerRate: 0, specialDeduction: 0,
  salaryGrowth: 0, livingMonthly: 0, annualOtherExpense: 0,
  emergencyMonths: 0, medicalReserve: 0, shockCost: 0, initialCash: 0,
  fundAnnualRate: 0
};
const flat = { initial: 0, monthly: 0, years: 3, annualRate: 0, annualFee: 0, inflation: 0 };

test('default annual pay reconciles gross, tax, personal deductions and fund credits', () => {
  const income = planner.annualIncome();
  close(income.gross, 236000);
  close(income.social, 22680);
  close(income.employeeFund, 15120);
  close(income.employerFund, 15120);
  close(income.taxable, 100200);
  close(income.salaryTax, 7500);
  close(income.bonusTax, 600);
  close(income.takeHome, 190100);
  close(income.monthlyTakeHome * 12, income.takeHome);
  close(income.takeHome + income.social + income.employeeFund + income.tax, income.gross);
  close(income.fundAdded, income.employeeFund + income.employerFund);
});

test('comprehensive tax follows the official annual brackets at and around every boundary', () => {
  const brackets = [0, 36000, 144000, 300000, 420000, 660000, 960000];
  const rates = [.03, .10, .20, .25, .30, .35, .45];
  const deductions = [0, 2520, 16920, 31920, 52920, 85920, 181920];
  for (let tier = 0; tier < brackets.length; tier += 1) {
    const amounts = tier === 0 ? [0, 1, 35999.99] : [brackets[tier] + .01];
    for (const taxable of amounts) {
      const income = planner.annualIncome({ ...clean, monthlyGross: (taxable + 60000) / 12 });
      close(income.taxable, taxable);
      close(income.tax, taxable * rates[tier] - deductions[tier]);
    }
  }
  for (let index = 1; index < brackets.length; index += 1) {
    const taxable = brackets[index];
    const income = planner.annualIncome({ ...clean, monthlyGross: (taxable + 60000) / 12 });
    close(income.tax, taxable * rates[index - 1] - deductions[index - 1]);
  }
});

test('basic and special deductions never create a tax credit or duplicate a child deduction', () => {
  const income = planner.annualIncome({ ...clean, monthlyGross: 4000, specialDeduction: 2000, children: 2 });
  assert.equal(income.taxable, 0);
  assert.equal(income.tax, 0);
  assert.equal(income.takeHome, 48000);
  const withChildren = planner.annualIncome({ ...clean, monthlyGross: 20000, specialDeduction: 2000, children: 2 });
  const withoutChildren = planner.annualIncome({ ...clean, monthlyGross: 20000, specialDeduction: 2000, children: 0 });
  assert.equal(withChildren.tax, withoutChildren.tax);
});

test('separate bonus tax uses the monthly bracket and preserves its tax cliffs', () => {
  assert.equal(planner.annualIncome({ ...clean, annualBonus: 36000 }).bonusTax, 1080);
  close(planner.annualIncome({ ...clean, annualBonus: 36000.01 }).bonusTax, 3390.001);
  const values = [144000, 300000, 420000, 660000, 960000, 1000000];
  const rates = [.1, .2, .25, .3, .35, .45];
  const quick = [210, 1410, 2660, 4410, 7160, 15160];
  values.forEach((bonus, index) => {
    close(planner.annualIncome({ ...clean, annualBonus: bonus }).bonusTax, bonus * rates[index] - quick[index]);
  });
});

test('separate bonus policy expires after calendar 2027 in a multi-year projection', () => {
  const salary = { ...clean, monthlyGross: 10000, annualBonus: 36000, salaryYears: 80 };
  assert.equal(planner.annualIncome(salary, 0).effectiveBonusMode, 'separate');
  assert.equal(planner.annualIncome(salary, 1).effectiveBonusMode, 'separate');
  const expired = planner.annualIncome(salary, 2);
  assert.equal(expired.effectiveBonusMode, 'combined');
  assert.equal(expired.bonusTax, 0);
  close(expired.tax, planner.annualIncome({ ...salary, bonusMode: 'combined' }, 2).tax);
  close(expired.taxable, 96000);
});

test('explicit social and fund bases grow with wages; fixed monthly social payments stay fixed', () => {
  const salary = { ...clean, monthlyGross: 10000, socialBase: 6000, fundBase: 8000,
    pensionRate: 8, medicalRate: 2, unemploymentRate: .5, socialFixed: 3,
    fundEmployeeRate: 7, fundEmployerRate: 9, salaryGrowth: 10 };
  const income = planner.annualIncome(salary, 1);
  close(income.salaryGross, 132000);
  close(income.social, (6600 * .105 + 3) * 12);
  close(income.employeeFund, 8800 * .07 * 12);
  close(income.employerFund, 8800 * .09 * 12);
});

test('salary stop removes future payroll deductions while other after-tax income continues', () => {
  const salary = { ...planner.DEFAULTS, salaryYears: 1, otherIncome: 1000 };
  const income = planner.annualIncome(salary, 1);
  for (const key of ['gross', 'social', 'employeeFund', 'employerFund', 'tax', 'takeHome', 'fundAdded']) assert.equal(income[key], 0);
  assert.equal(income.availableIncome, 12000);
});

test('real deductions above wages remain a visible cash expense', () => {
  const income = planner.annualIncome({ ...clean, monthlyGross: 0, socialBase: 1000, pensionRate: 8 });
  assert.equal(income.takeHome, -960);
  assert.equal(income.tax, 0);
  const result = planner.project({ ...clean, monthlyGross: 0, socialBase: 1000, pensionRate: 8 }, flat);
  close(result.totalShortfall, 2880);
});

test('initial assets are counted once and restricted assets do not fund financial independence', () => {
  const result = planner.project({ ...clean, initialCash: 500, fundBalance: 1000, otherLocked: 2000,
    livingMonthly: 10, withdrawalRate: 10 }, { ...flat, initial: 700 });
  assert.equal(result.years[0].liquid, 1200);
  assert.equal(result.years[0].totalAssets, 4200);
  assert.equal(result.currentTarget, 1200);
  assert.equal(result.firstFreedomYear, 0);
  const restricted = planner.project({ ...clean, fundBalance: 1000000, livingMonthly: 10 }, flat);
  assert.equal(restricted.years[0].freedom, false);
  assert.equal(restricted.firstFreedomYear, null);
});

test('income cash and employer fund credits reconcile without adding wages and deposits twice', () => {
  const salary = { ...clean, monthlyGross: 5000, fundEmployeeRate: 7, fundEmployerRate: 7,
    investShare: 50, livingMonthly: 1000 };
  const result = planner.project(salary, { ...flat, years: 1 });
  const row = result.final;
  close(result.income.takeHome, 55800);
  close(row.surplus, 43800);
  close(row.portfolio, 21900);
  close(row.cash, 21900);
  close(row.fund, 8400);
  close(row.totalAssets, 52200);
  close(row.totalAssets, 60000 - 12000 + 4200);
});

test('planned investment matches the existing monthly annuity and parks the remaining budget in cash', () => {
  for (const timing of ['start', 'end']) {
    const investment = { ...flat, initial: 1234, monthly: 1000, annualRate: 6.5, timing };
    const result = planner.project({ ...clean, monthlyGross: 5000, investmentMode: 'planned' }, investment);
    close(result.final.portfolio, compound.project(investment).finalBalance);
    close(result.final.cash, 48000 * 3);
    close(result.final.totalAssets, result.final.cash + result.final.portfolio);
  }
});

test('trading-day budgets are smoothed monthly in the wage plan and never added to income a second time', () => {
  const investment = { ...flat, frequency: 'daily', daily: 50, tradingDays: 252, annualRate: 6 };
  const result = planner.project({ ...clean, monthlyGross: 5000, investmentMode: 'planned' }, investment);
  const monthly = compound.project({ ...investment, frequency: 'monthly', monthly: 1050 });
  close(result.final.portfolio, monthly.finalBalance);
  close(result.final.cash, (60000 - 12600) * 3);
  assert.equal(result.plannedAnnualInvestment, 12600);
});

test('planned contributions are capped by free annual income and cannot invent external deposits', () => {
  const result = planner.project({ ...clean, monthlyGross: 5000, livingMonthly: 4500, investmentMode: 'planned' },
    { ...flat, monthly: 2000 });
  close(result.final.portfolio, 18000);
  close(result.final.cash, 0);
  close(result.final.invested, 6000);
});

test('income deficits spend existing cash before portfolio and report unfunded expenses', () => {
  const result = planner.project({ ...clean, livingMonthly: 100, initialCash: 500 }, { ...flat, initial: 1000 });
  close(result.years[1].cash, 0);
  close(result.years[1].portfolio, 300);
  close(result.years[2].shortfall, 900);
  close(result.totalShortfall, 2100);
  assert.equal(result.firstShortfallYear, 2);
  assert.equal(result.final.liquid, 0);
  assert.equal(result.final.freedom, false);
  for (const row of result.years) {
    assert.ok(row.cash >= 0);
    assert.ok(row.portfolio >= 0);
  }
});

test('cashflow shortfalls do not become silently financed income in later years', () => {
  const result = planner.project({ ...clean, livingMonthly: 100, shockCost: 100000, shockYear: 1,
    monthlyGross: 5000, salaryGrowth: 50 }, { ...flat, years: 10 });
  assert.ok(result.totalShortfall > 0);
  assert.ok(result.final.liquid > result.final.target);
  assert.equal(result.firstFreedomYear, null);
  assert.equal(result.sustainableFreedomYear, null);
});

test('children cost money for exactly childYears years without changing their parents tax deduction', () => {
  const result = planner.project({ ...clean, children: 2, childMonthly: 1000, childYears: 2,
    initialCash: 100000 }, flat);
  assert.equal(result.annualExpense, 24000);
  assert.equal(result.years[1].expense, 24000);
  assert.equal(result.years[2].expense, 24000);
  assert.equal(result.years[3].expense, 0);
  assert.equal(result.years[1].fiTarget, 24000 / .035);
  assert.equal(result.years[2].fiTarget, 0);
  assert.equal(result.final.cash, 52000);
});

test('the FI threshold includes annual expenses, emergency cash, medical reserves and pending shock', () => {
  const result = planner.project({ ...clean, livingMonthly: 1000, annualOtherExpense: 1200,
    emergencyMonths: 6, medicalReserve: 10000, shockCost: 20000, shockYear: 2,
    withdrawalRate: 4, initialCash: 100000 }, { ...flat, inflation: 10 });
  close(result.currentTarget, 13200 / .04 + 6600 + 10000 + 20000);
  close(result.years[1].target, (13200 / .04 + 6600 + 10000 + 20000) * 1.1);
  close(result.years[2].reserve, (6600 + 10000) * 1.1 ** 2);
  close(result.years[2].shock, 22000);
  close(result.years[2].fiCapital, Math.max(0, result.years[2].liquid - result.years[2].reserve));
});

test('fund and other restricted assets unlock once, retaining the total asset identity', () => {
  const result = planner.project({ ...clean, fundBalance: 10000, otherLocked: 5000,
    fundUnlockYear: 2, otherUnlockYear: 2 }, flat);
  assert.equal(result.years[1].liquid, 0);
  assert.equal(result.years[1].totalAssets, 15000);
  assert.equal(result.years[2].cash, 15000);
  assert.equal(result.years[2].fund, 0);
  assert.equal(result.years[2].otherLocked, 0);
  assert.equal(result.final.cash, 15000);
  assert.equal(result.final.totalAssets, 15000);
});

test('after the assumed unlock, new fund credits transfer to cash without double counting', () => {
  const result = planner.project({ ...clean, monthlyGross: 5000, investShare: 0,
    fundEmployeeRate: 7, fundEmployerRate: 7, fundUnlockYear: 1 }, flat);
  close(result.years[1].cash, 64200);
  close(result.final.cash, 64200 * 3);
  assert.equal(result.final.fund, 0);
});

test('fund return accrues separately from investment return and is not spendable before unlocking', () => {
  const result = planner.project({ ...clean, fundBalance: 10000, fundAnnualRate: 1.5 }, { ...flat, annualRate: 10 });
  close(result.final.fund, 10000 * 1.015 ** 3);
  assert.equal(result.final.liquid, 0);
});

test('year-end released assets can cover a shock at the same year end', () => {
  const result = planner.project({ ...clean, fundBalance: 10000, fundUnlockYear: 1,
    shockCost: 5000, shockYear: 1 }, flat);
  assert.equal(result.totalShortfall, 0);
  assert.equal(result.final.cash, 5000);
});

test('a temporary FI crossing is distinguished from a threshold maintained to the projection end', () => {
  const result = planner.project({ ...clean, initialCash: 130000, livingMonthly: 1000,
    withdrawalRate: 10 }, { ...flat, years: 3 });
  assert.equal(result.firstFreedomYear, 0);
  assert.equal(result.sustainableFreedomYear, null);
  assert.equal(result.years[0].freedom, true);
  assert.equal(result.years[1].freedom, false);
});

test('every annual asset balance reconciles income, spending, fund credits, returns and uncovered expenses', () => {
  for (const annualRate of [-30, 0, 8]) {
    const salary = { ...planner.DEFAULTS, initialCash: 20000, fundBalance: 30000,
      otherLocked: 25000, fundUnlockYear: 4, otherUnlockYear: 6,
      children: 2, childYears: 4, livingMonthly: 12000, salaryYears: 5,
      shockCost: 150000, shockYear: 3, investmentMode: 'planned' };
    const result = planner.project(salary, { ...flat, initial: 100000, years: 8,
      annualRate, annualFee: .5, inflation: 2, monthly: 2000 });
    result.years.slice(1).forEach((row, index) => {
      const previous = result.years[index];
      const income = planner.annualIncome(salary, index);
      const expectedChange = row.surplus + income.fundAdded +
        previous.fund * salary.fundAnnualRate / 100 + row.investmentGain - row.shock + row.shortfall;
      close(row.totalAssets - previous.totalAssets, expectedChange);
      close(row.totalAssets, row.portfolio + row.cash + row.fund + row.otherLocked);
    });
  }
});

test('negative returns and zero investments remain finite over eighty years', () => {
  const result = planner.project({ ...clean, monthlyGross: 10000, salaryYears: 80, salaryGrowth: 0 },
    { ...flat, initial: 100000, years: 80, annualRate: -90, annualFee: 5, inflation: 20 });
  assert.equal(result.years.length, 81);
  for (const row of result.years) {
    for (const value of Object.values(row)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.ok(row.portfolio >= 0);
  }
});

test('an empty expense plan has a finite progress ratio and can be at the threshold now', () => {
  const result = planner.project(clean, flat);
  assert.equal(result.currentTarget, 0);
  assert.equal(result.currentProgress, 1);
  assert.equal(result.firstFreedomYear, 0);
  assert.equal(result.sustainableFreedomYear, 0);
});

test('strict input normalization rejects coercible, empty and out-of-range values', () => {
  for (const value of [null, [], new Date(), 'hello', true]) assert.throws(() => planner.normalizeInputs(value));
  for (const value of ['', ' ', null, true, [], {}, '0x10', Infinity, NaN, undefined]) {
    assert.throws(() => planner.normalizeInputs({ monthlyGross: value }));
  }
  for (const raw of [{ children: 1.1 }, { children: 11 }, { salaryYears: 81 }, { shockYear: 0 },
    { fundUnlockYear: -1 }, { withdrawalRate: 0 }, { fundEmployeeRate: 13 },
    { pensionRate: 80, medicalRate: 30 }, { bonusMode: 'auto' }, { investmentMode: 'external' }]) {
    assert.throws(() => planner.normalizeInputs(raw));
  }
  assert.equal(planner.normalizeInputs({ monthlyGross: '1.8e4' }).monthlyGross, 18000);
  assert.deepEqual(planner.normalizeInputs({}), planner.DEFAULTS);
  assert.throws(() => planner.annualIncome({}, -1));
  assert.throws(() => planner.annualIncome({}, 1.5));
  assert.throws(() => planner.project({}, { years: 81 }));
});

test('the browser global works without require, scripts, network or module loading', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('./calculator.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('./salary.js'), 'utf8'), context);
  const result = vm.runInContext('SalaryPlanner.project({}, { years: 1 })', context);
  assert.equal(result.years.length, 2);
  close(result.income.takeHome, planner.annualIncome().takeHome);
});
