# Compound Lab · Compound Interest Calculator

[简体中文](README.md) | English

Set an initial investment, monthly or trading-day contributions, and an investment horizon to compare projected balances, total contributions, gains, and annual results across different annual return assumptions.

The salary and financial independence planner adds mainland China resident salary tax, employee social insurance, housing funds, household and child expenses, emergency reserves, and asset accumulation.

The calculator interface is currently in Simplified Chinese.

## Getting started

**Online:** [Open Compound Lab](https://compoundlab-nine.vercel.app/)

**Local webpage:** Open `index.html` in Chrome or Edge. No dependencies or server setup are required. In webpage mode, settings are kept only for the current page session.

**Chrome extension:**

1. Open `chrome://extensions/`.
2. Enable **Developer mode** and click **Load unpacked**.
3. Select the project folder containing `manifest.json`.
4. Click **年轮 · 复利计算器** in the extensions menu to open the calculator.

In extension mode, valid settings are saved automatically to `chrome.storage.local` and restored the next time you open the calculator. Calculations run locally without a network connection. There is no backend, account, or cloud sync. The extension requests only the `storage` permission and does not read other webpages.

## Calculation model

- The initial investment is invested at the start. Recurring contributions can be monthly or daily on trading days only. Choose the beginning or end of each month or trading day; the default is the end of the period. Set the active recurring amount to zero to calculate an initial investment alone.
- Empty amounts, rates, and counts that allow zero are calculated as zero. Fields stay visually empty while extension storage saves the numeric zero. Settings with a positive minimum, such as the investment horizon, trading-day count, and withdrawal rate, still require valid values. Empty social insurance or housing fund bases follow monthly salary, just like an explicit zero.
- Daily mode defaults to 252 trading days per year. This can be adjusted to an integer from 1 to 366. Annual contributions equal the daily amount multiplied by the trading-day count. Monthly and daily amounts are kept separately; switching frequency does not convert them into equivalent budgets. Previously saved monthly plans remain compatible.
- The 252-day count is a long-term planning assumption that approximately excludes weekends and holidays. Adjust it for the relevant market or fund. Trading days are assumed to be evenly distributed throughout each year. The model does not track actual dates, annual holiday calendars, unexpected closures, or fund subscription suspensions. Consult the [Nasdaq holiday schedule](https://www.nasdaq.com/market-activity/stock-market-holiday-schedule) for U.S. market dates; funds sold in mainland China follow their own subscription rules.
- Investment horizons range from 1 to 80 years. Alongside the 6%, 10%, and 14.25% comparison scenarios, custom annual returns from −90% to 50% are supported.
- The defaults—10% annual return, 0.5% annual fee, and 2% inflation—are adjustable example assumptions, not the actual parameters of a particular fund.
- Net annual return: `g = (1 + annual return) × (1 − annual fee) − 1`.
- Effective return per period: `r = (1 + g)^(1/N) − 1`, where `N = 12` for monthly mode or the selected annual trading-day count for daily mode. The annual return is not simply divided by the number of periods. With no recurring contributions, both modes produce the same annual growth for the initial investment.
- End-of-period contributions: `next balance = current balance × (1 + r) + contribution`.
- Beginning-of-period contributions: `next balance = (current balance + contribution) × (1 + r)`.
- Present purchasing power: `final balance ÷ (1 + inflation)^years`.
- Rates in these formulas are decimals: for example, 10% is `0.10`. Calculations retain floating-point precision internally. Displayed amounts are rounded to the nearest yuan. Large summaries use the Chinese units 亿 (100 million) and 万亿 (1 trillion); the annual table displays the full amounts.

The curves are projections using a constant annual return, not historical backtests or forecasts. Historical index figures are denominated in USD, while calculator amounts are displayed in CNY. Exchange rates, taxes, premiums, and tracking error are not modeled. Actual recurring-investment returns also depend on the sequence of market gains and losses.

## Salary and financial independence

The new section shares the original investment principal, horizon, returns, fees, and inflation assumptions. The original compound calculator continues to model its fixed contributions separately.

- Tax estimates cover mainland China resident employees working a full tax year. Annual tax uses the seven comprehensive-income brackets, a CNY 60,000 basic deduction, compliant employee social insurance and housing fund deductions, and the user's monthly special additional deduction. Average monthly take-home includes the annual bonus and equals annual take-home divided by 12; it is not an actual monthly payroll withholding schedule.
- Employee pension, medical, and unemployment rates default to editable examples of 8%, 2%, and 0.5%. Work injury and maternity insurance are not deducted again from the employee. Use actual local payroll bases and rates; zero bases follow gross monthly pay. City-specific floors, caps, previous-year averages, and tax-deductible fund limits are not looked up automatically. Explicit bases also grow with salary. Housing fund rates are limited to 0–12%; entered bases are assumed to meet local tax deduction limits.
- Eligible annual bonuses can use separate taxation through December 31, 2027. Projections switch to comprehensive-income treatment in 2028. Other current tax brackets and nominal deductions remain fixed in the scenario. The starting year is 2026.
- Enter confirmed special deductions manually, including the employee's allocated child deduction if applicable. Child living costs and tax deductions are separate. Money reserved for future medical treatment is not an incurred medical tax deduction.
- Living costs, each child's costs for the remaining support years, and other annual expenses rise with inflation. Other monthly income is already after tax, remains nominally constant, and continues throughout the horizon. Salary, bonuses, and contribution bases grow at the selected rate until salary years end; retirement pension benefits are not inferred.
- Invest a share of positive annual surplus, or use the original contribution budget subject to affordability. Contributions come from salary surplus and are never counted as extra income. Uninvested surplus stays in cash without interest. Payroll, bonuses, and tax are averaged over 12 months; trading-day budgets are also spread over 12 months in this section. This approximates cash flow rather than actual payroll dates or trading calendars.
- Initial cash excludes the invested principal above. Employee and employer housing fund contributions accumulate separately. Other restricted funds represent an existing vested balance only. Pension and medical accounts do not count as liquid assets. Unlocking restricted funds transfers them to cash without creating wealth. A fund unlock year assumes full withdrawal then and full annual withdrawals thereafter; the user must confirm local eligibility, purposes, and limits. Zero means no withdrawal.
- Emergency and medical reserves remain part of existing assets but are set aside from financial independence capital. A specified one-time shock is inflated from today's money and actually paid from cash, then investments. Uncovered expenses are shown as cumulative shortfalls; no borrowing or imaginary funding is assumed, and a path with such shortfalls is not marked independent.
- The target is next year's projected recurring expenses divided by the selected withdrawal rate, plus emergency, medical, and pending shock reserves. The initial target uses first-year expenses; year-end targets use next-year expenses, all in the same nominal currency. Only liquid assets count toward the target; locked funds appear in total assets. Reaching the threshold does not stop salary automatically. The continued projection follows the configured salary years and also reports whether the threshold remains met through the horizon.

Withdrawal rates and constant returns are adjustable scenarios, not guarantees. The model does not simulate return sequences, investment liquidation taxes, future rule changes, or illness probabilities. Local implementation does not mean the public deployment has been updated.

Rules checked on October 25, 2026: [Individual Income Tax Law](https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3970366/content.html), [annual bonus policy](https://shanghai.chinatax.gov.cn/zcfw/zcfgk/grsds/202308/t468460.html), [special deductions](https://www.chinatax.gov.cn/chinatax/n810341/n810760/c5211366/content.html), and [housing fund deduction limits](https://shanghai.chinatax.gov.cn/bsfw/nszx/hdfk/202104/t457772.html).

## Nasdaq references

The benchmark is the **Nasdaq-100**, not the Nasdaq Composite.

- [Nasdaq 40th anniversary review](https://www.nasdaq.com/articles/nasdaq-100-indexr-celebrates-40-years-innovation): a 14.25% compound annual return from January 31, 1985, through the end of 2024. The article does not separately clarify the dividend treatment of this figure, so this project does not label it as either a price return or a total return.
- [Nasdaq 2025 annual review](https://www.nasdaq.com/2025-Nasdaq-100-Annual-Reconstitution): a 16.0% annualized total return over the 18 years from the end of 2007 through the end of 2025, including reinvested dividends.
- [Nasdaq factsheet](https://www.nasdaq.com/docs/index/xndx356c-factsheet): the **XNDX column** reports −32.38% for 2022 and +55.13% for 2023. These figures should not be mixed with other strategy indices in the same document.

The Chinese README records these references as verified on October 16, 2026; the corresponding periods are stated above. The calculator does not fetch live market data. The 6% and 10% scenarios are planning assumptions, and 14.25% is a historical reference. None guarantees future returns.

## Project files

- `index.html` / `styles.css` / `app.js`: native HTML, CSS, and JavaScript interface, responsive layout, SVG charts, input validation, and local settings persistence in extension mode.
- `calculator.js`: standalone calculation functions for browsers and Node.js.
- `salary.js` / `salary-app.js` / `salary.css`: salary tax, household cash flow, restricted assets, and financial independence planning.
- `calculator.test.cjs`: tests for amounts, fees, negative returns, contribution timing, trading-day calculations, and input boundaries.
- `manifest.json` / `background.js` / `icons/`: Manifest V3 extension entry point and icons.
- `logo.svg`: application logo.

To verify the calculations, install Node.js and run this command from the project directory:

```sh
node --test calculator.test.cjs salary.test.cjs
```
