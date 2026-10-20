"use strict";

(() => {
  const calculator = window.CompoundCalculator;
  const $ = (id) => document.getElementById(id);
  const form = $("plan-form");
  const keys = Object.keys(calculator.DEFAULTS);
  const storageKey = "compound-lab-plan-v1";
  const hasStorage = Boolean(globalThis.chrome?.storage?.local);
  const scenarios = [
    { rate: 6, name: "低回报假设", color: "#708fae" },
    { rate: 10, name: "规划假设", color: "#1c7066" },
    { rate: 14.25, name: "历史年化参考", color: "#a08bb6" }
  ];
  const numberFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
  const rateFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
  const money = (number) => numberFormat.format(Math.round(number));
  const currency = (number) => `¥${money(number)}`;
  const compactMoney = (number) => {
    if (Math.abs(number) >= 1e12) return `${rateFormat.format(number / 1e12)}万亿`;
    if (Math.abs(number) >= 1e8) return `${rateFormat.format(number / 1e8)}亿`;
    return money(number);
  };
  let inputs = { ...calculator.DEFAULTS };
  let chartData = null;
  let showAnnual = false;
  let hoverYear = null;
  let saveTimer;
  let storageFailed = false;
  let userEdited = false;
  let saveChain = Promise.resolve();
  let editRevision = 0;
  let tooltipPinned = false;
  let announcementTimer;
  let feedbackTimer;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const fieldMessages = {
    initial: "一次性投入须为 0 至 1 亿之间的金额。",
    monthly: "每月定投须为 0 至 1 亿之间的金额。",
    daily: "每日定投须为 0 至 1 亿之间的金额。",
    tradingDays: "每年交易日须为 1 至 366 之间的整数。",
    frequency: "请选择按月或按交易日定投。",
    years: "投资年限须为 1 至 80 之间的整数。",
    annualRate: "年化收益率须为 −90% 至 50% 之间的数值。",
    annualFee: "年化费用须为 0% 至 5% 之间的数值。",
    inflation: "年通胀率须为 0% 至 20% 之间的数值。",
    timing: "请选择期初或期末定投。"
  };

  function readForm() {
    const raw = Object.fromEntries(keys.map((key) => [key, $(key).value]));
    // 隐藏的另一种频率沿用上次有效金额，避免空值阻塞当前测算。
    if (raw.frequency === "daily") raw.monthly = inputs.monthly;
    else { raw.daily = inputs.daily; raw.tradingDays = inputs.tradingDays; }
    return raw;
  }

  function writeForm(value) {
    inputs = { ...value };
    keys.forEach((key) => { $(key).value = value[key]; });
    syncContributionMode();
  }

  function syncContributionMode() {
    const daily = $("frequency").value === "daily";
    $("monthly-field").hidden = daily;
    $("daily-field").hidden = !daily;
    $("monthly").disabled = daily;
    $("daily").disabled = !daily;
    $("tradingDays").disabled = !daily;
    $("timing").querySelector('[value="end"]').textContent = daily ? "每个交易日日末" : "每月月末";
    $("timing").querySelector('[value="start"]').textContent = daily ? "每个交易日日初" : "每月月初";
  }

  function clearErrors() {
    keys.forEach((key) => {
      $(key).removeAttribute("aria-invalid");
      if (["initial", "monthly", "daily", "tradingDays"].includes(key)) $(key).setAttribute("aria-describedby", `${key}-caption`);
      else $(key).removeAttribute("aria-describedby");
      if ($(`error-${key}`)) $(`error-${key}`).hidden = true;
    });
    $("form-error").hidden = true;
    $("result-content").hidden = false;
    $("invalid-results").hidden = true;
    $("results").classList.remove("is-invalid");
    $("results").style.minHeight = "";
  }

  function showError() {
    const raw = readForm();
    const invalidKeys = keys.filter((key) => {
      try { calculator.normalizeInputs({ ...calculator.DEFAULTS, [key]: raw[key] }); return false; }
      catch { return true; }
    });
    invalidKeys.forEach((key) => {
      $(key).setAttribute("aria-invalid", "true");
      const fieldError = $(`error-${key}`);
      if (fieldError) {
        fieldError.textContent = fieldMessages[key];
        fieldError.hidden = false;
      }
      $(key).setAttribute("aria-describedby", fieldError ? `error-${key}` : "form-error");
      if (["annualFee", "inflation", "timing"].includes(key)) document.querySelector(".advanced").open = true;
    });
    $("form-error").textContent = invalidKeys.map((key) => fieldMessages[key]).join(" ") || "参数无法计算，请检查数值。";
    $("form-error").hidden = false;
    // 保持结果区高度，输入空值或负号的过程中页面不会突然收缩。
    $("results").style.minHeight = `${Math.max(460, $("results").getBoundingClientRect().height)}px`;
    $("results").classList.add("is-invalid");
    $("result-content").hidden = true;
    $("invalid-results").hidden = false;
    $("save-status").textContent = "请补全参数，暂未保存本次修改";
    $("result-update").textContent = "等待有效参数";
    $("mobile-summary-label").textContent = "补全参数，继续测算";
    $("mobile-summary-value").textContent = "—";
    $("view-results").textContent = "修改参数";
    clearTimeout(announcementTimer);
    hideTooltip();
  }

  function scheduleSave() {
    if (!hasStorage) return;
    const snapshot = { ...inputs };
    const revision = editRevision;
    $("save-status").textContent = "正在保存投入计划…";
    saveTimer = setTimeout(() => {
      // 串行写入，避免快速调整时较旧的参数覆盖较新的参数。
      saveChain = saveChain.then(async () => {
        await chrome.storage.local.set({ [storageKey]: snapshot });
        storageFailed = false;
        // 以编辑版本判断是否为当前结果，10.00 等合法写法也能正确结束保存提示。
        if (revision === editRevision) {
          $("save-status").textContent = "投入计划已保存到本机";
        }
      }).catch(() => {
        storageFailed = true;
        if (revision === editRevision) $("save-status").textContent = "本机保存失败，当前页面仍可计算";
      });
    }, 250);
  }

  function syncControls() {
    syncContributionMode();
    $("years-range").value = inputs.years;
    const progress = (inputs.years - 1) / 79 * 100;
    $("years-range").style.background = `linear-gradient(to right,#1c7066 0%,#1c7066 ${progress}%,#e7edee ${progress}%,#e7edee 100%)`;
    document.querySelectorAll("[data-monthly]").forEach((button) => {
      const active = Number(button.dataset.monthly) === inputs.monthly;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", active);
    });
    document.querySelectorAll("[data-daily]").forEach((button) => {
      const active = Number(button.dataset.daily) === inputs.daily;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", active);
    });
    document.querySelectorAll("[data-years]").forEach((button) => {
      const active = Number(button.dataset.years) === inputs.years;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", active);
    });
    const inChinese = (value) => value >= 10000 ? `${rateFormat.format(value / 10000)} 万元` : `${money(value)} 元`;
    $("initial-caption").textContent = inputs.initial ? `${inChinese(inputs.initial)}起始本金` : "暂不投入本金，可只设置定投";
    $("monthly-caption").textContent = inputs.monthly ? `每年投入 ${inChinese(inputs.monthly * 12)}` : "暂不定投，仅计算一次性投入";
    $("daily-caption").textContent = inputs.daily ? `每年约投入 ${inChinese(inputs.daily * inputs.tradingDays)}（${inputs.tradingDays} 次）` : "暂不定投，仅计算一次性投入";
    document.querySelectorAll("[data-step-target]").forEach((button) => {
      const field = $(button.dataset.stepTarget);
      button.disabled = Number(button.dataset.step) < 0 ? inputs[field.id] <= Number(field.min) : inputs[field.id] >= Number(field.max);
    });
  }

  function renderOverview(result) {
    $("heading-years").textContent = inputs.years;
    $("result-years").textContent = inputs.years;
    $("selected-rate").textContent = `年化 ${rateFormat.format(inputs.annualRate)}%`;
    $("final-balance").textContent = compactMoney(result.finalBalance);
    $("final-balance").title = currency(result.finalBalance);
    $("real-balance").textContent = currency(result.realFinalBalance);
    $("inflation-caption").textContent = `（通胀 ${rateFormat.format(inputs.inflation)}%）`;
    renderMetrics(result.years[inputs.years]);
    $("net-rate").textContent = `年化费用 ${rateFormat.format(inputs.annualFee)}% · 费用后年化 ${rateFormat.format(result.netAnnualRate * 100)}%`;
    const daily = inputs.frequency === "daily";
    const amount = daily ? inputs.daily : inputs.monthly;
    $("contribution-summary").textContent = amount === 0 ? "仅一次性投入，未设置定投"
      : daily ? `每个交易日 ${currency(amount)} · 每年按 ${inputs.tradingDays} 天估算 · 共 ${money(result.totalPeriods)} 次`
        : `每月 ${currency(amount)} · 共 ${money(result.totalPeriods)} 次`;
    $("mobile-summary-label").textContent = `${inputs.years} 年后资产总额`;
    $("mobile-summary-value").textContent = `¥${compactMoney(result.finalBalance)}`;
    $("view-results").textContent = "查看结果 ↓";
  }

  function renderMetrics(point) {
    $("total-contributed").textContent = `¥${compactMoney(point.contributed)}`;
    $("total-contributed").title = currency(point.contributed);
    $("total-gain").textContent = `${point.gain < 0 ? "−" : "+"}¥${compactMoney(Math.abs(point.gain))}`;
    $("total-gain").title = currency(point.gain);
    $("total-gain").classList.toggle("negative", point.gain < 0);
    const splitBase = point.contributed + Math.max(0, point.gain);
    const contributionShare = splitBase > 0 ? point.contributed / splitBase * 100 : 0;
    $("split-contributed").style.width = `${contributionShare}%`;
    $("split-gain").style.width = `${splitBase > 0 ? 100 - contributionShare : 0}%`;
    document.querySelector(".asset-split").setAttribute("aria-label", splitBase === 0 ? "当前没有投入或收益" : point.gain < 0
      ? `累计投入 ${currency(point.contributed)}，亏损 ${currency(-point.gain)}`
      : `本金占 ${Math.round(contributionShare)}%，收益占 ${Math.round(100 - contributionShare)}%`);
  }

  function makeText(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function renderCards(results) {
    $("scenario-cards").replaceChildren(...results.map((result, index) => {
      const scenario = scenarios[index];
      const active = inputs.annualRate === scenario.rate;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `scenario-card${active ? " active" : ""}`;
      button.dataset.rate = scenario.rate;
      button.setAttribute("aria-pressed", active);
      button.setAttribute("aria-label", `${scenario.name}，年化 ${scenario.rate}%，${inputs.years} 年后 ${currency(result.finalBalance)}，点击查看此情景`);
      button.append(makeText("span", scenario.name, "scenario-name"));
      const rate = makeText("span", "", "scenario-rate");
      const rateNumber = makeText("b", `${scenario.rate}%`);
      rateNumber.style.color = scenario.color;
      rate.append(rateNumber, makeText("span", "/ 年"));
      const total = makeText("span", "", "scenario-money");
      total.append(makeText("small", "¥"), document.createTextNode(compactMoney(result.finalBalance)));
      total.title = currency(result.finalBalance);
      button.append(rate, total);
      if (active) {
        const check = makeText("span", "✓", "scenario-check");
        check.setAttribute("aria-hidden", "true");
        button.append(check);
      }
      return button;
    }));
    $("scenario-note").textContent = `以上均已扣除年化费用 ${rateFormat.format(inputs.annualFee)}%，为假设测算。`;
  }

  function displayedSeries(results, selected) {
    const series = results.map((result, index) => ({ ...scenarios[index], result }));
    if (!scenarios.some((scenario) => scenario.rate === inputs.annualRate)) {
      series.push({ rate: inputs.annualRate, name: "自定义", color: "#bd8644", result: selected });
    }
    return series;
  }

  function renderTable(series) {
    const header = document.createElement("tr");
    header.append(makeText("th", "投资年数"), makeText("th", "累计投入"));
    series.forEach((item) => header.append(makeText("th", `${item.rate}% 年化${item.name === "自定义" ? "（自定义）" : ""}`, item.rate === inputs.annualRate ? "selected-column" : "")));
    Array.from(header.children).forEach((th) => th.scope = "col");
    $("year-table-head").replaceChildren(header);
    const years = inputs.years <= 5 || showAnnual
      ? Array.from({ length: inputs.years }, (_, index) => index + 1)
      : [...new Set([1, ...Array.from({ length: Math.floor(inputs.years / 5) }, (_, index) => (index + 1) * 5), inputs.years])];
    $("year-table-body").replaceChildren(...years.map((year) => {
      const row = document.createElement("tr");
      const yearCell = makeText("th", `${year} 年`);
      yearCell.scope = "row";
      row.append(yearCell, makeText("td", money(series[0].result.years[year].contributed)));
      series.forEach((item) => row.append(makeText("td", money(item.result.years[year].balance), item.rate === inputs.annualRate ? "selected-column" : "")));
      return row;
    }));
    $("milestone-view").classList.toggle("active", !showAnnual);
    $("annual-view").classList.toggle("active", showAnnual);
    $("milestone-view").setAttribute("aria-pressed", !showAnnual);
    $("annual-view").setAttribute("aria-pressed", showAnnual);
  }

  const svgNS = "http://www.w3.org/2000/svg";
  function svgElement(tag, attrs, text) {
    const element = document.createElementNS(svgNS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function axisText(number) {
    if (number >= 1e16) return `${rateFormat.format(number / 1e16)}亿亿`;
    if (number >= 1e12) return `${rateFormat.format(number / 1e12)}万亿`;
    if (number >= 100000000) return `${rateFormat.format(number / 100000000)}亿`;
    if (number >= 10000) return `${rateFormat.format(number / 10000)}万`;
    return number < 1000 ? rateFormat.format(number) : money(number);
  }

  function renderChart(series, selected) {
    const svg = $("growth-chart");
    const contribution = inputs.frequency === "daily" ? `每个交易日定投 ${currency(inputs.daily)}，每年按 ${inputs.tradingDays} 天估算` : `每月定投 ${currency(inputs.monthly)}`;
    svg.replaceChildren(svgElement("title", { id: "chart-title" }, "不同年化的资产增长轨迹"), svgElement("desc", { id: "chart-desc" }, `一次性投入 ${currency(inputs.initial)}，${contribution}，投资 ${inputs.years} 年。所选年化 ${inputs.annualRate}%，期末资产 ${currency(selected.finalBalance)}。使用左右方向键查看年份，Escape 关闭提示。`));
    // 与容器同宽的坐标系，避免手机上将轴文字随 900px 图形缩小。
    const width = Math.max(280, Math.min(900, Math.round(svg.clientWidth) || 900));
    const height = width < 450 ? 250 : 310;
    const left = width < 450 ? 49 : 61, right = 20, top = 20, bottom = 36;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const allValues = series.flatMap((item) => item.result.years.map((entry) => entry.balance));
    const peak = Math.max(1, selected.totalContributed, ...allValues);
    const magnitude = 10 ** Math.floor(Math.log10(peak));
    const yMax = Math.ceil(peak / magnitude * 2) / 2 * magnitude;
    const x = (year) => left + year / inputs.years * plotWidth;
    const y = (value) => top + (1 - value / yMax) * plotHeight;
    for (let index = 0; index <= 4; index++) {
      const value = yMax / 4 * index;
      svg.append(svgElement("line", { x1: left, y1: y(value), x2: width - right, y2: y(value), stroke: "#e7edef", "stroke-dasharray": "4 5", "stroke-width": 1 }));
      svg.append(svgElement("text", { x: left - 13, y: y(value) + 4, "text-anchor": "end", fill: "#70828b", "font-size": 12 }, axisText(value)));
    }
    const tickCount = width < 450 ? 4 : 5;
    const yearTicks = [...new Set([0, ...Array.from({ length: tickCount }, (_, index) => Math.round(inputs.years / tickCount * (index + 1)))])];
    yearTicks.forEach((year) => svg.append(svgElement("text", { x: x(year), y: height - 12, "text-anchor": "middle", fill: "#70828b", "font-size": 12 }, `${year}年`)));
    const points = (entries, key) => entries.map((entry) => `${x(entry.year)},${y(entry[key])}`).join(" ");
    const selectedPoints = points(selected.years, "balance");
    svg.append(svgElement("polygon", { points: `${x(0)},${y(0)} ${selectedPoints} ${x(inputs.years)},${y(0)}`, fill: "#1c7066", "fill-opacity": 0.045 }));
    svg.append(svgElement("polyline", { points: points(selected.years, "contributed"), fill: "none", stroke: "#a9b5bd", "stroke-width": 1.8, "stroke-dasharray": "5 5" }));
    [...series].sort((a, b) => Number(a.rate === inputs.annualRate) - Number(b.rate === inputs.annualRate)).forEach((item) => {
      svg.append(svgElement("polyline", { points: points(item.result.years, "balance"), fill: "none", stroke: item.color, "stroke-width": item.rate === inputs.annualRate ? 3.5 : 2.3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      svg.append(svgElement("circle", { cx: x(inputs.years), cy: y(item.result.finalBalance), r: item.rate === inputs.annualRate ? 4.5 : 3, fill: item.color, stroke: "white", "stroke-width": 2 }));
    });
    const marker = svgElement("g", { id: "chart-marker", visibility: "hidden", "aria-hidden": "true" });
    svg.append(marker);
    chartData = { series, selected, x, y, left, plotWidth, width, height, top, plotHeight, marker };
    $("chart-legend").replaceChildren(...[{ name: "累计投入", color: "#a9b5bd", principal: true }, ...series.map((item) => ({ name: `${item.rate}%${item.name === "自定义" ? " 自定义" : " 年化"}`, color: item.color }))].map((item) => {
      const rate = item.principal ? null : series.find((entry) => item.name.startsWith(`${entry.rate}%`))?.rate;
      const active = rate === inputs.annualRate;
      const legend = makeText(item.principal ? "span" : "button", "", `legend-item${item.principal ? " principal" : ""}${active ? " active" : ""}`);
      if (!item.principal) {
        legend.type = "button";
        legend.dataset.rate = rate;
        legend.setAttribute("aria-pressed", active);
        legend.setAttribute("aria-label", `查看 ${rate}% 年化情景`);
      }
      const line = document.createElement("i");
      line.style.background = item.principal ? "transparent" : item.color;
      legend.append(line, document.createTextNode(item.name));
      return legend;
    }));
    $("chart-year-range").max = inputs.years;
    $("chart-year-range").value = inputs.years;
    $("chart-year-label").textContent = `第 ${inputs.years} 年`;
    $("chart-year-range").setAttribute("aria-valuetext", `第 ${inputs.years} 年`);
    $("chart-year-range").style.setProperty("--range-progress", "100%");
    hideTooltip();
  }

  function hideTooltip() {
    $("chart-tooltip").hidden = true;
    chartData?.marker.setAttribute("visibility", "hidden");
    hoverYear = null;
    tooltipPinned = false;
    $("chart-dismiss").hidden = true;
    if (chartData) renderMetrics(chartData.selected.years[inputs.years]);
  }

  function showTooltip(year) {
    if (!chartData || $("result-content").hidden) return;
    hoverYear = Math.max(0, Math.min(inputs.years, year));
    $("chart-year-range").value = hoverYear;
    $("chart-year-label").textContent = hoverYear ? `第 ${hoverYear} 年` : "初始投入";
    $("chart-year-range").setAttribute("aria-valuetext", $("chart-year-label").textContent);
    $("chart-year-range").style.setProperty("--range-progress", `${hoverYear / inputs.years * 100}%`);
    $("chart-dismiss").hidden = !tooltipPinned;
    const { series, selected, x, y, marker, top, plotHeight, width, height } = chartData;
    renderMetrics(selected.years[hoverYear]);
    const tooltip = $("chart-tooltip");
    marker.replaceChildren(svgElement("line", { x1: x(hoverYear), y1: top, x2: x(hoverYear), y2: top + plotHeight, stroke: "#b3c6c4", "stroke-dasharray": "4 4" }));
    series.forEach((item) => marker.append(svgElement("circle", { cx: x(hoverYear), cy: y(item.result.years[hoverYear].balance), r: 4, fill: item.color, stroke: "#fff", "stroke-width": 2 })));
    marker.setAttribute("visibility", "visible");
    const rows = [{ name: "累计投入", amount: selected.years[hoverYear].contributed }, ...series.map((item) => ({ name: `${item.rate}% 年化`, amount: item.result.years[hoverYear].balance, color: item.color }))];
    tooltip.replaceChildren(makeText("strong", hoverYear ? `第 ${hoverYear} 年` : "初始投入"), ...rows.map((row) => {
      const element = makeText("div", "", "tooltip-row");
      if (row.color) element.style.color = row.color;
      element.append(makeText("span", row.name), makeText("span", currency(row.amount)));
      return element;
    }));
    tooltip.hidden = false;
    const wrap = $("chart-wrap");
    const chartRect = $("growth-chart").getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const left = x(hoverYear) / width * chartRect.width + chartRect.left - wrapRect.left;
    const desiredLeft = left + 14;
    tooltip.style.left = `${Math.max(0, Math.min(desiredLeft, wrap.clientWidth - tooltip.offsetWidth))}px`;
    tooltip.style.top = `${Math.max(0, top / height * chartRect.height)}px`;
  }

  function render() {
    const selected = calculator.project(inputs);
    const results = calculator.compare(inputs, scenarios.map((item) => item.rate));
    const series = displayedSeries(results, selected);
    syncControls();
    renderOverview(selected);
    renderCards(results);
    renderChart(series, selected);
    renderTable(series);
  }

  function update(save = true) {
    if (save) editRevision += 1;
    clearTimeout(saveTimer);
    clearErrors();
    syncContributionMode();
    try {
      inputs = calculator.normalizeInputs(readForm());
      render();
      $("result-update").textContent = save ? "结果已更新" : "实时计算";
      if (save) {
        clearTimeout(announcementTimer);
        announcementTimer = setTimeout(() => {
          $("result-announcement").textContent = `结果已更新，${inputs.years} 年后资产总额 ¥${compactMoney(calculator.project(inputs).finalBalance)}。`;
        }, 400);
        if (!reducedMotion.matches) {
          clearTimeout(feedbackTimer);
          $("results").classList.remove("is-updating");
          requestAnimationFrame(() => $("results").classList.add("is-updating"));
          feedbackTimer = setTimeout(() => $("results").classList.remove("is-updating"), 500);
        }
      }
      if (save) scheduleSave();
      if (!hasStorage) $("save-status").textContent = "网页模式：参数仅在当前页面使用";
      else if (!save) $("save-status").textContent = storageFailed ? "本机保存失败，当前页面仍可计算" : "投入计划仅保存在本机";
    } catch {
      showError();
    }
  }

  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", (event) => {
    userEdited = true;
    if (event.target.id === "years-range") $("years").value = event.target.value;
    update();
  });
  form.addEventListener("change", (event) => {
    if (["timing", "frequency"].includes(event.target.id)) { userEdited = true; update(); }
  });
  document.querySelectorAll("[data-monthly], [data-daily], [data-years]").forEach((button) => button.addEventListener("click", () => {
    userEdited = true;
    if (button.dataset.monthly !== undefined) $("monthly").value = button.dataset.monthly;
    if (button.dataset.daily !== undefined) $("daily").value = button.dataset.daily;
    if (button.dataset.years !== undefined) $("years").value = button.dataset.years;
    update();
  }));
  document.querySelectorAll("[data-step-target]").forEach((button) => button.addEventListener("click", () => {
    const field = $(button.dataset.stepTarget);
    const current = field.value.trim() === "" ? NaN : Number(field.value);
    if (!Number.isFinite(current)) { field.focus(); return; }
    field.value = Math.min(Number(field.max), Math.max(Number(field.min), current + Number(button.dataset.step)));
    userEdited = true;
    update();
  }));
  function selectScenario(event) {
    const button = event.target.closest("[data-rate]");
    if (!button) return;
    userEdited = true;
    $("annualRate").value = button.dataset.rate;
    update();
    // 整组卡片重新绘制后仍保留键盘焦点。
    const group = event.currentTarget.id;
    $(group).querySelector(`[data-rate="${button.dataset.rate}"]`)?.focus({ preventScroll: true });
  }
  $("scenario-cards").addEventListener("click", selectScenario);
  $("chart-legend").addEventListener("click", selectScenario);
  $("reset").addEventListener("click", () => {
    userEdited = true;
    writeForm(calculator.DEFAULTS);
    update();
  });
  [$("annual-view"), $("milestone-view")].forEach((button) => button.addEventListener("click", () => {
    showAnnual = button.id === "annual-view";
    if (chartData) renderTable(chartData.series);
  }));
  function inspectChartPointer(event) {
    if (!chartData) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointX = (event.clientX - bounds.left) / bounds.width * chartData.width;
    showTooltip(Math.round((pointX - chartData.left) / chartData.plotWidth * inputs.years));
  }
  $("growth-chart").addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" && !tooltipPinned) inspectChartPointer(event);
  });
  $("growth-chart").addEventListener("pointerdown", (event) => {
    tooltipPinned = true;
    inspectChartPointer(event);
  });
  $("growth-chart").addEventListener("pointerleave", () => { if (!tooltipPinned) hideTooltip(); });
  $("growth-chart").addEventListener("pointercancel", hideTooltip);
  $("growth-chart").addEventListener("blur", () => { if (!tooltipPinned) hideTooltip(); });
  $("growth-chart").addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideTooltip();
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      tooltipPinned = true;
      const next = event.key === "Home" ? 0 : event.key === "End" ? inputs.years : (hoverYear ?? 0) + (event.key === "ArrowRight" ? 1 : -1);
      showTooltip(next);
      $("chart-status").textContent = `${$("chart-year-label").textContent}，所选情景资产 ${currency(chartData.selected.years[hoverYear].balance)}`;
    }
  });
  $("chart-year-range").addEventListener("input", (event) => {
    tooltipPinned = true;
    showTooltip(Number(event.target.value));
    if (chartData) $("chart-status").textContent = `${$("chart-year-label").textContent}，所选情景资产 ${currency(chartData.selected.years[hoverYear].balance)}`;
  });
  $("chart-dismiss").addEventListener("click", () => { hideTooltip(); $("chart-year-range").focus({ preventScroll: true }); });
  $("chart-year-range").addEventListener("keydown", (event) => { if (event.key === "Escape") hideTooltip(); });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".chart-wrap, .chart-year-control")) hideTooltip();
  });

  function focusInvalidInput() {
    const field = form.querySelector("[aria-invalid=true]");
    if (!field) return;
    field.scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "center" });
    field.focus({ preventScroll: true });
  }
  $("fix-input").addEventListener("click", focusInvalidInput);
  $("view-results").addEventListener("click", () => {
    if ($("results").classList.contains("is-invalid")) { focusInvalidInput(); return; }
    $("results").scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "start" });
    $("results").focus({ preventScroll: true });
  });
  const mobileView = window.matchMedia("(max-width: 700px)");
  let planVisible = false;
  let resultVisible = false;
  const syncMobileSummary = () => { $("mobile-summary").hidden = !(mobileView.matches && planVisible && !resultVisible); };
  new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.target.classList.contains("plan-panel")) planVisible = entry.isIntersecting;
      else resultVisible = entry.isIntersecting;
    });
    syncMobileSummary();
  }, { threshold: 0 }).observe(document.querySelector(".plan-panel"));
  new IntersectionObserver((entries) => {
    resultVisible = entries[0].isIntersecting;
    syncMobileSummary();
  }, { threshold: 0.4 }).observe(document.querySelector(".result-overview"));
  mobileView.addEventListener("change", syncMobileSummary);

  let lastChartWidth = 0;
  new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (width && Math.abs(width - lastChartWidth) > 1) {
      lastChartWidth = width;
      if (chartData && !$("result-content").hidden) renderChart(chartData.series, chartData.selected);
    }
  }).observe($("chart-wrap"));

  update(false);
  if (hasStorage) {
    chrome.storage.local.get(storageKey).then((saved) => {
      if (userEdited) return;
      if (saved[storageKey] !== undefined) {
        try {
          const restored = calculator.normalizeInputs(saved[storageKey]);
          writeForm(restored);
          update(false);
          $("save-status").textContent = "已恢复上次的投入计划";
        } catch {
          $("save-status").textContent = "上次参数无效，已使用默认计划";
        }
      }
    }).catch(() => {
      storageFailed = true;
      $("save-status").textContent = "无法读取本机参数，当前页面仍可计算";
    });
  }
})();
