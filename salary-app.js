"use strict";

(() => {
  const planner = window.SalaryPlanner;
  const $ = (id) => document.getElementById(id);
  const form = $("salary-form");
  const keys = Object.keys(planner.DEFAULTS);
  const storageKey = "compound-lab-salary-v1";
  const hasStorage = Boolean(globalThis.chrome?.storage?.local);
  const format = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
  const decimals = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
  const money = (value) => `${value < 0 ? "−" : ""}¥${format.format(Math.abs(Math.round(value)))}`;
  const compact = (value) => Math.abs(value) >= 1e8 ? `${decimals.format(value / 1e8)}亿`
    : Math.abs(value) >= 1e4 ? `${decimals.format(value / 1e4)}万` : format.format(Math.round(value));
  let inputs = { ...planner.DEFAULTS };
  let shared;
  let sharedValid = true;
  let result;
  let selectedYear;
  let edited = false;
  let saveTimer;
  let announceTimer;
  let revision = 0;
  let saveChain = Promise.resolve();
  let storageFailed = false;

  function read() {
    return Object.fromEntries(keys.map((key) => {
      const field = $(`salary-${key}`);
      return [key, field.validity.badInput ? NaN : field.value];
    }));
  }

  function write(value) {
    inputs = { ...value };
    keys.forEach((key) => { $(`salary-${key}`).value = value[key]; });
  }

  function clearErrors() {
    keys.forEach((key) => {
      const field = $(`salary-${key}`);
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
    });
    $("salary-error").hidden = true;
  }

  function showError(error) {
    $("salary-error").textContent = error.message || "请检查工资与投入参数。";
    $("salary-error").hidden = false;
    $("salary-result-content").hidden = true;
    clearTimeout(announceTimer);
    const raw = read();
    for (const key of keys) {
      try { planner.normalizeInputs({ ...planner.DEFAULTS, [key]: raw[key] }); }
      catch {
        const field = $(`salary-${key}`);
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", "salary-error");
        const details = field.closest("details");
        if (details) details.open = true;
      }
    }
  }

  function save(value) {
    if (!hasStorage) return;
    const snapshot = { ...value };
    const thisRevision = revision;
    $("salary-save-status").textContent = "正在保存工资规划…";
    saveTimer = setTimeout(() => {
      saveChain = saveChain.then(async () => {
        await chrome.storage.local.set({ [storageKey]: snapshot });
        storageFailed = false;
        if (thisRevision === revision) $("salary-save-status").textContent = "工资规划已保存到本机";
      }).catch(() => {
        storageFailed = true;
        if (thisRevision === revision) $("salary-save-status").textContent = "本机保存失败，当前页面仍可计算";
      });
    }, 250);
  }

  function entries(target, rows) {
    const fragment = document.createDocumentFragment();
    rows.forEach(([label, value, emphasis]) => {
      const row = document.createElement("div");
      if (emphasis) row.className = "salary-ledger-total";
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = money(value);
      dd.classList.toggle("negative", value < 0);
      row.append(dt, dd);
      fragment.append(row);
    });
    $(target).replaceChildren(fragment);
  }

  function freedomLabel(year) {
    return year === null ? `${shared.years} 年内未达到门槛` : year === 0 ? "当前已达到门槛" : `预计第 ${year} 年达到门槛`;
  }

  function render() {
    const income = result.income;
    const final = result.final;
    $("salary-result-content").hidden = false;
    $("salary-monthly-net").textContent = money(income.monthlyTakeHome);
    $("salary-annual-net").textContent = money(income.takeHome);
    $("salary-surplus").textContent = money(result.annualSurplus);
    $("salary-surplus").classList.toggle("negative", result.annualSurplus < 0);
    $("salary-final-assets").textContent = money(final.totalAssets);
    $("salary-shared-assumptions").textContent = `沿用上方投入计划：本金 ${money(shared.initial)}，${shared.years} 年，年化 ${decimals.format(shared.annualRate)}%，费用 ${decimals.format(shared.annualFee)}%，通胀 ${decimals.format(shared.inflation)}%。${inputs.investmentMode === "planned" ? `定投年预算 ${money(result.plannedAnnualInvestment)}，以实际结余为限。` : `将正结余的 ${decimals.format(inputs.investShare)}% 用于定投。`}`;
    entries("salary-ledger", [
      ["税前工资与奖金", income.gross],
      ["个人养老、医疗、失业保险", -income.social],
      ["个人公积金缴存", -income.employeeFund],
      ["全年个人所得税", -income.tax],
      ["年度到手工资（含奖金）", income.takeHome, true],
      ["其他税后收入", income.otherIncome],
      ["家庭常规开支（含育儿）", -result.annualExpense],
      ["全年可支配结余（定投前）", result.annualSurplus, true]
    ]);
    entries("salary-assets", [
      [`第 ${shared.years} 年投资账户`, final.portfolio],
      ["现金与备用金", final.cash],
      ["尚未提取的公积金", final.fund],
      ["其他受限资金", final.otherLocked],
      ["期末总资产", final.totalAssets, true]
    ]);
    const progress = Math.max(0, result.currentProgress * 100);
    const shownProgress = Number.isFinite(progress) ? Math.min(100, progress) : 100;
    $("salary-fi-status").textContent = "以可用资产覆盖生活开支";
    $("salary-fi-year").textContent = freedomLabel(result.firstFreedomYear);
    $("salary-fi-target").textContent = money(result.currentTarget);
    $("salary-fi-progress-fill").style.width = `${shownProgress}%`;
    $("salary-fi-progress").setAttribute("aria-valuenow", String(Math.round(shownProgress)));
    $("salary-fi-progress").setAttribute("aria-valuetext", `当前门槛完成 ${Number.isFinite(progress) ? decimals.format(progress) : "100"}%`);
    $("salary-fi-progress-text").textContent = `当前完成 ${Number.isFinite(progress) ? decimals.format(progress) : "100"}% · 可用资产 ${money(result.years[0].liquid)}`;
    const sustained = result.sustainableFreedomYear === null ? "期限内尚无持续达标区间。"
      : `从${result.sustainableFreedomYear === 0 ? "现在" : `第 ${result.sustainableFreedomYear} 年`}起至测算期末，每个年末均达到门槛。`;
    $("salary-fi-note").textContent = `${sustained} 门槛按未来一年开支 ÷ ${decimals.format(inputs.withdrawalRate)}% 提取率，加应急、医疗及尚未发生的指定冲击储备计算；排除未提取的受限资金。达标后仍按设置的工资年数积累，未自动模拟立即离职。`;
    const arrival = result.firstFreedomYear === null ? final : result.years[result.firstFreedomYear];
    $("salary-fi-arrival").textContent = result.firstFreedomYear === null
      ? `期末可用资产 ${money(final.liquid)}，届时门槛 ${money(final.target)}，尚差 ${money(Math.max(0, final.target - final.liquid))}。${result.totalShortfall > 0 ? "另有未覆盖的支出缺口。" : ""}`
      : `${arrival.year === 0 ? "当前" : `第 ${arrival.year} 年`}总资产 ${money(arrival.totalAssets)}，其中可用资产 ${money(arrival.liquid)}；对应年份所需门槛 ${money(arrival.target)}。`;
    renderWarning();
    renderTable();
    renderChart();
    const slider = $("salary-inspect-year");
    slider.max = shared.years;
    selectedYear = selectedYear === undefined ? shared.years : Math.min(shared.years, selectedYear);
    slider.value = selectedYear;
    inspectYear();
  }

  function renderWarning() {
    const notes = [];
    if (result.annualSurplus < 0) notes.push("首年收入不足以覆盖常规开支，缺口优先使用现金、再卖出投资。");
    if (result.firstShortfallYear !== null) notes.push(`第 ${result.firstShortfallYear} 年起存在资产无法覆盖的支出，累计资金缺口 ${money(result.totalShortfall)}。该路径不计为财富自由，须补充收入或下调开支。`);
    if (inputs.investmentMode === "planned" && result.annualSurplus < result.plannedAnnualInvestment) notes.push("首年结余不足以覆盖上方定投预算，已按可负担金额限制投入。");
    if (inputs.bonusMode === "separate" && inputs.annualBonus > 0) notes.push("符合条件的年终奖在 2027 年底前单独计税；2028 年起按并入综合所得测算。");
    if (inputs.fundUnlockYear > 0) notes.push(`公积金按第 ${inputs.fundUnlockYear} 年末全额转现金、之后缴存继续转现金的情景计算，请确认符合当地提取条件与额度。`);
    if (inputs.shockCost > 0 && inputs.shockYear > shared.years) notes.push("指定突发开支发生在测算期限之后，期限内保留相应储备。");
    if (inputs.monthlyGross === 0 && inputs.salaryYears > 0 && inputs.annualBonus > 0) notes.push("月薪为零，仍按填写的年终奖金计算收入。");
    $("salary-warning").hidden = notes.length === 0;
    $("salary-warning").textContent = notes.join(" ");
  }

  function renderTable() {
    const fragment = document.createDocumentFragment();
    result.years.forEach((point) => {
      const row = document.createElement("tr");
      row.dataset.year = point.year;
      if (point.freedom) row.classList.add("salary-year-free");
      const year = document.createElement("th");
      year.scope = "row";
      year.textContent = point.year === 0 ? "现在" : `第 ${point.year} 年`;
      year.title = point.year === 0 ? "开始时的资产" : `${point.calendarYear} 年末`;
      row.append(year);
      [point.income, point.expense + point.shock, point.investmentGain, point.liquid,
        point.fund + point.otherLocked, point.totalAssets, point.target, point.shortfall].forEach((amount) => {
        const cell = document.createElement("td");
        cell.textContent = format.format(Math.round(amount));
        if (amount < 0) cell.classList.add("negative");
        row.append(cell);
      });
      fragment.append(row);
    });
    $("salary-year-body").replaceChildren(fragment);
  }

  const ns = "http://www.w3.org/2000/svg";
  function svgElement(name, attrs, text) {
    const node = document.createElementNS(ns, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderChart() {
    const chart = $("salary-chart");
    const width = 800, height = 230, left = 65, right = 17, top = 14, bottom = 31;
    const max = Math.max(1, ...result.years.flatMap((row) => [row.totalAssets, row.target]));
    const x = (year) => left + year / shared.years * (width - left - right);
    const y = (value) => height - bottom - value / max * (height - top - bottom);
    const nodes = [svgElement("title", { id: "salary-chart-title" }, "可用资产、总资产与财富自由门槛"),
      svgElement("desc", { id: "salary-chart-desc" }, "以固定收益假设逐年对比，可用资产达到门槛才计为达标；下方滑块及年度表提供详细金额。")];
    for (let i = 0; i <= 3; i++) {
      const amount = max * i / 3;
      nodes.push(svgElement("line", { x1: left, x2: width - right, y1: y(amount), y2: y(amount), stroke: "#e1e7ef" }));
      nodes.push(svgElement("text", { x: left - 9, y: y(amount) + 4, "text-anchor": "end", fill: "#64748b", "font-size": 11 }, compact(amount)));
    }
    [...new Set([0, Math.round(shared.years / 2), shared.years])].forEach((year) => {
      nodes.push(svgElement("text", { x: x(year), y: height - 8, "text-anchor": "middle", fill: "#64748b", "font-size": 11 }, year === 0 ? "现在" : `${year} 年`));
    });
    [["totalAssets", "#aabbd6", ""], ["target", "#b8842c", "6 5"], ["liquid", "#4167a9", ""]].forEach(([key, color, dash]) => {
      nodes.push(svgElement("path", { d: result.years.map((point, i) => `${i ? "L" : "M"}${x(point.year).toFixed(2)},${y(point[key]).toFixed(2)}`).join(" "),
        fill: "none", stroke: color, "stroke-width": key === "liquid" ? 3 : 2, "stroke-dasharray": dash }));
    });
    chart.replaceChildren(...nodes);
  }

  function inspectYear() {
    if (!result) return;
    selectedYear = Math.max(0, Math.min(shared.years, Number($("salary-inspect-year").value)));
    const point = result.years[selectedYear];
    $("salary-inspect-label").textContent = selectedYear === 0 ? "现在" : `第 ${selectedYear} 年`;
    $("salary-inspect-detail").textContent = `可用资产 ${money(point.liquid)} · 总资产 ${money(point.totalAssets)} · 自由门槛 ${money(point.target)}${point.shock ? ` · 当年突发支出 ${money(point.shock)}` : ""}${point.shortfall ? ` · 当年资金缺口 ${money(point.shortfall)}` : ""}`;
    $("salary-year-body").querySelectorAll("tr").forEach((row) => row.classList.toggle("salary-year-selected", Number(row.dataset.year) === selectedYear));
  }

  function update(shouldSave = false) {
    clearErrors();
    if (shouldSave) {
      revision += 1;
      clearTimeout(saveTimer);
    }
    try {
      inputs = planner.normalizeInputs(read());
      if (!sharedValid) throw new Error("请先补全上方的投入计划；工资规划会在参数有效后一起更新。");
      result = planner.project(inputs, shared);
      render();
      if (shouldSave) {
        save(inputs);
        clearTimeout(announceTimer);
        announceTimer = setTimeout(() => {
          $("salary-announcement").textContent = `工资规划已更新。年度到手 ${money(result.income.takeHome)}，年度结余 ${money(result.annualSurplus)}。${freedomLabel(result.firstFreedomYear)}。`;
        }, 450);
      }
      if (!hasStorage) $("salary-save-status").textContent = "网页模式：工资参数仅在当前页面使用";
      else if (!shouldSave) $("salary-save-status").textContent = storageFailed ? "本机保存不可用，当前页面仍可计算" : "工资规划仅保存在本机";
    } catch (error) {
      showError(error);
      if (shouldSave) $("salary-save-status").textContent = "请补全有效参数，暂未保存本次修改";
    }
  }

  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", () => { edited = true; update(true); });
  form.addEventListener("change", (event) => {
    if (event.target.tagName === "SELECT") { edited = true; update(true); }
  });
  $("salary-reset").addEventListener("click", () => {
    edited = true;
    write(planner.DEFAULTS);
    update(true);
  });
  $("salary-inspect-year").addEventListener("input", inspectYear);
  document.addEventListener("compound-plan-change", (event) => {
    sharedValid = event.detail.valid;
    if (sharedValid) shared = event.detail.inputs;
    update();
  });
  write(planner.DEFAULTS);
  try {
    shared = window.CompoundCalculator.normalizeInputs(Object.fromEntries(Object.keys(window.CompoundCalculator.DEFAULTS).map((key) => [key, $(key).value])));
    sharedValid = !$("results").classList.contains("is-invalid");
  } catch { sharedValid = false; }
  update();
  if (hasStorage) {
    chrome.storage.local.get(storageKey).then((saved) => {
      if (edited || saved[storageKey] === undefined) return;
      try {
        write(planner.normalizeInputs(saved[storageKey]));
        update();
        $("salary-save-status").textContent = "已恢复上次的工资规划";
      } catch { $("salary-save-status").textContent = "上次工资参数无效，已使用默认值"; }
    }).catch(() => {
      storageFailed = true;
      $("salary-save-status").textContent = "无法读取本机工资参数，当前页面仍可计算";
    });
  }
})();
