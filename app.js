/* global document, localStorage, sessionStorage */

const STORAGE_KEY = "job_salary_evaluation_v1";
/** 进入示范前备份整份可持久化状态，供「退出示范」还原 */
const SESSION_PRE_DEMO_KEY = "job_salary_pre_demo_v1";
/** 顶栏「新手指引」条是否已关闭（与整站存档键分离） */
const WELCOME_HINT_DISMISSED_KEY = "job_salary_evaluation_welcome_hint_dismissed";

/** 对比表最多列数（与存档截断、顶栏添加按钮一致） */
const MAX_COMPARE_JOBS = 5;

/**
 * 对比表首列「指标」灰字（`.compare-metric__hint`，见 styles.css）写作预算，便于控制长度、避免省略号截断。
 * 列宽随 `--compare-metric-w`（默认 320px）与整表比例缩放；单元格 padding 后内容区约 260～300px。
 * 样式：11px、line-height 1.4、最多 2 行（line-clamp）。按中文全角粗算：单行约 24～28 字宽、两行合计宜 ≤52 全角当量（混排以实机为准）。
 * @type {{ cssHintSelector: string; designMetricColumnPx: number; maxLines: number; fontSizePx: number; approxFullWidthCharsPerLine: number; approxMaxFullWidthChars: number }}
 */
const COMPARE_METRIC_HINT_BUDGET = Object.freeze({
  cssHintSelector: ".compare-metric__hint",
  designMetricColumnPx: 320,
  maxLines: 2,
  fontSizePx: 11,
  approxFullWidthCharsPerLine: 26,
  approxMaxFullWidthChars: 52,
});

/** 社保/公积金基数行左侧灰字（长度宜 ≤ COMPARE_METRIC_HINT_BUDGET.approxMaxFullWidthChars） */
const CN_SI_HF_BASE_METRIC_HINT = "以当地当年文件为准；右栏为社平 60%～300% 示例。";

const PERIODS = /** @type {const} */ ({
  day: "day",
  month: "month",
  year: "year",
});

const WORKDAY_MODES = /** @type {const} */ ({
  legal: { label: "国家法定节假日（双休）", workdays: 21.75 },
  bigSmall: { label: "大小周", workdays: 24.5 },
  singleRest: { label: "单休", workdays: 26 },
  monthEndSaturday: { label: "月末周六（最后一个周六算工作日）", workdays: 22.75 },
  fourOnThreeOff: { label: "上四休三", workdays: 17.4 },
});

// 常见费率（估算口径）
const RATES = {
  // 个人
  pensionPersonal: 0.08,
  medicalPersonal: 0.02,
  unemploymentPersonal: 0.002,
  // 公司
  pensionCompany: 0.16,
  medicalCompany: 0.085,
  unemploymentCompany: 0.005,
  injuryCompany: 0.003,
  maternityCompany: 0.008,
};

/** @type {{code:string,label:string}[]} */
const MAJOR_CURRENCIES = [
  { code: "CNY", label: "人民币 CNY" },
  { code: "USD", label: "美元 USD" },
  { code: "EUR", label: "欧元 EUR" },
  { code: "GBP", label: "英镑 GBP" },
  { code: "JPY", label: "日元 JPY" },
  { code: "HKD", label: "港元 HKD" },
  { code: "TWD", label: "新台币 TWD" },
  { code: "KRW", label: "韩元 KRW" },
  { code: "SGD", label: "新加坡元 SGD" },
  { code: "AUD", label: "澳元 AUD" },
  { code: "CAD", label: "加元 CAD" },
  { code: "CHF", label: "瑞士法郎 CHF" },
  { code: "INR", label: "印度卢比 INR" },
  { code: "THB", label: "泰铢 THB" },
  { code: "MYR", label: "马来西亚林吉特 MYR" },
  { code: "IDR", label: "印尼盾 IDR" },
  { code: "PHP", label: "菲律宾比索 PHP" },
  { code: "VND", label: "越南盾 VND" },
  { code: "MXN", label: "墨西哥比索 MXN" },
  { code: "BRL", label: "巴西雷亚尔 BRL" },
  { code: "ZAR", label: "南非兰特 ZAR" },
  { code: "NOK", label: "挪威克朗 NOK" },
  { code: "SEK", label: "瑞典克朗 SEK" },
  { code: "DKK", label: "丹麦克朗 DKK" },
  { code: "PLN", label: "波兰兹罗提 PLN" },
  { code: "TRY", label: "土耳其里拉 TRY" },
  { code: "SAR", label: "沙特里亚尔 SAR" },
  { code: "AED", label: "阿联酋迪拉姆 AED" },
  { code: "NZD", label: "新西兰元 NZD" },
];

const MAJOR_CURRENCY_CODES = new Set(MAJOR_CURRENCIES.map((c) => c.code));

const INPUT_VIEW_MODES = /** @type {const} */ ({
  full: "full",
  results: "results",
});

/** 明暗主题（持久化于 state.theme） */
const THEMES = /** @type {const} */ ({ dark: "dark", light: "light" });

/** 报酬效率时间单位（持久化于 state.efficiencyTimeUnit） */
const EFFICIENCY_TIME_UNITS = /** @type {const} */ ({
  minute: "minute",
  hour: "hour",
  workday: "workday",
  month: "month",
  year: "year",
});

/** 金额类数字填写项：用于收入货币提示 */
const INCOME_CURRENCY_HINT_FIELDS = new Set([
  "baseSalary",
  "perfSalary",
  "monthlyRent",
  "commuteCostOneWay",
  "foodBreakfast",
  "foodLunch",
  "foodDinner",
  "foodSnack",
  "siBase",
  "hfBase",
  "taxExemptExtraMonthly",
  "__extraIncomeMonthly",
  "__extraExpenseMonthly",
]);

/**
 * 填写区数值输入右侧灰色单位（与列收入货币或字段语义一致）
 * @returns {string} 无后缀时返回空字符串
 */
function getCompareInputSuffix(field, job) {
  if (!job) return "";
  if (INCOME_CURRENCY_HINT_FIELDS.has(field)) {
    return MAJOR_CURRENCY_CODES.has(job.incomeCurrency) ? job.incomeCurrency : "CNY";
  }
  if (field === "commuteMinutesOneWay") return "分钟";
  if (field === "workHoursPerDay" || field === "restHoursOnDuty") return "小时";
  if (field === "hfRatePct") return "%";
  return "";
}

function getCompareCurrencyCode() {
  const c = state.compareCurrency;
  return MAJOR_CURRENCY_CODES.has(c) ? c : "CNY";
}

function normalizeTheme(raw) {
  const v = String(raw ?? "");
  return v === THEMES.light ? THEMES.light : THEMES.dark;
}

function normalizeEfficiencyTimeUnit(raw) {
  const v = String(raw ?? "");
  const allowed = new Set(Object.values(EFFICIENCY_TIME_UNITS));
  return allowed.has(v) ? v : EFFICIENCY_TIME_UNITS.minute;
}

/** 仅显示缴纳总和与收入比，隐藏各地税制分项 @param {unknown} raw */
function normalizeTaxFeeShortcut(raw) {
  if (raw === true || raw === false) return raw;
  return false;
}

/** @param {unknown} raw @param {boolean} defaultVal */
function normalizeEfficiencyBool(raw, defaultVal) {
  if (raw === true || raw === false) return raw;
  return defaultVal;
}

/**
 * 同步 html[data-theme] 与 meta theme-color
 * @param {string} theme
 */
function applyThemeToDom(theme) {
  const t = normalizeTheme(theme);
  document.documentElement.dataset.theme = t;
  const meta = document.getElementById("themeColorMeta");
  if (meta) meta.setAttribute("content", t === THEMES.light ? "#e6e9f0" : "#0a0f18");
}

/** 可支配所得行固定说明（随顶栏统计周期） */
const DISPOSABLE_SAVINGS_HINT_HTML = "税前−扣缴−必要支出（随顶栏周期）";

/**
 * 分钟/小时报酬效率共用分母：按月在岗±视同加班±通勤，再缩放到顶栏统计周期（与 timeHoursPeriod 同尺度）。
 * @param {any} c
 * @param {{ includeCommute?: boolean, includeOvertime?: boolean }} opts
 */
function efficiencyDenomHoursPeriod(c, opts) {
  const incC = opts.includeCommute !== false;
  const incOt = opts.includeOvertime !== false;
  const od = Number(c.onDutyHoursMonthly) || 0;
  const ot = Number(c.overtimeHoursMonthly) || 0;
  const cm = Number(c.commuteHoursMonthly) || 0;
  const tmExplicit = Number(c.timeHoursMonthly);
  const tm =
    (Number.isFinite(tmExplicit) && tmExplicit > 0 ? tmExplicit : od + cm) || 0;
  const tp = Number(c.timeHoursPeriod) || 0;
  const core = incOt ? od : Math.max(0, od - ot);
  const hMonth = incC ? core + cm : core;
  if (tm <= 0 || hMonth <= 0) return 0;
  return hMonth * (tp / tm);
}

/**
 * @param {any} c
 * @param {string} unit
 * @param {{ includeCommute?: boolean, includeOvertime?: boolean }} [effOpts]
 * @returns {{ r1: number, r2: number, r3: number }}
 */
function formatEfficiencyTripleParts(c, unit, effOpts) {
  const wd = c.workdays || 21.75;
  const u = normalizeEfficiencyTimeUnit(unit);
  if (c._fxInvalid) return { r1: NaN, r2: NaN, r3: NaN };
  const eff = effOpts ?? {
    includeCommute: state.efficiencyIncludeCommute !== false,
    includeOvertime: state.efficiencyIncludeOvertime !== false,
  };
  switch (u) {
    case "minute": {
      const hPeriod = efficiencyDenomHoursPeriod(c, eff);
      const dMin = hPeriod * 60;
      const v = (num) => (dMin > 0 ? num / dMin : 0);
      return { r1: v(c.grossIncomePeriod), r2: v(c.netIncomePeriod), r3: v(c.savingsPeriod) };
    }
    case "hour": {
      const hPeriod = efficiencyDenomHoursPeriod(c, eff);
      const v = (num) => (hPeriod > 0 ? num / hPeriod : 0);
      return { r1: v(c.grossIncomePeriod), r2: v(c.netIncomePeriod), r3: v(c.savingsPeriod) };
    }
    case "workday":
      return {
        r1: wd > 0 ? c.grossIncomeMonthly / wd : 0,
        r2: wd > 0 ? c.netMonthlySalary / wd : 0,
        r3: wd > 0 ? c.savingsMonthly / wd : 0,
      };
    case "month":
      return { r1: c.grossIncomeMonthly, r2: c.netMonthlySalary, r3: c.savingsMonthly };
    case "year":
      return {
        r1: c.grossIncomeMonthly * 12,
        r2: c.netMonthlySalary * 12,
        r3: c.savingsMonthly * 12,
      };
    default:
      return { r1: 0, r2: 0, r3: 0 };
  }
}

/**
 * @param {number} v
 * @param {string} unit
 * @param {string} cc
 */
function formatEfficiencyMoney(v, unit, cc) {
  if (!Number.isFinite(v)) return "—";
  const u = normalizeEfficiencyTimeUnit(unit);
  if (u === "minute") return `${fmtMoney(v)} ${cc}/分钟`;
  if (u === "hour") return `${fmtMoney(v)} ${cc}/小时`;
  if (u === "workday") return `${fmtMoney(v)} ${cc}/工作日`;
  if (u === "month") return `${fmtMoney(v)} ${cc}/月`;
  if (u === "year") return `${fmtMoney(v)} ${cc}/年`;
  return fmtMoneyWithUnit(v);
}

/** 报酬效率行标题中的单位片段，如「分钟」「自然月」 */
function efficiencyRowLabelUnit(unit) {
  const m = {
    minute: "分钟",
    hour: "小时",
    workday: "工作日",
    month: "月",
    year: "年",
  };
  return m[normalizeEfficiencyTimeUnit(unit)] || "分钟";
}

/**
 * @param {string} unit
 * @param {{ includeCommute?: boolean, includeOvertime?: boolean }} [effOpts]
 * @returns {[string, string, string]}
 */
function efficiencyRowHintsForUnit(unit, effOpts) {
  const u = normalizeEfficiencyTimeUnit(unit);
  if (u === "month" || u === "year") {
    return [
      "自然月/年总额（比较币），非按工日摊。",
      "同上，税后。",
      "同上，可支配。",
    ];
  }
  if (u === "workday") {
    return [
      "月税前÷月折算工日。",
      "月税后÷月折算工日。",
      "月可支配÷月折算工日。",
    ];
  }
  const eff = effOpts ?? {
    includeCommute: state.efficiencyIncludeCommute !== false,
    includeOvertime: state.efficiencyIncludeOvertime !== false,
  };
  const incC = eff.includeCommute !== false;
  const incOt = eff.includeOvertime !== false;
  const line = `分母：${incOt ? "含视同加班" : "不含视同加班"}，${incC ? "含通勤" : "不含通勤"}；随顶栏周期。三行同分母，分子为税前/税后/可支配。`;
  return [line, line, line];
}

const FX_CACHE_TTL_MS = 60 * 60 * 1000;
/** @type {Map<string, { rate: number; fetchedAt: number }>} */
const fxRateMemoryCache = new Map();

/**
 * 备用：open.er-api.com（base=from，rates[to] 为 1 from = rate to）
 */
async function fetchFxRateOpenEr(from, to) {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open.er-api HTTP ${res.status}`);
  const data = await res.json();
  if (data?.result !== "success" || !data?.rates) throw new Error("open.er-api bad payload");
  let rate = data.rates[to];
  if (to === "CNY" && !Number.isFinite(rate) && Number.isFinite(data.rates?.CNH)) {
    rate = data.rates.CNH;
  }
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`no rate for ${to}`);
  return rate;
}

/**
 * 1 单位 from 可兑换多少单位 to（Frankfurter: rates[to]）
 * 失败时尝试 open.er-api.com（file:// 等环境下主 API 易被 CORS 拦截）
 * @returns {{ rate: number | null, error: string | null }}
 */
async function fetchFxRate(from, to) {
  const f = MAJOR_CURRENCY_CODES.has(from) ? from : "CNY";
  const t = MAJOR_CURRENCY_CODES.has(to) ? to : "CNY";
  if (f === t) return { rate: 1, error: null };
  const key = `${f}|${t}`;
  const hit = fxRateMemoryCache.get(key);
  const now = Date.now();
  if (hit && now - hit.fetchedAt < FX_CACHE_TTL_MS) {
    return { rate: hit.rate, error: null };
  }
  try {
    const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const data = await res.json();
    const rate = data?.rates?.[t];
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Frankfurter invalid rate");
    fxRateMemoryCache.set(key, { rate, fetchedAt: now });
    return { rate, error: null };
  } catch (e1) {
    const msg1 = e1 instanceof Error ? e1.message : "Frankfurter failed";
    try {
      const rate2 = await fetchFxRateOpenEr(f, t);
      fxRateMemoryCache.set(key, { rate: rate2, fetchedAt: now });
      return { rate: rate2, error: null };
    } catch (e2) {
      const msg2 = e2 instanceof Error ? e2.message : "fallback failed";
      return { rate: null, error: `${msg1}; ${msg2}` };
    }
  }
}

function fmtFxRate(rate) {
  if (!Number.isFinite(rate)) return "—";
  const abs = Math.abs(rate);
  const digits = abs >= 0.1 && abs < 1000 ? 6 : 8;
  return rate.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(4, digits) });
}

/**
 * @param {ReturnType<typeof calc>} c
 * @param {number | null} rate incomeCurrency → compareCurrency，无效时金额置为 NaN
 */
/**
 * @param {{ taxItems?: { amountMonthly: number }[]; welfareItems?: { amountMonthly: number }[] } | null | undefined} tb
 * @param {(n: number) => number} m
 */
function scaleTaxBreakdown(tb, m) {
  if (!tb) return { taxItems: [], welfareItems: [] };
  return {
    taxItems: (tb.taxItems || []).map((x) => ({ ...x, amountMonthly: m(x.amountMonthly) })),
    welfareItems: (tb.welfareItems || []).map((x) => ({ ...x, amountMonthly: m(x.amountMonthly) })),
  };
}

function applyIncomeToCompareMoney(c, rate) {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    const nan = () => NaN;
    return {
      ...c,
      _fxInvalid: true,
      _fxRate: null,
      grossMonthly: nan(),
      medicalPersonal: nan(),
      medicalCompany: nan(),
      socialPersonal: nan(),
      socialCompany: nan(),
      hfPersonal: nan(),
      hfCompany: nan(),
      medicalBoth: nan(),
      socialBoth: nan(),
      hfBoth: nan(),
      fiveInsHfDeductPersonal: nan(),
      fiveInsHfDeductCompany: nan(),
      fiveInsHfDeductBoth: nan(),
      taxExemptExtraMonthly: nan(),
      annualGross: nan(),
      annualGrossAll: nan(),
      monthlyIIT: nan(),
      annualIIT: nan(),
      taxableAnnual: nan(),
      annualStdDeduction: nan(),
      annualInsDeduct: nan(),
      taxableMonthly: nan(),
      netMonthlySalary: nan(),
      totalExpenseMonthly: nan(),
      extraIncomeMonthly: nan(),
      grossIncomeMonthly: nan(),
      feeMonthly: nan(),
      savingsMonthly: nan(),
      grossIncomePeriod: nan(),
      feePeriod: nan(),
      savingsPeriod: nan(),
      housingExpensePeriod: nan(),
      commuteExpensePeriod: nan(),
      foodExpensePeriod: nan(),
      totalExpensePeriod: nan(),
      perSecond: nan(),
      perMinute: nan(),
      perHour: nan(),
    perMinuteIncome: nan(),
    perHourIncome: nan(),
    netIncomePeriod: nan(),
    perSecondCommute: nan(),
    perMinuteCommute: nan(),
    perHourCommute: nan(),
    perMinuteIncomeCommute: nan(),
    perHourIncomeCommute: nan(),
    usMonthlyFederal: nan(),
    usMonthlyState: nan(),
    usMonthlyFica: nan(),
    usAnnualFederal: nan(),
    usAnnualState: nan(),
    usAnnualFicaEmployee: nan(),
    usAnnualSsEmployee: nan(),
    usAnnualMedicareEmployee: nan(),
    hkAnnualMpfEmployee: nan(),
    hkAnnualSalariesTax: nan(),
    hkNetAssessableIncome: nan(),
    hkNetChargeableIncome: nan(),
    hkProgressiveTax: nan(),
    hkStandardTax: nan(),
    hkMpfTaxDeductionAnnual: nan(),
    hkAllowanceAnnual: nan(),
    taxBreakdown: scaleTaxBreakdown(c.taxBreakdown, nan),
    };
  }
  if (rate === 1) return { ...c, _fxInvalid: false, _fxRate: 1, taxBreakdown: c.taxBreakdown || { taxItems: [], welfareItems: [] } };
  const m = (n) => (Number.isFinite(n) ? n * rate : n);
  const mOpt = (n) => (Number.isFinite(n) ? m(n) : n);
  return {
    ...c,
    _fxInvalid: false,
    _fxRate: rate,
    grossMonthly: m(c.grossMonthly),
    medicalPersonal: m(c.medicalPersonal),
    medicalCompany: m(c.medicalCompany),
    socialPersonal: m(c.socialPersonal),
    socialCompany: m(c.socialCompany),
    hfPersonal: m(c.hfPersonal),
    hfCompany: m(c.hfCompany),
    medicalBoth: m(c.medicalBoth),
    socialBoth: m(c.socialBoth),
    hfBoth: m(c.hfBoth),
    fiveInsHfDeductPersonal: m(c.fiveInsHfDeductPersonal),
    fiveInsHfDeductCompany: m(c.fiveInsHfDeductCompany),
    fiveInsHfDeductBoth: m(c.fiveInsHfDeductBoth),
    taxExemptExtraMonthly: m(c.taxExemptExtraMonthly),
    annualGross: m(c.annualGross),
    annualGrossAll: m(c.annualGrossAll),
    monthlyIIT: m(c.monthlyIIT),
    annualIIT: m(c.annualIIT),
    taxableAnnual: m(c.taxableAnnual),
    annualStdDeduction: m(c.annualStdDeduction),
    annualInsDeduct: m(c.annualInsDeduct),
    taxableMonthly: m(c.taxableMonthly),
    netMonthlySalary: m(c.netMonthlySalary),
    totalExpenseMonthly: m(c.totalExpenseMonthly),
    extraIncomeMonthly: m(c.extraIncomeMonthly),
    grossIncomeMonthly: m(c.grossIncomeMonthly),
    feeMonthly: m(c.feeMonthly),
    savingsMonthly: m(c.savingsMonthly),
    grossIncomePeriod: m(c.grossIncomePeriod),
    feePeriod: m(c.feePeriod),
    savingsPeriod: m(c.savingsPeriod),
    housingExpensePeriod: m(c.housingExpensePeriod),
    commuteExpensePeriod: m(c.commuteExpensePeriod),
    foodExpensePeriod: m(c.foodExpensePeriod),
    totalExpensePeriod: m(c.totalExpensePeriod),
    perSecond: m(c.perSecond),
    perMinute: m(c.perMinute),
    perHour: m(c.perHour),
    perMinuteIncome: m(c.perMinuteIncome),
    perHourIncome: m(c.perHourIncome),
    netIncomePeriod: m(c.netIncomePeriod),
    perSecondCommute: m(c.perSecondCommute),
    perMinuteCommute: m(c.perMinuteCommute),
    perHourCommute: m(c.perHourCommute),
    perMinuteIncomeCommute: m(c.perMinuteIncomeCommute),
    perHourIncomeCommute: m(c.perHourIncomeCommute),
    usMonthlyFederal: mOpt(c.usMonthlyFederal),
    usMonthlyState: mOpt(c.usMonthlyState),
    usMonthlyFica: mOpt(c.usMonthlyFica),
    usAnnualFederal: mOpt(c.usAnnualFederal),
    usAnnualState: mOpt(c.usAnnualState),
    usAnnualFicaEmployee: mOpt(c.usAnnualFicaEmployee),
    usAnnualSsEmployee: mOpt(c.usAnnualSsEmployee),
    usAnnualMedicareEmployee: mOpt(c.usAnnualMedicareEmployee),
    hkAnnualMpfEmployee: mOpt(c.hkAnnualMpfEmployee),
    hkAnnualSalariesTax: mOpt(c.hkAnnualSalariesTax),
    hkNetAssessableIncome: mOpt(c.hkNetAssessableIncome),
    hkNetChargeableIncome: mOpt(c.hkNetChargeableIncome),
    hkProgressiveTax: mOpt(c.hkProgressiveTax),
    hkStandardTax: mOpt(c.hkStandardTax),
    hkMpfTaxDeductionAnnual: mOpt(c.hkMpfTaxDeductionAnnual),
    hkAllowanceAnnual: mOpt(c.hkAllowanceAnnual),
    taxBreakdown: scaleTaxBreakdown(c.taxBreakdown, m),
  };
}

async function refreshFxRates() {
  state.fxLoading = true;
  renderAll();
  const compare = getCompareCurrencyCode();
  const jobs = state.jobs || [];
  state.fxByJobId = {};
  const results = await Promise.all(
    jobs.map(async (job) => {
      const inc = MAJOR_CURRENCY_CODES.has(job.incomeCurrency) ? job.incomeCurrency : "CNY";
      const { rate, error } = await fetchFxRate(inc, compare);
      return { jobId: job.id, inc, compare, rate, error };
    })
  );
  for (const x of results) {
    state.fxByJobId[x.jobId] = {
      rate: x.rate,
      error: x.error,
      from: x.inc,
      to: x.compare,
    };
  }
  state.fxLoading = false;
}

function getFxRateForJob(jobId) {
  const m = state.fxByJobId?.[jobId];
  if (!m) return null;
  if (m.rate == null || !Number.isFinite(m.rate)) return null;
  return m.rate;
}

/** 收入货币 → 比较货币；同币种为 1；未就绪为 null（表格金额显示为 —） */
function effectiveFxRate(job) {
  const inc = MAJOR_CURRENCY_CODES.has(job.incomeCurrency) ? job.incomeCurrency : "CNY";
  const comp = getCompareCurrencyCode();
  if (inc === comp) return 1;
  const m = state.fxByJobId?.[job.id];
  if (m && m.rate != null && Number.isFinite(m.rate)) return m.rate;
  return null;
}

function fxRateCellHtml(job) {
  const inc = MAJOR_CURRENCY_CODES.has(job.incomeCurrency) ? job.incomeCurrency : "CNY";
  const comp = getCompareCurrencyCode();
  if (state.fxLoading) {
    return `<div class="compare-fx-cell"><span class="compare-fx-muted">获取汇率中…</span></div>`;
  }
  if (inc === comp) {
    return `<div class="compare-fx-cell compare-fx-ok">无需换算（同币种）</div>`;
  }
  const m = state.fxByJobId?.[job.id];
  if (!m || m.rate == null || !Number.isFinite(m.rate)) {
    const raw = m?.error ? String(m.error) : "未获取到汇率（可改用 http:// 本地服务器打开页面）";
    const short = raw.length > 80 ? `${raw.slice(0, 78)}…` : raw;
    return `<div class="compare-fx-cell compare-fx-err" title="${escapeHtml(raw)}">汇率不可用<br/><span class="compare-fx-err-detail">${escapeHtml(short)}</span></div>`;
  }
  return `<div class="compare-fx-cell compare-fx-ok">1 ${escapeHtml(inc)} = ${fmtFxRate(m.rate)} ${escapeHtml(comp)}</div>`;
}

function fxSampleCellHtml(job) {
  const inc = MAJOR_CURRENCY_CODES.has(job.incomeCurrency) ? job.incomeCurrency : "CNY";
  const comp = getCompareCurrencyCode();
  const sample = 10000;
  if (inc === comp) {
    return `<div class="compare-fx-cell compare-fx-muted">—</div>`;
  }
  const m = state.fxByJobId?.[job.id];
  if (state.fxLoading || !m || m.rate == null || !Number.isFinite(m.rate)) {
    return `<div class="compare-fx-cell">—</div>`;
  }
  const conv = sample * m.rate;
  return `<div class="compare-fx-cell compare-fx-ok"><span class="compare-fx-mono">${fmtMoney(sample)} ${escapeHtml(inc)}</span> → <span class="compare-fx-mono">${fmtMoney(conv)} ${escapeHtml(comp)}</span></div>`;
}

function fmtMoneyWithCompareUnit(n) {
  if (!Number.isFinite(n)) return "—";
  return `${fmtMoney(n)} ${getCompareCurrencyCode()}`;
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${abs.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function fmtMoneyWithUnit(n) {
  return fmtMoneyWithCompareUnit(n);
}

function fmtHours(n) {
  if (!Number.isFinite(n)) return "—";
  return `${round1(n).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 小时`;
}

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

function setMoney(el, n) {
  if (!el) return;
  el.textContent = fmtMoneyWithUnit(n);
  el.classList.remove("pos", "neg");
  if (Number.isFinite(n)) {
    if (n > 0) el.classList.add("pos");
    if (n < 0) el.classList.add("neg");
  }
}

function safeDialogShow(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function safeDialogClose(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function defaultJob() {
  return {
    id: uid(),
    name: "",
    baseSalary: 0,
    perfSalary: 0,
    bonusCoef: 0,
    workdayMode: "legal",
    workHoursPerDay: 0,
    /** 日均在岗期间规定休息（小时），不超过在岗时长 */
    restHoursOnDuty: 0,

    hasSocialInsurance: "yes",
    siBase: 0,

    hasHousingFund: "yes",
    hfBase: 0,
    hfRatePct: 5,
    taxExemptExtraMonthly: 0,

    monthlyRent: 0,
    commuteCostOneWay: 0,
    commuteMinutesOneWay: 0,

    foodBreakfast: 0,
    foodLunch: 0,
    foodDinner: 0,
    foodSnack: 0,

    extraIncomes: /** @type {{name:string, amount:number}[]} */ ([]), // pre-tax, monthly
    extraExpenses: /** @type {{name:string, amount:number}[]} */ ([]), // monthly

    region: "中国大陆",
    incomeCurrency: "CNY",
    compareCurrency: "CNY",

    /** @type {"cn"|"us"|"hk"|"none"|"pending"} */
    taxModel: "cn",
    /** 二级区划：美国为州码 MA/CA/…；中国大陆可为省名等 */
    subRegion: "",
    /** 中国大陆：省级行政区划代码（6 位） */
    cnProvinceAdcode: "",
    /** 中国大陆：地级行政区划代码（6 位） */
    cnCityAdcode: "",
    /** 香港薪俸税：婚姻状况 */
    hkMaritalStatus: "single",
    /** 香港：已婚时选用基本免税额或已婚人士免税额 */
    hkAllowanceMode: "basic",
  };
}

/** 非示范用的空初始状态（损坏存档或退出示范且无备份） */
function defaultUiCollapse() {
  return {
    fill: true,
    calc: true,
    fill_income: true,
    fill_si: true,
    fill_hk: true,
    fill_housing: true,
    fill_commute: true,
    fill_food: true,
    fill_custom: true,
    calc_fx: true,
    calc_income: true,
    calc_tax_wrap: true,
    calc_tax_cn: true,
    calc_tax_us: true,
    calc_tax_hk: true,
    calc_expense: true,
    calc_result: true,
    calc_time: true,
    calc_eff: true,
  };
}

function normalizeUiCollapse(raw) {
  return { ...defaultUiCollapse(), ...(raw && typeof raw === "object" ? raw : {}) };
}

function emptyNonDemoState() {
  return {
    period: PERIODS.month,
    savingsDisplayMode: "follow",
    incomeDisplayMode: "follow",
    theme: THEMES.dark,
    efficiencyTimeUnit: EFFICIENCY_TIME_UNITS.minute,
    efficiencyIncludeCommute: true,
    efficiencyIncludeOvertime: true,
    compareCurrency: "CNY",
    inputViewMode: INPUT_VIEW_MODES.full,
    demoActive: false,
    taxFeeShortcut: false,
    uiCollapse: defaultUiCollapse(),
    salarySplitSegOrder: ["fee", "exp", "sav"],
    jobs: [defaultJob()],
  };
}

const SALARY_SPLIT_SEG_KEYS = /** @type {const} */ (["fee", "exp", "sav"]);

/** @param {unknown} raw @returns {("fee"|"exp"|"sav")[]} */
function normalizeSalarySplitSegOrder(raw) {
  if (!Array.isArray(raw) || raw.length !== 3) return [...SALARY_SPLIT_SEG_KEYS];
  const set = new Set(raw);
  if (set.size !== 3 || !SALARY_SPLIT_SEG_KEYS.every((k) => set.has(k))) return [...SALARY_SPLIT_SEG_KEYS];
  return /** @type {("fee"|"exp"|"sav")[]} */ ([raw[0], raw[1], raw[2]]);
}

/**
 * 从 localStorage 或 session 备份解析出的 JSON 归并为可写入 state 的字段（不含 fx）
 * @param {unknown} parsed
 */
function parsePersistedPayload(parsed) {
  const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [defaultJob()];
  const compareCurrency =
    typeof parsed?.compareCurrency === "string" && MAJOR_CURRENCY_CODES.has(parsed.compareCurrency) ? parsed.compareCurrency : "CNY";
  const inputViewMode = parsed?.inputViewMode === INPUT_VIEW_MODES.results ? INPUT_VIEW_MODES.results : INPUT_VIEW_MODES.full;
  const demoActive = typeof parsed?.demoActive === "boolean" ? parsed.demoActive : false;
  const theme = normalizeTheme(parsed?.theme);
  const efficiencyTimeUnit = normalizeEfficiencyTimeUnit(parsed?.efficiencyTimeUnit);
  const efficiencyIncludeCommute = normalizeEfficiencyBool(parsed?.efficiencyIncludeCommute, true);
  const efficiencyIncludeOvertime = normalizeEfficiencyBool(parsed?.efficiencyIncludeOvertime, true);
  let taxFeeShortcut = normalizeTaxFeeShortcut(parsed?.taxFeeShortcut);
  if (parsed && typeof parsed.taxFeeShortcut !== "boolean" && parsed.showTaxFeeTotal !== undefined) {
    taxFeeShortcut = parsed.showTaxFeeTotal === false;
  }
  return {
    period: parsed?.period === PERIODS.day || parsed?.period === PERIODS.year ? parsed.period : PERIODS.month,
    savingsDisplayMode: parsed?.savingsDisplayMode === "minute" || parsed?.savingsDisplayMode === "hour" ? parsed.savingsDisplayMode : "follow",
    incomeDisplayMode: parsed?.incomeDisplayMode === "minute" || parsed?.incomeDisplayMode === "hour" ? parsed.incomeDisplayMode : "follow",
    theme,
    efficiencyTimeUnit,
    efficiencyIncludeCommute,
    efficiencyIncludeOvertime,
    taxFeeShortcut,
    compareCurrency,
    inputViewMode,
    demoActive,
    uiCollapse: normalizeUiCollapse(parsed?.uiCollapse),
    salarySplitSegOrder: normalizeSalarySplitSegOrder(parsed?.salarySplitSegOrder),
    jobs: jobs.slice(0, MAX_COMPARE_JOBS).map((j) => {
      const merged = { ...defaultJob(), ...j, id: j?.id || uid() };
      merged.compareCurrency = compareCurrency;
      merged.region = normalizePrimaryRegion(merged.region);
      if (typeof merged.subRegion !== "string") merged.subRegion = "";
      merged.cnProvinceAdcode =
        typeof merged.cnProvinceAdcode === "string" && /^\d{6}$/.test(merged.cnProvinceAdcode) ? merged.cnProvinceAdcode : "";
      merged.cnCityAdcode =
        typeof merged.cnCityAdcode === "string" && /^\d{6}$/.test(merged.cnCityAdcode) ? merged.cnCityAdcode : "";
      if (typeof merged.incomeCurrency !== "string" || !MAJOR_CURRENCY_CODES.has(merged.incomeCurrency)) merged.incomeCurrency = "CNY";
      const tierMerged = regionEconomyTier(merged.region);
      if (tierMerged === "us") {
        const legacyUs = j && typeof j === "object" && "usState" in j ? /** @type {any} */ (j).usState : undefined;
        merged.subRegion = normalizeUsState(subRegionToUsStateCode(merged.subRegion || legacyUs || ""));
      }
      delete merged.usState;
      syncJobFieldsForRegionTier(merged);
      merged.hkMaritalStatus = merged.hkMaritalStatus === "married" ? "married" : "single";
      merged.hkAllowanceMode = merged.hkAllowanceMode === "married" ? "married" : "basic";
      merged.restHoursOnDuty = clamp(asNumber(merged.restHoursOnDuty), 0, 24);
      return merged;
    }),
  };
}

/**
 * 加载同目录 demo-state.json，经 parsePersistedPayload 归一化。
 * file:// 或缺失文件时 fetch 失败，回退 emptyNonDemoState（请用本地 HTTP 服务以启用示范 JSON）。
 */
async function resolveDemoPayload() {
  try {
    const url = new URL("demo-state.json", window.location.href);
    const res = await fetch(url.href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return parsePersistedPayload(data);
  } catch (e) {
    console.warn("[job_salary_evaluation] 无法加载 demo-state.json，请用本地 HTTP 打开页面。", e);
    return emptyNonDemoState();
  }
}

async function resolveInitialState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parsePersistedPayload(JSON.parse(raw));
  } catch (e) {
    console.warn("[job_salary_evaluation] localStorage 解析失败", e);
    return emptyNonDemoState();
  }
  return await resolveDemoPayload();
}

function saveState() {
  for (const j of state.jobs) {
    j.compareCurrency = state.compareCurrency;
  }
  const { fxByJobId: _fx1, fxLoading: _fx2, ...persistable } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
}

/** 与 saveState 写入 localStorage 的结构一致（用于进入示范前备份） */
function getPersistableSnapshot() {
  const { fxByJobId: _fx1, fxLoading: _fx2, ...persistable } = state;
  return persistable;
}

/**
 * @param {ReturnType<typeof parsePersistedPayload>} payload
 */
function applyPayloadToState(payload) {
  state.period = payload.period;
  state.savingsDisplayMode = payload.savingsDisplayMode;
  state.incomeDisplayMode = payload.incomeDisplayMode;
  state.theme = normalizeTheme(payload.theme);
  state.efficiencyTimeUnit = normalizeEfficiencyTimeUnit(payload.efficiencyTimeUnit);
  state.efficiencyIncludeCommute = normalizeEfficiencyBool(payload.efficiencyIncludeCommute, true);
  state.efficiencyIncludeOvertime = normalizeEfficiencyBool(payload.efficiencyIncludeOvertime, true);
  state.taxFeeShortcut = normalizeTaxFeeShortcut(payload?.taxFeeShortcut);
  state.compareCurrency = payload.compareCurrency;
  state.inputViewMode = payload.inputViewMode;
  state.demoActive = payload.demoActive;
  state.uiCollapse = normalizeUiCollapse(payload.uiCollapse);
  state.salarySplitSegOrder = normalizeSalarySplitSegOrder(payload.salarySplitSegOrder);
  state.jobs = payload.jobs;
  for (const j of state.jobs) j.compareCurrency = state.compareCurrency;
  applyThemeToDom(state.theme);
}

function persistDismissWelcomeHint() {
  try {
    localStorage.setItem(WELCOME_HINT_DISMISSED_KEY, "1");
  } catch {
    // ignore
  }
}

function isWelcomeHintDismissed() {
  try {
    return localStorage.getItem(WELCOME_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function updateWelcomeHint() {
  const el = document.getElementById("welcomeHint");
  if (!el) return;
  const hide = isWelcomeHintDismissed() || !!state.demoActive;
  el.classList.toggle("is-hidden", hide);
}

async function enterDemoMode() {
  if (!state.demoActive) {
    try {
      sessionStorage.setItem(SESSION_PRE_DEMO_KEY, JSON.stringify(getPersistableSnapshot()));
    } catch {
      // ignore
    }
  }
  const payload = await resolveDemoPayload();
  applyPayloadToState({ ...payload, demoActive: true });
  persistDismissWelcomeHint();
  state.fxByJobId = {};
  saveState();
  syncToolbarFromState();
  void refreshFxRates().then(() => renderAll());
}

function exitDemoMode() {
  let raw = null;
  try {
    raw = sessionStorage.getItem(SESSION_PRE_DEMO_KEY);
  } catch {
    raw = null;
  }
  try {
    sessionStorage.removeItem(SESSION_PRE_DEMO_KEY);
  } catch {
    // ignore
  }
  if (raw) {
    try {
      applyPayloadToState(parsePersistedPayload(JSON.parse(raw)));
    } catch {
      applyPayloadToState(emptyNonDemoState());
    }
  } else {
    applyPayloadToState(emptyNonDemoState());
  }
  state.fxByJobId = {};
  saveState();
  syncToolbarFromState();
  void refreshFxRates().then(() => renderAll());
}

/** 个税（年度综合所得）税率表 */
const IIT_ANNUAL = [
  { upTo: 36000, rate: 0.03, quick: 0 },
  { upTo: 144000, rate: 0.1, quick: 2520 },
  { upTo: 300000, rate: 0.2, quick: 16920 },
  { upTo: 420000, rate: 0.25, quick: 31920 },
  { upTo: 660000, rate: 0.3, quick: 52920 },
  { upTo: 960000, rate: 0.35, quick: 85920 },
  { upTo: Infinity, rate: 0.45, quick: 181920 },
];

function calcAnnualIIT(taxableAnnual) {
  const t = Math.max(0, taxableAnnual);
  const bracket = IIT_ANNUAL.find((b) => t <= b.upTo) || IIT_ANNUAL[IIT_ANNUAL.length - 1];
  const tax = t * bracket.rate - bracket.quick;
  return { tax: Math.max(0, tax), bracket };
}

function iitBracketRange(bracket) {
  const idx = IIT_ANNUAL.indexOf(bracket);
  const lower = idx > 0 ? IIT_ANNUAL[idx - 1].upTo : 0;
  const upper = bracket?.upTo ?? Infinity;
  return { lower, upper };
}

function sumCustom(list) {
  return (Array.isArray(list) ? list : []).reduce((acc, x) => acc + asNumber(x?.amount), 0);
}

function workdaysForMode(mode) {
  return (WORKDAY_MODES[mode]?.workdays ?? WORKDAY_MODES.legal.workdays);
}

function getTaxModel(job) {
  if (job?.taxModel === "none") return "none";
  if (job?.taxModel === "pending") return "pending";
  if (job?.taxModel === "us") return "us";
  if (job?.taxModel === "hk") return "hk";
  return "cn";
}

function clampRestHoursOnDuty(job, onDutyHoursPerDay) {
  const od = Math.max(0, asNumber(onDutyHoursPerDay));
  return clamp(asNumber(job.restHoursOnDuty), 0, od);
}

/** 美国 W-2 估算：税年与参数（申报身份固定 Single，与常见 H-1B 预扣场景简化一致） */
const US_TAX_YEAR = 2024;
const US_FED_STD_DED_SINGLE_2024 = 14600;
const US_CA_STD_DED_SINGLE_2024 = 5363;
const US_SS_WAGE_BASE_2024 = 168600;
const US_MEDICARE_ADD_THRESHOLD_SINGLE_2024 = 200000;

const US_FED_SINGLE_2024_WIDTHS = [
  { w: 11600, r: 0.1 },
  { w: 35550, r: 0.12 },
  { w: 53375, r: 0.22 },
  { w: 91425, r: 0.24 },
  { w: 51775, r: 0.32 },
  { w: 365625, r: 0.35 },
  { w: Infinity, r: 0.37 },
];

const US_CA_SINGLE_2024_WIDTHS = [
  { w: 10412, r: 0.01 },
  { w: 14272, r: 0.02 },
  { w: 13104, r: 0.04 },
  { w: 14667, r: 0.06 },
  { w: 13840, r: 0.08 },
  { w: 272344, r: 0.093 },
  { w: 67725, r: 0.103 },
  { w: 270911, r: 0.113 },
  { w: Infinity, r: 0.123 },
];

function usMarginalTax(annualTaxable, widthRateList) {
  let tax = 0;
  let rest = Math.max(0, annualTaxable);
  for (const seg of widthRateList) {
    const take = seg.w === Infinity ? rest : Math.min(rest, seg.w);
    tax += take * seg.r;
    rest -= take;
    if (rest <= 0) break;
  }
  return tax;
}

function usFederalBracketMeta(federalTaxable) {
  const t = Math.max(0, federalTaxable);
  /** @type {{ upTo: number; rate: number; quick: number }} */
  if (t <= 11600) return { upTo: 11600, rate: 0.1, quick: 0 };
  if (t <= 47150) return { upTo: 47150, rate: 0.12, quick: 0 };
  if (t <= 100525) return { upTo: 100525, rate: 0.22, quick: 0 };
  if (t <= 191950) return { upTo: 191950, rate: 0.24, quick: 0 };
  if (t <= 243725) return { upTo: 243725, rate: 0.32, quick: 0 };
  if (t <= 609350) return { upTo: 609350, rate: 0.35, quick: 0 };
  return { upTo: Infinity, rate: 0.37, quick: 0 };
}

function calcUsW2(job) {
  const baseSalary = asNumber(job.baseSalary);
  const perfSalary = asNumber(job.perfSalary);
  const grossMonthly = baseSalary + perfSalary;
  const bonusAnnual = baseSalary * asNumber(job.bonusCoef);

  const workdays = workdaysForMode(job.workdayMode);
  const workHoursPerDay = asNumber(job.workHoursPerDay);
  const onDutyHoursPerDay = Math.max(0, workHoursPerDay);
  const restHoursEffective = clampRestHoursOnDuty(job, onDutyHoursPerDay);
  const actualWorkHoursPerDay = Math.max(0, onDutyHoursPerDay - restHoursEffective);

  const extraIncomeMonthly = sumCustom(job.extraIncomes);
  const wagesAnnual = (grossMonthly + extraIncomeMonthly) * 12 + bonusAnnual;

  const ssAnnual = 0.062 * Math.min(wagesAnnual, US_SS_WAGE_BASE_2024);
  const medicareBase = 0.0145 * wagesAnnual;
  const medicareAdd = 0.009 * Math.max(0, wagesAnnual - US_MEDICARE_ADD_THRESHOLD_SINGLE_2024);
  const medicareAnnual = medicareBase + medicareAdd;
  const ficaAnnual = ssAnnual + medicareAnnual;

  const federalTaxable = Math.max(0, wagesAnnual - US_FED_STD_DED_SINGLE_2024);
  const annualFed = usMarginalTax(federalTaxable, US_FED_SINGLE_2024_WIDTHS);

  const st = normalizeUsState(subRegionToUsStateCode(job.subRegion));
  let annualState = 0;
  if (st === "CA") {
    const caTaxable = Math.max(0, wagesAnnual - US_CA_STD_DED_SINGLE_2024);
    annualState = usMarginalTax(caTaxable, US_CA_SINGLE_2024_WIDTHS);
  }

  const annualFedState = annualFed + annualState;
  const monthlyFed = annualFed / 12;
  const monthlyState = annualState / 12;
  const monthlyFica = ficaAnnual / 12;
  const monthlyIIT = monthlyFed + monthlyState;

  const socialPersonal = ssAnnual / 12;
  const socialCompany = 0;
  const medicalPersonal = medicareAnnual / 12;
  const medicalCompany = 0;
  const hfPersonal = 0;
  const hfCompany = 0;
  const fiveInsHfDeductPersonal = monthlyFica;
  const fiveInsHfDeductCompany = 0;
  const fiveInsHfDeductBoth = monthlyFica;
  const taxExemptExtraMonthly = 0;

  const annualGrossAll = wagesAnnual;
  const annualStdDeduction = US_FED_STD_DED_SINGLE_2024;
  const annualInsDeduct = 0;
  const taxableAnnual = federalTaxable;
  const bracket = usFederalBracketMeta(federalTaxable);
  const annualIIT = annualFedState;
  const taxableMonthly = Math.max(0, grossMonthly - monthlyFica);

  const monthlyRent = asNumber(job.monthlyRent);
  const commuteCostOneWay = asNumber(job.commuteCostOneWay);
  const commuteMonthly = workdays * 2 * commuteCostOneWay;
  const foodDaily = asNumber(job.foodBreakfast) + asNumber(job.foodLunch) + asNumber(job.foodDinner) + asNumber(job.foodSnack);
  const foodMonthly = workdays * foodDaily;
  const extraExpenseMonthly = sumCustom(job.extraExpenses);
  const totalExpenseMonthly = monthlyRent + commuteMonthly + foodMonthly + extraExpenseMonthly;

  const grossIncomeMonthly = grossMonthly + extraIncomeMonthly + bonusAnnual / 12;
  const feeMonthly = monthlyFica + monthlyFed + monthlyState;
  const netMonthlySalary = grossIncomeMonthly - feeMonthly;
  const savingsMonthly = grossIncomeMonthly - feeMonthly - totalExpenseMonthly;

  const commuteMinutesOneWay = asNumber(job.commuteMinutesOneWay);
  const baseWorkHoursPerDay = Math.min(actualWorkHoursPerDay, 8);
  const overtimeHoursPerDay = Math.max(0, onDutyHoursPerDay - 8);
  const commuteHoursPerDay = (commuteMinutesOneWay * 2) / 60;
  const workHoursMonthly = workdays * onDutyHoursPerDay;
  const onDutyHoursMonthly = workHoursMonthly;
  const restHoursMonthly = workdays * restHoursEffective;
  const actualWorkHoursMonthly = workdays * actualWorkHoursPerDay;
  const baseWorkHoursMonthly = workdays * baseWorkHoursPerDay;
  const overtimeHoursMonthly = workdays * overtimeHoursPerDay;
  const commuteHoursMonthly = workdays * commuteHoursPerDay;
  const timeHoursMonthly = workHoursMonthly + commuteHoursMonthly;
  const timeMinutesMonthly = timeHoursMonthly * 60;
  const timeSecondsMonthly = timeMinutesMonthly * 60;
  const totalHoursInMonth = 30 * 24;
  const workTimePercentage = (timeHoursMonthly / totalHoursInMonth) * 100;

  const period = state.period;
  const scale = period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1;
  const toPeriod = (monthly) => monthly * scale;
  const timeHoursPeriod = timeHoursMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const timeMinutesPeriod = timeMinutesMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const timeSecondsPeriod = timeSecondsMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const actualWorkHoursPeriod = actualWorkHoursMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const actualWorkSecondsPeriod = actualWorkHoursPeriod * 3600;

  const netIncomePeriod = toPeriod(netMonthlySalary);
  const housingExpensePeriod = toPeriod(monthlyRent);
  const commuteExpensePeriod = toPeriod(commuteMonthly);
  const foodExpensePeriod = toPeriod(foodMonthly);
  const totalExpensePeriod = toPeriod(totalExpenseMonthly);
  const grossIncomePeriod = toPeriod(grossIncomeMonthly);
  const feePeriod = toPeriod(feeMonthly);
  const savingsPeriod = toPeriod(savingsMonthly);

  const perSecond = actualWorkSecondsPeriod > 0 ? savingsPeriod / actualWorkSecondsPeriod : 0;
  const perMinute = actualWorkSecondsPeriod > 0 ? savingsPeriod / (actualWorkSecondsPeriod / 60) : 0;
  const perHour = actualWorkHoursPeriod > 0 ? savingsPeriod / actualWorkHoursPeriod : 0;
  const perSecondCommute = timeSecondsPeriod > 0 ? savingsPeriod / timeSecondsPeriod : 0;
  const perMinuteCommute = timeSecondsPeriod > 0 ? savingsPeriod / (timeSecondsPeriod / 60) : 0;
  const perHourCommute = timeHoursPeriod > 0 ? savingsPeriod / timeHoursPeriod : 0;
  const perMinuteIncome = actualWorkSecondsPeriod > 0 ? grossIncomePeriod / (actualWorkSecondsPeriod / 60) : 0;
  const perHourIncome = actualWorkHoursPeriod > 0 ? grossIncomePeriod / actualWorkHoursPeriod : 0;
  const perMinuteIncomeCommute = timeSecondsPeriod > 0 ? grossIncomePeriod / (timeSecondsPeriod / 60) : 0;
  const perHourIncomeCommute = timeHoursPeriod > 0 ? grossIncomePeriod / timeHoursPeriod : 0;

  const taxBreakdown = {
    taxItems: [
      { id: "us_fed", label: "联邦所得税（预扣）", amountMonthly: monthlyFed, hintRate: `申报 Single；${US_TAX_YEAR} IRS 累进` },
      {
        id: "us_state",
        label: st === "CA" ? "加利福尼亚州所得税" : "州所得税（德克萨斯无）",
        amountMonthly: monthlyState,
        hintRate: st === "TX" ? "无州个人所得税" : "CA FTB 累进（估算）",
      },
    ],
    welfareItems: [
      { id: "us_ss", label: "Social Security（雇员）", amountMonthly: ssAnnual / 12, employerHint: "雇主同额 6.2%（至工资基数上限）" },
      { id: "us_medicare", label: "Medicare（雇员）", amountMonthly: medicareAnnual / 12, employerHint: "雇主 1.45%（Medicare 另有规则）" },
    ],
  };

  return {
    grossMonthly,
    workdays,
    workdaysHint: `当前口径约 ${WORKDAY_MODES[job.workdayMode]?.workdays ?? workdays} 天/月（用于估算）`,
    medicalPersonal,
    medicalCompany,
    socialPersonal,
    socialCompany,
    hfPersonal,
    hfCompany,
    medicalBoth: medicalPersonal + medicalCompany,
    socialBoth: socialPersonal + socialCompany,
    hfBoth: hfPersonal + hfCompany,
    fiveInsHfDeductPersonal,
    fiveInsHfDeductCompany,
    fiveInsHfDeductBoth,
    taxExemptExtraMonthly,
    annualGross: grossMonthly * 12 + bonusAnnual,
    annualGrossAll,
    monthlyIIT,
    annualIIT,
    taxableAnnual,
    annualStdDeduction,
    annualInsDeduct,
    bracket,
    taxableMonthly,
    netMonthlySalary,
    totalExpenseMonthly,
    extraIncomeMonthly,
    grossIncomeMonthly,
    feeMonthly,
    savingsMonthly,
    grossIncomePeriod,
    feePeriod,
    netIncomePeriod,
    savingsPeriod,
    housingExpensePeriod,
    commuteExpensePeriod,
    foodExpensePeriod,
    totalExpensePeriod,
    timeHoursPeriod,
    timeSecondsPeriod,
    perSecond,
    perMinute,
    perHour,
    perMinuteIncome,
    perHourIncome,
    baseWorkHoursPerDay,
    overtimeHoursPerDay,
    commuteHoursPerDay,
    baseWorkHoursMonthly,
    overtimeHoursMonthly,
    commuteHoursMonthly,
    workTimePercentage,
    onDutyHoursPerDay,
    restHoursOnDuty: restHoursEffective,
    actualWorkHoursPerDay,
    onDutyHoursMonthly,
    restHoursMonthly,
    actualWorkHoursMonthly,
    actualWorkHoursPeriod,
    actualWorkSecondsPeriod,
    perSecondCommute,
    perMinuteCommute,
    perHourCommute,
    perMinuteIncomeCommute,
    perHourIncomeCommute,
    taxBreakdown,
    taxModel: "us",
    usTaxYear: US_TAX_YEAR,
    usStateCode: st,
    usFilingStatus: "Single",
    usAnnualFederal: annualFed,
    usAnnualState: annualState,
    usMonthlyFederal: monthlyFed,
    usMonthlyState: monthlyState,
    usMonthlyFica: monthlyFica,
    usAnnualFicaEmployee: ficaAnnual,
    usAnnualSsEmployee: ssAnnual,
    usAnnualMedicareEmployee: medicareAnnual,
  };
}

/** 香港：课税年度参数（对比用估算；更新时请核对 IRD / MPFA 公布值） */
const HK_TAX_YEAR_LABEL = "2024/25";
const HK_MPF_RELEVANT_INCOME_MIN = 7100;
const HK_MPF_RELEVANT_INCOME_CAP = 30000;
const HK_MPF_EMPLOYEE_MAX_MONTHLY = 1500;
const HK_MPF_EMPLOYEE_RATE = 0.05;
const HK_BASIC_ALLOWANCE_ANNUAL = 132000;
const HK_MARRIED_ALLOWANCE_ANNUAL = 264000;
const HK_MPF_MAX_TAX_DEDUCTION_ANNUAL = 18000;
const HK_STANDARD_SALARIES_RATE = 0.15;

function hkMpfEmployeeMonthly(relevantIncomeMonthly) {
  const x = Math.max(0, asNumber(relevantIncomeMonthly));
  if (x < HK_MPF_RELEVANT_INCOME_MIN) return 0;
  if (x <= HK_MPF_RELEVANT_INCOME_CAP) return x * HK_MPF_EMPLOYEE_RATE;
  return HK_MPF_EMPLOYEE_MAX_MONTHLY;
}

function hkProgressiveSalariesTax(netChargeableIncome) {
  let nci = Math.max(0, netChargeableIncome);
  let tax = 0;
  const bands = [
    { w: 50000, r: 0.02 },
    { w: 50000, r: 0.06 },
    { w: 50000, r: 0.1 },
    { w: 50000, r: 0.14 },
    { w: Infinity, r: 0.17 },
  ];
  for (const b of bands) {
    const take = b.w === Infinity ? nci : Math.min(nci, b.w);
    tax += take * b.r;
    nci -= take;
    if (nci <= 0) break;
  }
  return Math.max(0, tax);
}

function hkMarginalRateOnNci(nci) {
  let n = Math.max(0, nci);
  const widths = [50000, 50000, 50000, 50000];
  const rates = [0.02, 0.06, 0.1, 0.14];
  for (let i = 0; i < widths.length; i++) {
    if (n <= widths[i]) return rates[i];
    n -= widths[i];
  }
  return 0.17;
}

/**
 * 薪俸税：累进税率（净应课税入息）与标准税率（净入息，扣除后、免税额前）两者择低。
 * @returns {{ annualTax: number, netAssessable: number, netChargeable: number, mpfDedAnnual: number, progressive: number, standard: number, allowanceAnnual: number }}
 */
function hkSalariesTaxAnnualBundle(assessableAnnual, mpfEmployeeAnnual, allowanceAnnual) {
  const mpfDedAnnual = Math.min(Math.max(0, mpfEmployeeAnnual), HK_MPF_MAX_TAX_DEDUCTION_ANNUAL);
  const netAssessable = Math.max(0, assessableAnnual - mpfDedAnnual);
  const netChargeable = Math.max(0, netAssessable - Math.max(0, allowanceAnnual));
  const progressive = hkProgressiveSalariesTax(netChargeable);
  const standard = netAssessable * HK_STANDARD_SALARIES_RATE;
  const annualTax = Math.min(progressive, standard);
  return { annualTax, netAssessable, netChargeable, mpfDedAnnual, progressive, standard, allowanceAnnual };
}

function calcHongKong(job) {
  const baseSalary = asNumber(job.baseSalary);
  const perfSalary = asNumber(job.perfSalary);
  const grossMonthly = baseSalary + perfSalary;
  const bonusAnnual = baseSalary * asNumber(job.bonusCoef);

  const workdays = workdaysForMode(job.workdayMode);
  const workHoursPerDay = asNumber(job.workHoursPerDay);
  const onDutyHoursPerDay = Math.max(0, workHoursPerDay);
  const restHoursEffective = clampRestHoursOnDuty(job, onDutyHoursPerDay);
  const actualWorkHoursPerDay = Math.max(0, onDutyHoursPerDay - restHoursEffective);

  const extraIncomeMonthly = sumCustom(job.extraIncomes);
  const annualGrossAll = (grossMonthly + extraIncomeMonthly) * 12 + bonusAnnual;

  const monthlyMpfEmployee = hkMpfEmployeeMonthly(grossMonthly);
  const mpfEmployeeAnnual = monthlyMpfEmployee * 12;

  const marriedUseMarriedAllowance = job.hkMaritalStatus === "married" && job.hkAllowanceMode === "married";
  const allowanceAnnual = marriedUseMarriedAllowance ? HK_MARRIED_ALLOWANCE_ANNUAL : HK_BASIC_ALLOWANCE_ANNUAL;

  const bundle = hkSalariesTaxAnnualBundle(annualGrossAll, mpfEmployeeAnnual, allowanceAnnual);
  const annualIIT = bundle.annualTax;
  const monthlyIIT = annualIIT / 12;

  const medicalPersonal = 0;
  const medicalCompany = 0;
  const socialPersonal = 0;
  const socialCompany = 0;
  const hfPersonal = 0;
  const hfCompany = 0;
  const fiveInsHfDeductPersonal = monthlyMpfEmployee;
  const fiveInsHfDeductCompany = 0;
  const fiveInsHfDeductBoth = fiveInsHfDeductPersonal;
  const taxExemptExtraMonthly = 0;

  const taxableAnnual = bundle.netChargeable;
  const annualStdDeduction = allowanceAnnual;
  const annualInsDeduct = bundle.mpfDedAnnual;
  const bracket = { upTo: Infinity, rate: hkMarginalRateOnNci(bundle.netChargeable), quick: 0 };

  const taxBreakdown = {
    taxItems: [
      {
        id: "hk_salaries",
        label: "薪俸税（估算）",
        amountMonthly: monthlyIIT,
        hintRate: `课税年度 ${HK_TAX_YEAR_LABEL}；累进 vs ${fmtPctFromRate(HK_STANDARD_SALARIES_RATE)}% 标准税率取低`,
      },
    ],
    welfareItems: [
      {
        id: "hk_mpf_ee",
        label: "强积金（雇员）",
        amountMonthly: monthlyMpfEmployee,
        employerHint: `雇主一般 5%（至月薪有关入息上限时雇员封顶 ${fmtMoney(HK_MPF_EMPLOYEE_MAX_MONTHLY)}/月）`,
      },
    ],
  };

  const monthlyRent = asNumber(job.monthlyRent);
  const commuteCostOneWay = asNumber(job.commuteCostOneWay);
  const commuteMonthly = workdays * 2 * commuteCostOneWay;
  const foodDaily = asNumber(job.foodBreakfast) + asNumber(job.foodLunch) + asNumber(job.foodDinner) + asNumber(job.foodSnack);
  const foodMonthly = workdays * foodDaily;
  const extraExpenseMonthly = sumCustom(job.extraExpenses);
  const totalExpenseMonthly = monthlyRent + commuteMonthly + foodMonthly + extraExpenseMonthly;

  const grossIncomeMonthly = grossMonthly + extraIncomeMonthly + bonusAnnual / 12;
  const feeMonthly = fiveInsHfDeductPersonal + monthlyIIT;
  const netMonthlySalary = grossIncomeMonthly - feeMonthly;
  const savingsMonthly = grossIncomeMonthly - feeMonthly - totalExpenseMonthly;

  const commuteMinutesOneWay = asNumber(job.commuteMinutesOneWay);
  const baseWorkHoursPerDay = Math.min(actualWorkHoursPerDay, 8);
  const overtimeHoursPerDay = Math.max(0, onDutyHoursPerDay - 8);
  const commuteHoursPerDay = (commuteMinutesOneWay * 2) / 60;
  const workHoursMonthly = workdays * onDutyHoursPerDay;
  const onDutyHoursMonthly = workHoursMonthly;
  const restHoursMonthly = workdays * restHoursEffective;
  const actualWorkHoursMonthly = workdays * actualWorkHoursPerDay;
  const baseWorkHoursMonthly = workdays * baseWorkHoursPerDay;
  const overtimeHoursMonthly = workdays * overtimeHoursPerDay;
  const commuteHoursMonthly = workdays * commuteHoursPerDay;
  const timeHoursMonthly = workHoursMonthly + commuteHoursMonthly;
  const timeMinutesMonthly = timeHoursMonthly * 60;
  const timeSecondsMonthly = timeMinutesMonthly * 60;
  const totalHoursInMonth = 30 * 24;
  const workTimePercentage = (timeHoursMonthly / totalHoursInMonth) * 100;

  const period = state.period;
  const scale = period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1;
  const toPeriod = (monthly) => monthly * scale;
  const timeHoursPeriod = timeHoursMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const timeMinutesPeriod = timeMinutesMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const timeSecondsPeriod = timeSecondsMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const actualWorkHoursPeriod = actualWorkHoursMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const actualWorkSecondsPeriod = actualWorkHoursPeriod * 3600;

  const taxableMonthly = Math.max(0, grossMonthly - fiveInsHfDeductPersonal);

  const netIncomePeriod = toPeriod(netMonthlySalary);
  const housingExpensePeriod = toPeriod(monthlyRent);
  const commuteExpensePeriod = toPeriod(commuteMonthly);
  const foodExpensePeriod = toPeriod(foodMonthly);
  const totalExpensePeriod = toPeriod(totalExpenseMonthly);
  const grossIncomePeriod = toPeriod(grossIncomeMonthly);
  const feePeriod = toPeriod(feeMonthly);
  const savingsPeriod = toPeriod(savingsMonthly);

  const perSecond = actualWorkSecondsPeriod > 0 ? savingsPeriod / actualWorkSecondsPeriod : 0;
  const perMinute = actualWorkSecondsPeriod > 0 ? savingsPeriod / (actualWorkSecondsPeriod / 60) : 0;
  const perHour = actualWorkHoursPeriod > 0 ? savingsPeriod / actualWorkHoursPeriod : 0;
  const perSecondCommute = timeSecondsPeriod > 0 ? savingsPeriod / timeSecondsPeriod : 0;
  const perMinuteCommute = timeSecondsPeriod > 0 ? savingsPeriod / (timeSecondsPeriod / 60) : 0;
  const perHourCommute = timeHoursPeriod > 0 ? savingsPeriod / timeHoursPeriod : 0;
  const perMinuteIncome = actualWorkSecondsPeriod > 0 ? grossIncomePeriod / (actualWorkSecondsPeriod / 60) : 0;
  const perHourIncome = actualWorkHoursPeriod > 0 ? grossIncomePeriod / actualWorkHoursPeriod : 0;
  const perMinuteIncomeCommute = timeSecondsPeriod > 0 ? grossIncomePeriod / (timeSecondsPeriod / 60) : 0;
  const perHourIncomeCommute = timeHoursPeriod > 0 ? grossIncomePeriod / timeHoursPeriod : 0;

  return {
    grossMonthly,
    workdays,
    workdaysHint: `当前口径约 ${WORKDAY_MODES[job.workdayMode]?.workdays ?? workdays} 天/月（用于估算）`,
    medicalPersonal,
    medicalCompany,
    socialPersonal,
    socialCompany,
    hfPersonal,
    hfCompany,
    medicalBoth: medicalPersonal + medicalCompany,
    socialBoth: socialPersonal + socialCompany,
    hfBoth: hfPersonal + hfCompany,
    fiveInsHfDeductPersonal,
    fiveInsHfDeductCompany,
    fiveInsHfDeductBoth,
    taxExemptExtraMonthly,
    annualGross: grossMonthly * 12 + bonusAnnual,
    annualGrossAll,
    monthlyIIT,
    annualIIT,
    taxableAnnual,
    annualStdDeduction,
    annualInsDeduct,
    bracket,
    taxableMonthly,
    netMonthlySalary,
    totalExpenseMonthly,
    extraIncomeMonthly,
    grossIncomeMonthly,
    feeMonthly,
    savingsMonthly,
    grossIncomePeriod,
    feePeriod,
    netIncomePeriod,
    savingsPeriod,
    housingExpensePeriod,
    commuteExpensePeriod,
    foodExpensePeriod,
    totalExpensePeriod,
    timeHoursPeriod,
    timeSecondsPeriod,
    perSecond,
    perMinute,
    perHour,
    perMinuteIncome,
    perHourIncome,
    baseWorkHoursPerDay,
    overtimeHoursPerDay,
    commuteHoursPerDay,
    baseWorkHoursMonthly,
    overtimeHoursMonthly,
    commuteHoursMonthly,
    workTimePercentage,
    onDutyHoursPerDay,
    restHoursOnDuty: restHoursEffective,
    actualWorkHoursPerDay,
    onDutyHoursMonthly,
    restHoursMonthly,
    actualWorkHoursMonthly,
    actualWorkHoursPeriod,
    actualWorkSecondsPeriod,
    perSecondCommute,
    perMinuteCommute,
    perHourCommute,
    perMinuteIncomeCommute,
    perHourIncomeCommute,
    taxBreakdown,
    taxModel: "hk",
    hkTaxYearLabel: HK_TAX_YEAR_LABEL,
    hkAnnualMpfEmployee: mpfEmployeeAnnual,
    hkAnnualSalariesTax: annualIIT,
    hkNetAssessableIncome: bundle.netAssessable,
    hkNetChargeableIncome: bundle.netChargeable,
    hkProgressiveTax: bundle.progressive,
    hkStandardTax: bundle.standard,
    hkMpfTaxDeductionAnnual: bundle.mpfDedAnnual,
    hkAllowanceAnnual: allowanceAnnual,
  };
}

/** 不计税费：收入与开支时间口径同中国列，税费与扣缴为 0 */
function calcNoTax(job) {
  const baseSalary = asNumber(job.baseSalary);
  const perfSalary = asNumber(job.perfSalary);
  const grossMonthly = baseSalary + perfSalary;
  const bonusAnnual = baseSalary * asNumber(job.bonusCoef);

  const workdays = workdaysForMode(job.workdayMode);
  const workHoursPerDay = asNumber(job.workHoursPerDay);
  const onDutyHoursPerDay = Math.max(0, workHoursPerDay);
  const restHoursEffective = clampRestHoursOnDuty(job, onDutyHoursPerDay);
  const actualWorkHoursPerDay = Math.max(0, onDutyHoursPerDay - restHoursEffective);

  const extraIncomeMonthly = sumCustom(job.extraIncomes);
  const taxExemptExtraMonthly = asNumber(job.taxExemptExtraMonthly);

  const medicalPersonal = 0;
  const medicalCompany = 0;
  const socialPersonal = 0;
  const socialCompany = 0;
  const hfPersonal = 0;
  const hfCompany = 0;
  const fiveInsHfDeductPersonal = 0;
  const fiveInsHfDeductCompany = 0;
  const fiveInsHfDeductBoth = 0;

  const annualGrossAll = (grossMonthly + extraIncomeMonthly) * 12 + bonusAnnual;
  const annualStdDeduction = 0;
  const annualInsDeduct = 0;
  const taxableAnnual = 0;
  const monthlyIIT = 0;
  const annualIIT = 0;
  const bracket = IIT_ANNUAL[0];
  const taxBreakdown = { taxItems: [], welfareItems: [] };

  const monthlyRent = asNumber(job.monthlyRent);
  const commuteCostOneWay = asNumber(job.commuteCostOneWay);
  const commuteMonthly = workdays * 2 * commuteCostOneWay;
  const foodDaily = asNumber(job.foodBreakfast) + asNumber(job.foodLunch) + asNumber(job.foodDinner) + asNumber(job.foodSnack);
  const foodMonthly = workdays * foodDaily;
  const extraExpenseMonthly = sumCustom(job.extraExpenses);
  const totalExpenseMonthly = monthlyRent + commuteMonthly + foodMonthly + extraExpenseMonthly;

  const grossIncomeMonthly = grossMonthly + extraIncomeMonthly + bonusAnnual / 12;
  const feeMonthly = 0;
  const netMonthlySalary = grossIncomeMonthly - feeMonthly;
  const savingsMonthly = grossIncomeMonthly - feeMonthly - totalExpenseMonthly;

  const commuteMinutesOneWay = asNumber(job.commuteMinutesOneWay);
  const baseWorkHoursPerDay = Math.min(actualWorkHoursPerDay, 8);
  const overtimeHoursPerDay = Math.max(0, onDutyHoursPerDay - 8);
  const commuteHoursPerDay = (commuteMinutesOneWay * 2) / 60;
  const workHoursMonthly = workdays * onDutyHoursPerDay;
  const onDutyHoursMonthly = workHoursMonthly;
  const restHoursMonthly = workdays * restHoursEffective;
  const actualWorkHoursMonthly = workdays * actualWorkHoursPerDay;
  const baseWorkHoursMonthly = workdays * baseWorkHoursPerDay;
  const overtimeHoursMonthly = workdays * overtimeHoursPerDay;
  const commuteHoursMonthly = workdays * commuteHoursPerDay;
  const timeHoursMonthly = workHoursMonthly + commuteHoursMonthly;
  const timeMinutesMonthly = timeHoursMonthly * 60;
  const timeSecondsMonthly = timeMinutesMonthly * 60;
  const totalHoursInMonth = 30 * 24;
  const workTimePercentage = (timeHoursMonthly / totalHoursInMonth) * 100;

  const period = state.period;
  const scale = period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1;
  const toPeriod = (monthly) => monthly * scale;
  const timeHoursPeriod = timeHoursMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const timeMinutesPeriod = timeMinutesMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const timeSecondsPeriod = timeSecondsMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const actualWorkHoursPeriod = actualWorkHoursMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const actualWorkSecondsPeriod = actualWorkHoursPeriod * 3600;

  const taxableMonthly = Math.max(0, grossMonthly);

  const netIncomePeriod = toPeriod(netMonthlySalary);
  const housingExpensePeriod = toPeriod(monthlyRent);
  const commuteExpensePeriod = toPeriod(commuteMonthly);
  const foodExpensePeriod = toPeriod(foodMonthly);
  const totalExpensePeriod = toPeriod(totalExpenseMonthly);
  const grossIncomePeriod = toPeriod(grossIncomeMonthly);
  const feePeriod = toPeriod(feeMonthly);
  const savingsPeriod = toPeriod(savingsMonthly);

  const perSecond = actualWorkSecondsPeriod > 0 ? savingsPeriod / actualWorkSecondsPeriod : 0;
  const perMinute = actualWorkSecondsPeriod > 0 ? savingsPeriod / (actualWorkSecondsPeriod / 60) : 0;
  const perHour = actualWorkHoursPeriod > 0 ? savingsPeriod / actualWorkHoursPeriod : 0;
  const perSecondCommute = timeSecondsPeriod > 0 ? savingsPeriod / timeSecondsPeriod : 0;
  const perMinuteCommute = timeSecondsPeriod > 0 ? savingsPeriod / (timeSecondsPeriod / 60) : 0;
  const perHourCommute = timeHoursPeriod > 0 ? savingsPeriod / timeHoursPeriod : 0;
  const perMinuteIncome = actualWorkSecondsPeriod > 0 ? grossIncomePeriod / (actualWorkSecondsPeriod / 60) : 0;
  const perHourIncome = actualWorkHoursPeriod > 0 ? grossIncomePeriod / actualWorkHoursPeriod : 0;
  const perMinuteIncomeCommute = timeSecondsPeriod > 0 ? grossIncomePeriod / (timeSecondsPeriod / 60) : 0;
  const perHourIncomeCommute = timeHoursPeriod > 0 ? grossIncomePeriod / timeHoursPeriod : 0;

  return {
    grossMonthly,
    workdays,
    workdaysHint: `当前口径约 ${WORKDAY_MODES[job.workdayMode]?.workdays ?? workdays} 天/月（用于估算）`,
    medicalPersonal,
    medicalCompany,
    socialPersonal,
    socialCompany,
    hfPersonal,
    hfCompany,
    medicalBoth: 0,
    socialBoth: 0,
    hfBoth: 0,
    fiveInsHfDeductPersonal,
    fiveInsHfDeductCompany,
    fiveInsHfDeductBoth,
    taxExemptExtraMonthly,
    annualGross: grossMonthly * 12 + bonusAnnual,
    annualGrossAll,
    monthlyIIT,
    annualIIT,
    taxableAnnual,
    annualStdDeduction,
    annualInsDeduct,
    bracket,
    taxableMonthly,
    netMonthlySalary,
    totalExpenseMonthly,
    extraIncomeMonthly,
    grossIncomeMonthly,
    feeMonthly,
    savingsMonthly,
    grossIncomePeriod,
    feePeriod,
    netIncomePeriod,
    savingsPeriod,
    housingExpensePeriod,
    commuteExpensePeriod,
    foodExpensePeriod,
    totalExpensePeriod,
    timeHoursPeriod,
    timeSecondsPeriod,
    perSecond,
    perMinute,
    perHour,
    perMinuteIncome,
    perHourIncome,
    baseWorkHoursPerDay,
    overtimeHoursPerDay,
    commuteHoursPerDay,
    baseWorkHoursMonthly,
    overtimeHoursMonthly,
    commuteHoursMonthly,
    workTimePercentage,
    onDutyHoursPerDay,
    restHoursOnDuty: restHoursEffective,
    actualWorkHoursPerDay,
    onDutyHoursMonthly,
    restHoursMonthly,
    actualWorkHoursMonthly,
    actualWorkHoursPeriod,
    actualWorkSecondsPeriod,
    perSecondCommute,
    perMinuteCommute,
    perHourCommute,
    perMinuteIncomeCommute,
    perHourIncomeCommute,
    taxBreakdown,
    taxModel: "none",
  };
}

function calcChina(job) {
  const baseSalary = asNumber(job.baseSalary);
  const perfSalary = asNumber(job.perfSalary);
  const grossMonthly = baseSalary + perfSalary;
  const bonusAnnual = baseSalary * asNumber(job.bonusCoef);

  const workdays = workdaysForMode(job.workdayMode);
  const workHoursPerDay = asNumber(job.workHoursPerDay);
  const onDutyHoursPerDay = Math.max(0, workHoursPerDay);
  const restHoursEffective = clampRestHoursOnDuty(job, onDutyHoursPerDay);
  const actualWorkHoursPerDay = Math.max(0, onDutyHoursPerDay - restHoursEffective);

  const hasSI = job.hasSocialInsurance === "yes";
  const siBase = hasSI ? asNumber(job.siBase) : 0;

  const hasHF = job.hasHousingFund === "yes";
  const hfBase = hasHF ? asNumber(job.hfBase) : 0;
  const hfRate = hasHF ? clamp(asNumber(job.hfRatePct) / 100, 0.05, 0.12) : 0;

  // 社保（估算）
  const pensionP = siBase * RATES.pensionPersonal;
  const pensionC = siBase * RATES.pensionCompany;
  const medicalP = siBase * RATES.medicalPersonal;
  const medicalC = siBase * RATES.medicalCompany;
  const unempP = siBase * RATES.unemploymentPersonal;
  const unempC = siBase * RATES.unemploymentCompany;
  const injuryC = siBase * RATES.injuryCompany;
  const maternityC = siBase * RATES.maternityCompany;

  const socialPersonal = pensionP + unempP; // 口径：社保缴纳（不含医保）
  const socialCompany = pensionC + unempC + injuryC + maternityC;
  const medicalPersonal = medicalP;
  const medicalCompany = medicalC;

  // 公积金
  const hfPersonal = hfBase * hfRate;
  const hfCompany = hfBase * hfRate;

  // 税前额外收入（按月）
  const extraIncomeMonthly = sumCustom(job.extraIncomes); // 口径：税前（用于收入汇总与个税估算）

  // 个税（估算口径）：按“所有税前收入”估算年度应纳税所得额
  const taxExemptExtraMonthly = asNumber(job.taxExemptExtraMonthly);
  const fiveInsHfDeductPersonal = socialPersonal + medicalPersonal + hfPersonal;
  const fiveInsHfDeductCompany = socialCompany + medicalCompany + hfCompany;
  const fiveInsHfDeductBoth = fiveInsHfDeductPersonal + fiveInsHfDeductCompany;
  const annualGrossAll = (grossMonthly + extraIncomeMonthly) * 12 + bonusAnnual;
  const annualStdDeduction = 60000;
  const annualInsDeduct = fiveInsHfDeductPersonal * 12; // 仅用于明细展示的对比项
  const taxableAnnual = Math.max(0, annualGrossAll - annualStdDeduction - annualInsDeduct - taxExemptExtraMonthly * 12);
  const { tax: annualIIT, bracket } = calcAnnualIIT(taxableAnnual);
  const monthlyIIT = annualIIT / 12;

  const brRg = iitBracketRange(bracket);
  const upperT = Number.isFinite(brRg.upper) ? fmtMoney(brRg.upper) : "∞";
  const taxBreakdown = {
    taxItems: [
      {
        id: "cn_iit",
        label: "综合所得个人所得税（估算）",
        amountMonthly: monthlyIIT,
        hintRate: `七级超额累进 边际 ${fmtPctFromRate(bracket.rate)}% 档位 (${fmtMoney(brRg.lower)},${upperT}]`,
      },
    ],
    welfareItems: [
      { id: "cn_pension_p", label: "基本养老保险（个人）", amountMonthly: pensionP, employerHint: `企业 ${fmtPctFromRate(RATES.pensionCompany)}%` },
      { id: "cn_unemp_p", label: "失业保险（个人）", amountMonthly: unempP, employerHint: `企业 ${fmtPctFromRate(RATES.unemploymentCompany)}% 等` },
      { id: "cn_medical_p", label: "基本医疗保险（个人）", amountMonthly: medicalP, employerHint: `企业 ${fmtPctFromRate(RATES.medicalCompany)}%` },
      {
        id: "cn_hf_p",
        label: "住房公积金（个人）",
        amountMonthly: hfPersonal,
        employerHint: hasHF ? `企业同比例 ${clamp(asNumber(job.hfRatePct), 5, 12)}%` : "未缴纳",
      },
    ],
  };

  // 支出（月）
  const monthlyRent = asNumber(job.monthlyRent);
  const commuteCostOneWay = asNumber(job.commuteCostOneWay);
  const commuteMonthly = workdays * 2 * commuteCostOneWay;

  const foodDaily = asNumber(job.foodBreakfast) + asNumber(job.foodLunch) + asNumber(job.foodDinner) + asNumber(job.foodSnack);
  // 口径：按“每天”统计即可，不需要再乘 2
  const foodMonthly = workdays * foodDaily;

  const extraExpenseMonthly = sumCustom(job.extraExpenses);
  const totalExpenseMonthly = monthlyRent + commuteMonthly + foodMonthly + extraExpenseMonthly;

  // 收入/费用/积蓄（月基准）
  const grossIncomeMonthly = grossMonthly + extraIncomeMonthly + bonusAnnual / 12;
  const feeMonthly = fiveInsHfDeductPersonal + monthlyIIT;
  const netMonthlySalary = grossIncomeMonthly - feeMonthly;
  const savingsMonthly = grossIncomeMonthly - feeMonthly - totalExpenseMonthly;

  // 时间（月）
  const commuteMinutesOneWay = asNumber(job.commuteMinutesOneWay);
  const baseWorkHoursPerDay = Math.min(actualWorkHoursPerDay, 8);
  const overtimeHoursPerDay = Math.max(0, onDutyHoursPerDay - 8);
  const commuteHoursPerDay = (commuteMinutesOneWay * 2) / 60;

  const workHoursMonthly = workdays * onDutyHoursPerDay;
  const onDutyHoursMonthly = workHoursMonthly;
  const restHoursMonthly = workdays * restHoursEffective;
  const actualWorkHoursMonthly = workdays * actualWorkHoursPerDay;
  const baseWorkHoursMonthly = workdays * baseWorkHoursPerDay;
  const overtimeHoursMonthly = workdays * overtimeHoursPerDay;
  const commuteHoursMonthly = workdays * commuteHoursPerDay;
  const timeHoursMonthly = workHoursMonthly + commuteHoursMonthly;
  const timeMinutesMonthly = timeHoursMonthly * 60;
  const timeSecondsMonthly = timeMinutesMonthly * 60;

  // 月度工作时间占全月时间的百分比（全月按30天计算）
  const totalHoursInMonth = 30 * 24;
  const workTimePercentage = (timeHoursMonthly / totalHoursInMonth) * 100;

  // 按 period 缩放展示
  const period = state.period;
  const scale = period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1;

  const toPeriod = (monthly) => monthly * scale;
  const timeHoursPeriod = timeHoursMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const timeMinutesPeriod = timeMinutesMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const timeSecondsPeriod = timeSecondsMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const actualWorkHoursPeriod = actualWorkHoursMonthly * (period === PERIODS.year ? 12 : period === PERIODS.day ? 1 / workdays : 1);
  const actualWorkSecondsPeriod = actualWorkHoursPeriod * 3600;

  const taxableMonthly = Math.max(0, grossMonthly - fiveInsHfDeductPersonal - 5000 - taxExemptExtraMonthly);

  const netIncomePeriod = toPeriod(netMonthlySalary);
  const housingExpensePeriod = toPeriod(monthlyRent);
  const commuteExpensePeriod = toPeriod(commuteMonthly);
  const foodExpensePeriod = toPeriod(foodMonthly);
  const totalExpensePeriod = toPeriod(totalExpenseMonthly);
  const grossIncomePeriod = toPeriod(grossIncomeMonthly);
  const feePeriod = toPeriod(feeMonthly);
  const savingsPeriod = toPeriod(savingsMonthly);

  const perSecond = actualWorkSecondsPeriod > 0 ? savingsPeriod / actualWorkSecondsPeriod : 0;
  const perMinute = actualWorkSecondsPeriod > 0 ? savingsPeriod / (actualWorkSecondsPeriod / 60) : 0;
  const perHour = actualWorkHoursPeriod > 0 ? savingsPeriod / actualWorkHoursPeriod : 0;
  const perSecondCommute = timeSecondsPeriod > 0 ? savingsPeriod / timeSecondsPeriod : 0;
  const perMinuteCommute = timeSecondsPeriod > 0 ? savingsPeriod / (timeSecondsPeriod / 60) : 0;
  const perHourCommute = timeHoursPeriod > 0 ? savingsPeriod / timeHoursPeriod : 0;
  const perMinuteIncome = actualWorkSecondsPeriod > 0 ? grossIncomePeriod / (actualWorkSecondsPeriod / 60) : 0;
  const perHourIncome = actualWorkHoursPeriod > 0 ? grossIncomePeriod / actualWorkHoursPeriod : 0;
  const perMinuteIncomeCommute = timeSecondsPeriod > 0 ? grossIncomePeriod / (timeSecondsPeriod / 60) : 0;
  const perHourIncomeCommute = timeHoursPeriod > 0 ? grossIncomePeriod / timeHoursPeriod : 0;

  return {
    grossMonthly,
    workdays,
    workdaysHint: `当前口径约 ${WORKDAY_MODES[job.workdayMode]?.workdays ?? workdays} 天/月（用于估算）`,

    // insurance
    medicalPersonal,
    medicalCompany,
    socialPersonal,
    socialCompany,
    hfPersonal,
    hfCompany,
    medicalBoth: medicalPersonal + medicalCompany,
    socialBoth: socialPersonal + socialCompany,
    hfBoth: hfPersonal + hfCompany,
    fiveInsHfDeductPersonal,
    fiveInsHfDeductCompany,
    fiveInsHfDeductBoth,
    taxExemptExtraMonthly,
    annualGross: grossMonthly * 12 + bonusAnnual,
    annualGrossAll,

    // incomes/expenses (monthly base)
    monthlyIIT,
    annualIIT,
    taxableAnnual,
    annualStdDeduction,
    annualInsDeduct,
    bracket,

    taxableMonthly,
    netMonthlySalary,

    totalExpenseMonthly,
    extraIncomeMonthly,
    grossIncomeMonthly,
    feeMonthly,
    savingsMonthly,

    // period outputs
    grossIncomePeriod,
    feePeriod,
    netIncomePeriod,
    savingsPeriod,
    housingExpensePeriod,
    commuteExpensePeriod,
    foodExpensePeriod,
    totalExpensePeriod,
    timeHoursPeriod,
    timeSecondsPeriod,
    perSecond,
    perMinute,
    perHour,
    perMinuteIncome,
    perHourIncome,
    
    // time breakdown
    baseWorkHoursPerDay,
    overtimeHoursPerDay,
    commuteHoursPerDay,
    baseWorkHoursMonthly,
    overtimeHoursMonthly,
    commuteHoursMonthly,
    workTimePercentage,
    onDutyHoursPerDay,
    restHoursOnDuty: restHoursEffective,
    actualWorkHoursPerDay,
    onDutyHoursMonthly,
    restHoursMonthly,
    actualWorkHoursMonthly,
    actualWorkHoursPeriod,
    actualWorkSecondsPeriod,
    perSecondCommute,
    perMinuteCommute,
    perHourCommute,
    perMinuteIncomeCommute,
    perHourIncomeCommute,
    taxBreakdown,
    taxModel: "cn",
  };
}

function calc(job) {
  const m = getTaxModel(job);
  if (m === "none" || m === "pending") return calcNoTax(job);
  if (m === "us") return calcUsW2(job);
  if (m === "hk") return calcHongKong(job);
  return calcChina(job);
}

function periodLabel() {
  return state.period === PERIODS.day ? "按日(工作日)" : state.period === PERIODS.year ? "按年" : "按月";
}

function jobDisplayName(job, idx) {
  const name = String(job?.name || "").trim();
  return name ? name : `工作 ${idx + 1}`;
}

function metricCellHtml(name, hint) {
  return `
    <div class="compare-metric">
      <div class="compare-metric__name">${escapeHtml(name)}</div>
      <div class="compare-metric__hint">${hint}</div>
    </div>
  `;
}

/** @param {string} emoji @param {string} labelText @param {string} hint */
function prefixedMetricCellHtml(emoji, labelText, hint) {
  return metricCellHtml(`${emoji} ${labelText}`, hint);
}

/** @param {"taxItems"|"welfareItems"} listKey */
function breakDownRowEmoji(listKey) {
  return listKey === "taxItems" ? "🧾" : "🛡";
}

function valueCellHtml(v, kind) {
  const cls = ["compare-val"];
  if (kind === "pos") cls.push("pos");
  if (kind === "neg") cls.push("neg");
  return `<div class="${cls.join(" ")}">${escapeHtml(v)}</div>`;
}

function fmtPctFromRate(rate) {
  const v = Math.round(rate * 1000) / 10;
  return v.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

/** 税负比等百分比（至多 2 位小数） */
function fmtPctRatioDisplay(pct) {
  if (!Number.isFinite(pct)) return "—";
  return `${(Math.round(pct * 100) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 0 })}%`;
}

function valueCellHtmlWithSub(main, sub, kind) {
  const cls = ["compare-val"];
  if (kind === "pos") cls.push("pos");
  if (kind === "neg") cls.push("neg");
  const safeMain = escapeHtml(main);
  const safeSub = escapeHtml(sub);
  return `<div class="${cls.join(" ")}"><div>${safeMain}</div><div class="compare-val__sub">${safeSub}</div></div>`;
}

/**
 * 灰字：收入货币金额 → 比较货币金额（仅跨币种且汇率有效）。
 * @param {any} job
 * @param {any} c
 * @param {number} amountComp 已换算为比较货币的数值（与主行一致，可正可负）
 */
function fxOriginalToCompareSubText(job, c, amountComp) {
  const inc = MAJOR_CURRENCY_CODES.has(job.incomeCurrency) ? job.incomeCurrency : "CNY";
  const cc = getCompareCurrencyCode();
  if (inc === cc) return "";
  if (c._fxInvalid) return "";
  const r = c._fxRate;
  if (r == null || !Number.isFinite(r) || r <= 0) return "";
  if (!Number.isFinite(amountComp)) return "";
  const amountInc = amountComp / r;
  return `${fmtMoney(amountInc)} ${inc} → ${fmtMoney(amountComp)} ${cc}`;
}

/**
 * @param {any} job
 * @param {any} c
 * @param {number} amountComp
 * @param {"pos"|"neg"|undefined} kind
 */
function valueCellHtmlMoneyFx(job, c, amountComp, kind) {
  const main = fmtMoneyWithUnit(amountComp);
  const sub = fxOriginalToCompareSubText(job, c, amountComp);
  if (!sub) return valueCellHtml(main, kind);
  return valueCellHtmlWithSub(main, sub, kind);
}

/**
 * 主行已自定义格式（如 CNY/分钟）时，仍用同一比较币标量换算灰字。
 * @param {any} job
 * @param {any} c
 * @param {number} amountComp
 * @param {string} mainDisplay
 * @param {"pos"|"neg"|undefined} kind
 */
function valueCellHtmlMoneyFxCustomMain(job, c, amountComp, mainDisplay, kind) {
  const sub = fxOriginalToCompareSubText(job, c, amountComp);
  if (!sub) return valueCellHtml(mainDisplay, kind);
  return valueCellHtmlWithSub(mainDisplay, sub, kind);
}

function ensureSingleCustom(job, key, defaultName) {
  const arr = Array.isArray(job[key]) ? job[key] : [];
  if (arr.length === 0) arr.push({ name: defaultName, amount: 0 });
  if (!arr[0]) arr[0] = { name: defaultName, amount: 0 };
  if (!("amount" in arr[0])) arr[0].amount = 0;
  if (!("name" in arr[0])) arr[0].name = defaultName;
  job[key] = arr;
  return arr[0];
}

function inputHtml(jobId, field, type, value, extra = "", job = null) {
  const isNumber = type === "number";
  const pendKey = comparePendingInputKey(jobId, field);
  const pending =
    isNumber && compareInputDisplayPending.has(pendKey) ? compareInputDisplayPending.get(pendKey) : undefined;
  const v = pending !== undefined ? pending : value ?? "";
  const safeValue = escapeHtml(String(v));
  // 避免 number input 在部分浏览器/IME 下出现光标/选区异常（重渲染后易把光标锁在左侧）
  // 数值输入统一用 text + inputmode，解析仍按 number 处理
  const actualType = isNumber ? "text" : type;
  const cls = actualType === "text" ? "compare-input compare-input--text" : "compare-input";
  const numFlag = isNumber ? 'data-input-type="number"' : "";
  let titleAttr = "";
  if (job && isNumber) {
    if (INCOME_CURRENCY_HINT_FIELDS.has(field)) {
      const code = MAJOR_CURRENCY_CODES.has(job.incomeCurrency) ? job.incomeCurrency : "CNY";
      titleAttr = ` title="${escapeHtml(`金额单位：${code}`)}"`;
    } else if (field === "commuteMinutesOneWay") {
      titleAttr = ` title="${escapeHtml("单位：分钟")}"`;
    } else if (field === "workHoursPerDay" || field === "restHoursOnDuty") {
      titleAttr = ` title="${escapeHtml("单位：小时")}"`;
    } else if (field === "hfRatePct") {
      titleAttr = ` title="${escapeHtml("单位：%")}"`;
    } else if (field === "bonusCoef") {
      titleAttr = ` title="${escapeHtml("税前年终系数（无单位）")}"`;
    }
  }
  const inputEl = `<input class="${cls}" ${numFlag} data-job-id="${escapeHtml(jobId)}" data-field="${escapeHtml(field)}" type="${escapeHtml(actualType)}" value="${safeValue}" ${extra}${titleAttr} />`;
  if (isNumber && job) {
    const suf = getCompareInputSuffix(field, job);
    if (suf) {
      return `<div class="compare-input-field">${inputEl}<span class="compare-input-suffix" aria-hidden="true">${escapeHtml(suf)}</span></div>`;
    }
  }
  return inputEl;
}

function selectHtml(jobId, field, value, options) {
  const opts = options
    .map((o) => {
      const selected = String(value) === String(o.value) ? "selected" : "";
      return `<option value="${escapeHtml(o.value)}" ${selected}>${escapeHtml(o.label)}</option>`;
    })
    .join("");
  return `<select class="compare-input compare-input--text" data-job-id="${escapeHtml(jobId)}" data-field="${escapeHtml(field)}">${opts}</select>`;
}

function actionsHtml(jobId) {
  return `
    <div class="compare-actions">
      <button class="icon-btn" data-action="showTax" data-job-id="${escapeHtml(jobId)}" type="button" title="个税细节">税</button>
      <button class="icon-btn" data-action="duplicate" data-job-id="${escapeHtml(jobId)}" type="button" title="复制一列">⧉</button>
      <button class="icon-btn danger" data-action="delete" data-job-id="${escapeHtml(jobId)}" type="button" title="删除这一列">🗑</button>
    </div>
  `;
}

function incomeCurrencyOptionsHtml(selectedCode) {
  const cur = MAJOR_CURRENCY_CODES.has(selectedCode) ? selectedCode : "CNY";
  return MAJOR_CURRENCIES.map(
    (o) => `<option value="${escapeHtml(o.code)}" ${o.code === cur ? "selected" : ""}>${escapeHtml(o.label)}</option>`
  ).join("");
}

/** 一级经济体关键词 → 默认收入货币与税制（表头「国家/地区」失焦时尝试套用） */
const ECONOMY_REGION_DEFAULTS = [
  { re: /(中国大陆|中华人民共和国|^中国$)/, currency: "CNY", taxModel: "cn" },
  { re: /(中国香港|香港特别行政区|^香港$|Hong\s*Kong)/i, currency: "HKD", taxModel: "hk" },
  { re: /(美国|美國|United\s*States|\bUSA?\b|\bUS\b)/i, currency: "USD", taxModel: "us" },
];

/** 表头「国家/地区」下拉固定选项（与旧 datalist 对齐） */
const PRIMARY_REGION_OPTIONS = [
  "中国大陆",
  "中国香港",
  "中国台湾",
  "美国",
  "英国",
  "日本",
  "韩国",
  "新加坡",
  "澳大利亚",
  "加拿大",
  "德国",
  "法国",
  "印度",
  "阿联酋",
  "全球 / 远程",
  "其他",
];

/** 国家/地区下拉中不标注「（待实装）」的已接入项 */
const PRIMARY_REGION_IMPLEMENTED = new Set(["中国大陆", "中国香港", "美国"]);

/** @param {string} value */
function primaryRegionOptionLabel(value) {
  if (PRIMARY_REGION_IMPLEMENTED.has(value)) return value;
  return `${value}（待实装）`;
}

/** 未实装国家/地区 → 默认收入货币（与地区常见本币一致） */
const REGION_PENDING_INCOME_CURRENCY = {
  中国台湾: "TWD",
  英国: "GBP",
  日本: "JPY",
  韩国: "KRW",
  新加坡: "SGD",
  澳大利亚: "AUD",
  加拿大: "CAD",
  德国: "EUR",
  法国: "EUR",
  印度: "INR",
  阿联酋: "AED",
  "全球 / 远程": "CNY",
  其他: "CNY",
};

/** 美国州：中文名 + 缩写；pending 表示州税模型未接入，选项后缀「（待实装）」 */
const US_STATE_OPTION_META = [
  { code: "MA", label: "马萨诸塞州 MA", pending: true },
  { code: "CA", label: "加利福尼亚州 CA", pending: false },
  { code: "TX", label: "德克萨斯州 TX", pending: false },
  { code: "NY", label: "纽约州 NY", pending: true },
  { code: "NJ", label: "新泽西州 NJ", pending: true },
  { code: "WA", label: "华盛顿州 WA", pending: false },
];

/** @param {unknown} raw */
function normalizePrimaryRegion(raw) {
  const s = String(raw ?? "").trim();
  return PRIMARY_REGION_OPTIONS.includes(s) ? s : "中国大陆";
}

/** @param {unknown} raw @returns {"MA"|"CA"|"TX"|"NY"|"NJ"|"WA"} */
function normalizeUsState(raw) {
  const u = String(raw ?? "").toUpperCase();
  if (u === "MA" || u === "CA" || u === "TX" || u === "NY" || u === "NJ" || u === "WA") return u;
  return "TX";
}

/**
 * 将存档中的 subRegion（州码或中文州名）解析为州码；用于美国档与旧数据迁移。
 * @param {unknown} raw
 * @returns {"MA"|"CA"|"TX"|"NY"|"NJ"|"WA"}
 */
function subRegionToUsStateCode(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "TX";
  const u = s.toUpperCase();
  if (u.length === 2 && (u === "MA" || u === "CA" || u === "TX" || u === "NY" || u === "NJ" || u === "WA")) return u;
  for (const { code, label } of US_STATE_OPTION_META) {
    const nameZh = label.replace(/\s+[A-Z]{2}\s*$/, "").trim();
    if (s === label || s === code || label.includes(s) || nameZh.includes(s) || s.includes(nameZh)) return code;
  }
  return normalizeUsState(s);
}

/** @param {unknown} region */
function regionEconomyTier(region) {
  const r = String(region ?? "").trim();
  if (/(中国大陆|中华人民共和国|^中国$)/.test(r)) return "cn";
  if (/(中国香港|香港特别行政区|^香港$|Hong\s*Kong)/i.test(r)) return "hk";
  if (/(美国|美國|United\s*States|\bUSA?\b|\bUS\b)/i.test(r)) return "us";
  return "other";
}

/** @param {string} region */
function incomeCurrencyForPendingRegion(region) {
  const r = normalizePrimaryRegion(region);
  const c = REGION_PENDING_INCOME_CURRENCY[r];
  return MAJOR_CURRENCY_CODES.has(c) ? c : "CNY";
}

/**
 * 按「国家/地区」同步收入货币与税制：已接入 cn/hk/us 用 ECONOMY 映射；其余（待实装）用 pending + 地区默认货币。
 * @param {any} job
 */
function syncJobFieldsForRegionTier(job) {
  const tier = regionEconomyTier(job.region);
  if (tier !== "cn") {
    job.cnProvinceAdcode = "";
    job.cnCityAdcode = "";
  }
  if (tier === "other") {
    job.incomeCurrency = incomeCurrencyForPendingRegion(job.region);
    if (job.taxModel !== "none") {
      job.taxModel = "pending";
    }
    return;
  }
  for (const row of ECONOMY_REGION_DEFAULTS) {
    if (row.re.test(String(job.region ?? "").trim())) {
      job.incomeCurrency = row.currency;
      job.taxModel = row.taxModel;
      return;
    }
  }
}

/** @type {any[]|null} */
let cnPcasTree = null;
/** @type {Error|null} */
let cnPcaLoadError = null;
/** @type {Promise<any[]>|null} */
let cnPcaLoadPromise = null;

/** @type {Record<string, { amount: number; year?: number; note?: string }>|null} */
let cnSocialWageByAdcode = null;
/** @type {Promise<Record<string, { amount: number; year?: number; note?: string }>|null>|null} */
let cnSocialWageLoadPromise = null;

/** 直辖市省级 adcode：城市与省同一编码 */
const CN_MUNICIPALITY_PROVINCE_ADCODE = new Set(["110000", "120000", "310000", "500000"]);

/** @param {unknown} code */
function normalizeAdcode6(code) {
  const d = String(code ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length >= 6) return d.slice(0, 6);
  if (d.length === 2) return `${d}0000`;
  if (d.length === 4) return `${d}00`;
  return `${d}000000`.slice(0, 6);
}

/** @param {unknown} code */
function normalizeChildCityAdcode(code) {
  const d = String(code ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length >= 6) return d.slice(0, 6);
  if (d.length === 4) return `${d}00`;
  return `${d}000000`.slice(0, 6);
}

function ensureCnPcaLoaded() {
  if (cnPcasTree) return Promise.resolve(cnPcasTree);
  if (cnPcaLoadPromise) return cnPcaLoadPromise;
  cnPcaLoadPromise = fetch(new URL("data/pcas-code.json", window.location.href))
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      cnPcasTree = Array.isArray(data) ? data : [];
      cnPcaLoadError = null;
      return cnPcasTree;
    })
    .catch((e) => {
      cnPcaLoadError = e;
      console.warn("[job_salary_evaluation] 行政区划数据加载失败", e);
      cnPcasTree = null;
      throw e;
    })
    .finally(() => {
      cnPcaLoadPromise = null;
    });
  return cnPcaLoadPromise;
}

function ensureCnSocialWageLoaded() {
  if (cnSocialWageByAdcode) return Promise.resolve(cnSocialWageByAdcode);
  if (cnSocialWageLoadPromise) return cnSocialWageLoadPromise;
  cnSocialWageLoadPromise = fetch(new URL("data/cn-social-wage.json", window.location.href))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => {
      const by = j && typeof j === "object" && j.byAdcode && typeof j.byAdcode === "object" ? j.byAdcode : {};
      cnSocialWageByAdcode = /** @type {Record<string, { amount: number; year?: number; note?: string; sourceUrl?: string }>} */ (by);
      return cnSocialWageByAdcode;
    })
    .catch((e) => {
      console.warn("[job_salary_evaluation] 社平工资数据加载失败", e);
      cnSocialWageByAdcode = {};
      return cnSocialWageByAdcode;
    })
    .finally(() => {
      cnSocialWageLoadPromise = null;
    });
  return cnSocialWageLoadPromise;
}

function getCnProvinceOptionsList() {
  if (!cnPcasTree || !Array.isArray(cnPcasTree)) return [];
  return cnPcasTree
    .filter((p) => p && typeof p.name === "string" && !/香港|澳门/.test(p.name))
    .map((p) => ({ code: normalizeAdcode6(p.code), name: String(p.name) }))
    .filter((p) => p.code.length === 6);
}

function findCnProvinceNode(adcode6) {
  if (!cnPcasTree) return null;
  const target = normalizeAdcode6(adcode6);
  return cnPcasTree.find((p) => normalizeAdcode6(p.code) === target) || null;
}

function getCnPrefectureCitiesForProvince(provinceAdcode6) {
  const node = findCnProvinceNode(provinceAdcode6);
  if (!node) return [];
  const p6 = normalizeAdcode6(node.code);
  if (CN_MUNICIPALITY_PROVINCE_ADCODE.has(p6)) {
    return [{ code: p6, name: node.name }];
  }
  return (node.children || [])
    .map((ch) => ({ code: normalizeChildCityAdcode(ch.code), name: String(ch.name) }))
    .filter((c) => c.code.length === 6)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function getCnProvinceNameFromJob(job) {
  const p = normalizeAdcode6(job.cnProvinceAdcode);
  if (!p) return "—";
  const n = findCnProvinceNode(p);
  return n ? String(n.name) : "—";
}

function getCnCityNameFromJob(job) {
  const p = normalizeAdcode6(job.cnProvinceAdcode);
  const c = normalizeAdcode6(job.cnCityAdcode);
  if (!p || !c) return "—";
  if (CN_MUNICIPALITY_PROVINCE_ADCODE.has(p) && p === c) {
    const n = findCnProvinceNode(p);
    return n ? String(n.name) : "—";
  }
  const cities = getCnPrefectureCitiesForProvince(p);
  const hit = cities.find((x) => x.code === c);
  return hit ? hit.name : "—";
}

function sanitizeJobCnAdcodes(job) {
  if (regionEconomyTier(job.region) !== "cn" || !cnPcasTree) return;
  const provinces = getCnProvinceOptionsList();
  const p = normalizeAdcode6(job.cnProvinceAdcode);
  if (!p || !provinces.some((x) => x.code === p)) {
    job.cnProvinceAdcode = "";
    job.cnCityAdcode = "";
    return;
  }
  const cities = getCnPrefectureCitiesForProvince(p);
  const c = normalizeAdcode6(job.cnCityAdcode);
  if (!c || !cities.some((x) => x.code === c)) job.cnCityAdcode = "";
}

/** 社平 JSON 已加载且该地级 adcode 有有效月度金额 */
function cnCityHasWageData(adcode) {
  const a = normalizeAdcode6(adcode);
  if (!a || cnSocialWageByAdcode === null) return false;
  const rec = cnSocialWageByAdcode[a];
  return !!(rec && Number.isFinite(rec.amount));
}

/** @param {any} job @returns {number | null} 该市社平月薪（元/月），无数据为 null */
function cnSocialWageAmountForJob(job) {
  const rec = cnSocialWageRecordForJob(job);
  return rec && Number.isFinite(rec.amount) ? rec.amount : null;
}

/** @param {any} job @returns {{ amount: number; year?: number; note?: string; sourceUrl?: string } | null} */
function cnSocialWageRecordForJob(job) {
  if (cnSocialWageByAdcode === null) return null;
  const a = normalizeAdcode6(job.cnCityAdcode);
  if (!a) return null;
  const rec = cnSocialWageByAdcode[a];
  return rec && Number.isFinite(rec.amount) ? rec : null;
}

/** @param {string | undefined} u */
function cnSafeSourceHref(u) {
  const s = String(u ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : "#";
}

/** 按社平示例推算缴费基数常见比例区间（60%～300%） */
function cnContributionBaseRangeFromSocialAvg(amount) {
  const min = Math.round(amount * 0.6);
  const max = Math.round(amount * 3);
  return { min, max };
}

/**
 * 社保/公积金基数输入格下方说明（灰字区间；越界时红字提醒）
 * @param {any} job
 * @param {"si"|"hf"} kind
 */
function cnSiHfBaseFootnoteHtml(job, kind) {
  if (getTaxModel(job) !== "cn") return "";
  const cityName = getCnCityNameFromJob(job);
  const hasCity = normalizeAdcode6(job.cnCityAdcode) && cityName !== "—";

  if (cnSocialWageByAdcode === null) {
    return `<div class="compare-field-footnote">${escapeHtml("正在加载社平参考…")}</div>`;
  }
  if (!hasCity) {
    return `<div class="compare-field-footnote">${escapeHtml("请先选择参保城市以查看基数参考区间。")}</div>`;
  }

  const rec = cnSocialWageRecordForJob(job);
  if (rec == null) {
    return `<div class="compare-field-footnote">${escapeHtml(
      "暂无该市社平示例，无法推算参考区间（请查阅当地当年缴费基数上下限）。"
    )}</div>`;
  }

  const { min, max } = cnContributionBaseRangeFromSocialAvg(rec.amount);
  const yr = rec.year != null && Number.isFinite(rec.year) ? String(rec.year) : "—";
  const href = cnSafeSourceHref(rec.sourceUrl);
  const hrefTitle = href === "#" ? "未配置来源链接：可在 data/cn-social-wage.json 为该 adcode 填写 sourceUrl" : "数据来源";
  const lineText = `${cityName} · [${fmtMoney(min)}, ${fmtMoney(max)}] CNY · ${yr}年`;
  const linkChar = "※";
  const rangeBlock = `<div class="compare-field-footnote compare-field-footnote--inline">${escapeHtml(lineText)} <a href="${escapeHtml(
    href
  )}" class="compare-src-link" target="_blank" rel="noopener noreferrer" title="${escapeHtml(hrefTitle)}">${escapeHtml(
    linkChar
  )}</a></div>`;

  const enabled = kind === "si" ? job.hasSocialInsurance === "yes" : job.hasHousingFund === "yes";
  const baseVal = kind === "si" ? asNumber(job.siBase) : asNumber(job.hfBase);
  const outOfRange =
    enabled && Number.isFinite(baseVal) && (baseVal < min || baseVal > max);
  const warn =
    kind === "si"
      ? "请填写参考区间内数值，或在「是否缴纳社保」中选否。"
      : "请填写参考区间内数值，或在「是否缴纳公积金」中选否。";

  if (outOfRange) {
    return `<div class="compare-field-footnote compare-field-footnote--invalid">${escapeHtml(warn)}</div>${rangeBlock}`;
  }
  return rangeBlock;
}

function buildCnProvinceCityRowHtml(job) {
  const id = escapeHtml(job.id);
  const provinces = getCnProvinceOptionsList();
  const pSel = normalizeAdcode6(job.cnProvinceAdcode);
  const cSel = normalizeAdcode6(job.cnCityAdcode);
  const wageLoaded = cnSocialWageByAdcode !== null;
  const provinceOpts =
    `<option value="">（请选择）</option>` +
    provinces
      .map((p) => `<option value="${escapeHtml(p.code)}"${p.code === pSel ? " selected" : ""}>${escapeHtml(p.name)}</option>`)
      .join("");
  let cityOpts;
  if (!pSel) {
    cityOpts = `<option value="">请先选择省份</option>`;
  } else {
    const cities = getCnPrefectureCitiesForProvince(pSel);
    cityOpts =
      `<option value="">（请选择）</option>` +
      cities
        .map((c) => {
          const pending = wageLoaded && !cnCityHasWageData(c.code);
          const lab = `${c.name}${pending ? "（待实装）" : ""}`;
          return `<option value="${escapeHtml(c.code)}"${c.code === cSel ? " selected" : ""}>${escapeHtml(lab)}</option>`;
        })
        .join("");
  }
  return `<div class="compare-th-meta__row compare-th-meta__row--cn-loc">
    <div class="compare-th-meta__cnCell">
      <span class="compare-th-meta__lbl">省份</span>
      <select class="compare-input compare-input--text compare-th-meta__field" data-job-id="${id}" data-field="cnProvinceAdcode" aria-label="省份">${provinceOpts}</select>
    </div>
    <div class="compare-th-meta__cnCell">
      <span class="compare-th-meta__lbl">城市</span>
      <select class="compare-input compare-input--text compare-th-meta__field" data-job-id="${id}" data-field="cnCityAdcode" aria-label="城市"${
    !pSel ? " disabled" : ""
  }>${cityOpts}</select>
    </div>
  </div>`;
}

function jobThMetaWageLineHtml(job) {
  if (regionEconomyTier(job.region) !== "cn") return "";
  const city = normalizeAdcode6(job.cnCityAdcode);
  if (!city) {
    return `<div class="compare-th-meta__wage">${escapeHtml("请选择城市以获取社会平均月度工资")}</div>`;
  }
  const pName = getCnProvinceNameFromJob(job);
  const cName = getCnCityNameFromJob(job);
  const label = `${pName}-${cName}社会平均月度工资`;
  if (cnSocialWageByAdcode === null) {
    return `<div class="compare-th-meta__wage compare-th-meta__muted">${escapeHtml("正在加载数据…")}</div>`;
  }
  const rec = cnSocialWageByAdcode[city];
  if (!rec || !Number.isFinite(rec.amount)) {
    return `<div class="compare-th-meta__wage compare-th-meta__muted">${escapeHtml(
      "暂无该市社会平均月度工资数据（请更新 data/cn-social-wage.json）"
    )}</div>`;
  }
  const yr = rec.year != null ? `（${rec.year}）` : "";
  return `<div class="compare-th-meta__wage">${escapeHtml(label)}：${escapeHtml(fmtMoney(rec.amount))} 元/月${escapeHtml(yr)}</div>`;
}

function primaryRegionSelectHtml(job) {
  const cur = normalizePrimaryRegion(job.region);
  const opts = PRIMARY_REGION_OPTIONS.map((v) => {
    const lab = primaryRegionOptionLabel(v);
    return `<option value="${escapeHtml(v)}"${v === cur ? " selected" : ""}>${escapeHtml(lab)}</option>`;
  }).join("");
  return `<select class="compare-input compare-input--text compare-th-meta__field" data-job-id="${escapeHtml(job.id)}" data-field="region" aria-label="国家/地区">${opts}</select>`;
}

function jobThMetaSubdivisionRowHtml(job) {
  const tier = regionEconomyTier(job.region);
  const id = escapeHtml(job.id);
  if (tier === "cn") {
    if (cnPcaLoadError) {
      return `<div class="compare-th-meta__row"><span class="compare-th-meta__lbl">省/市</span><span class="compare-th-meta__muted">行政区划加载失败（请用 HTTP 打开页面并检查 data/pcas-code.json）</span></div>`;
    }
    if (!cnPcasTree) {
      return `<div class="compare-th-meta__row"><span class="compare-th-meta__lbl">省/市</span><span class="compare-th-meta__muted">正在加载行政区划…</span></div>`;
    }
    return buildCnProvinceCityRowHtml(job);
  }
  if (tier === "hk") {
    return `<div class="compare-th-meta__row">
      <span class="compare-th-meta__lbl">二级区划</span>
      <select class="compare-input compare-input--text compare-th-meta__field compare-th-meta__field--frozen" disabled aria-label="二级区划（不适用）">
        <option>不适用</option>
      </select>
    </div>`;
  }
  if (tier === "us") {
    const ust = normalizeUsState(subRegionToUsStateCode(job.subRegion));
    const opts = US_STATE_OPTION_META.map(({ code, label, pending }) => {
      const suffix = pending ? "（待实装）" : "";
      return `<option value="${code}"${ust === code ? " selected" : ""}>${escapeHtml(label)}${suffix}</option>`;
    }).join("");
    return `<div class="compare-th-meta__row">
      <span class="compare-th-meta__lbl">州份</span>
      <select class="compare-input compare-input--text compare-th-meta__field" data-job-id="${id}" data-field="subRegion" aria-label="州份">${opts}</select>
    </div>`;
  }
  return `<div class="compare-th-meta__row">
    <span class="compare-th-meta__lbl">二级区划</span>
    <select class="compare-input compare-input--text compare-th-meta__field compare-th-meta__field--frozen" disabled aria-label="二级区划（不适用）">
      <option>不适用</option>
    </select>
  </div>`;
}

/**
 * 一级经济体变更时：仅当新区域命中映射，且（上一档区域无映射 且 为空）或（当前货币/税制仍等于上一档映射默认值）时，才替换默认货币与税制。
 * @param {any} job
 * @param {string} [prevRegion]
 */
function applyEconomyDefaultsFromRegion(job, prevRegion) {
  void prevRegion;
  syncJobFieldsForRegionTier(job);
}

function jobThMetaHtml(job) {
  const jc = getCompareCurrencyCode();
  const tm = getTaxModel(job);
  const currencyFieldHtml = `<select class="compare-input compare-input--text compare-th-meta__field" data-job-id="${escapeHtml(job.id)}" data-field="incomeCurrency">${incomeCurrencyOptionsHtml(
    job.incomeCurrency
  )}</select>`;
  const taxFieldHtml = `<select class="compare-input compare-input--text compare-th-meta__field" data-job-id="${escapeHtml(job.id)}" data-field="taxModel">
          <option value="cn" ${tm === "cn" ? "selected" : ""}>中国</option>
          <option value="us" ${tm === "us" ? "selected" : ""}>美国 W-2</option>
          <option value="hk" ${tm === "hk" ? "selected" : ""}>香港</option>
          <option value="none" ${tm === "none" ? "selected" : ""}>不使用</option>
          <option value="pending" ${tm === "pending" ? "selected" : ""}>待实装</option>
        </select>`;
  return `
    <div class="compare-th-meta">
      <div class="compare-th-meta__row">
        <span class="compare-th-meta__lbl">国家/地区</span>
        ${primaryRegionSelectHtml(job)}
      </div>
      ${jobThMetaSubdivisionRowHtml(job)}
      <div class="compare-th-meta__row">
        <span class="compare-th-meta__lbl">货币</span>
        ${currencyFieldHtml}
      </div>
      <div class="compare-th-meta__row">
        <span class="compare-th-meta__lbl">税制</span>
        ${taxFieldHtml}
      </div>
      <div class="compare-th-meta__hint">比较货币（统计）：${escapeHtml(jc)}</div>
      ${jobThMetaWageLineHtml(job)}
    </div>
  `;
}

let isRestoringCompareInputFocus = false;
let isComposing = false;
let pendingCompareUpdateJobId = null;
/**
 * 对比表整表 innerHTML 重绘与可编辑格并存时的约定（避免「无法连续输入」）：
 * 1) 输入触发的刷新：同格仍聚焦时跳过整表重绘（见 updateOne + shouldSkipCompareTableRefreshForActiveInput）。
 * 2) debounce 若跳过渲染，失焦时必须补一次 renderCompareTablePreserveFocus（见 focusout）。
 * 3) 数值格：compareInputDisplayPending + asNumberLooseForCompare 编辑态，失焦 finalizeCompareNumberInputFromElement 定稿。
 * 4) focusin 延迟全选：跳过 data-input-type="number"（及 region），避免与选区/重绘冲突。
 * 5) IME：compositionend 与 debounce 共用带 field 的 updateOne，避免组词结束立刻整表替换。
 */
/** focusin 里延迟全选的定时器；整表重绘后旧 input 已卸载，若不取消会导致误 select 或打断连续输入 */
let compareInputFocusSelectTimer = null;
/** input 连打时推迟整表重绘，减少替换 DOM 导致的焦点/选区问题 */
let compareTableRefreshDebounceTimer = null;
/** @type {{ jobId: string, field: string } | null} */
let compareTableRefreshDebouncePending = null;
/** 数值格编辑中的原始字符串，用于整表重绘时 value 与 model 不一致的中间态（如小数点、清空） */
const compareInputDisplayPending = new Map();

function comparePendingInputKey(jobId, field) {
  return `${jobId}\x1e${field}`;
}

/** 编辑过程中写入 job 的宽松数值，避免 "" / "12." 等立刻变成无法继续输入的状态 */
function asNumberLooseForCompare(raw) {
  const s = String(raw ?? "").trim();
  if (s === "" || s === "-" || s === "." || s === "-.") return 0;
  if (/^-?\d+\.$/.test(s)) return asNumber(s.slice(0, -1));
  return asNumber(s);
}

/**
 * @param {string} jobId
 * @param {string} field
 * @returns {boolean} 当前聚焦在同一格 input 时跳过整表重绘（select 等不跳过）
 */
function shouldSkipCompareTableRefreshForActiveInput(jobId, field) {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement)) return false;
  if (!el.classList.contains("compare-input")) return false;
  return el.getAttribute("data-job-id") === jobId && el.getAttribute("data-field") === field;
}

function getActiveCompareInputState() {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return null;
  if (!el.classList.contains("compare-input")) return null;
  const jobId = el.getAttribute("data-job-id");
  const field = el.getAttribute("data-field");
  if (!jobId || !field) return null;
  const state = { jobId, field, tag: el.tagName };
  if (el instanceof HTMLInputElement) {
    // selectionStart/End 可能为 null（如 number 类型、某些环境下），此时用“末尾”兜底
    const len = (el.value ?? "").length;
    const selectionStart = typeof el.selectionStart === "number" ? el.selectionStart : len;
    const selectionEnd = typeof el.selectionEnd === "number" ? el.selectionEnd : len;
    return { ...state, selectionStart, selectionEnd };
  }
  return state;
}

function restoreActiveCompareInputState(snapshot) {
  if (!snapshot) return;
  const esc =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape
      : (s) => String(s).replace(/["\\]/g, "\\$&");
  const selector = `.compare-input[data-job-id="${esc(snapshot.jobId)}"][data-field="${esc(snapshot.field)}"]`;
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
  isRestoringCompareInputFocus = true;
  try {
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement && typeof snapshot.selectionStart === "number" && typeof snapshot.selectionEnd === "number") {
      try {
        el.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
      } catch {
        // ignore
      }
    }
  } finally {
    isRestoringCompareInputFocus = false;
  }
}

function renderCompareTablePreserveFocus() {
  if (compareInputFocusSelectTimer) {
    clearTimeout(compareInputFocusSelectTimer);
    compareInputFocusSelectTimer = null;
  }
  if (compareTableRefreshDebounceTimer) {
    clearTimeout(compareTableRefreshDebounceTimer);
    compareTableRefreshDebounceTimer = null;
    compareTableRefreshDebouncePending = null;
  }
  const snap = getActiveCompareInputState();
  // 整表 innerHTML 会移除当前聚焦节点，部分浏览器会因此把滚动跳到顶部；先记下再还原
  const scrollX = window.scrollX ?? document.documentElement.scrollLeft ?? 0;
  const scrollY = window.scrollY ?? document.documentElement.scrollTop ?? 0;
  renderCompareTable();
  restoreActiveCompareInputState(snap);
  requestAnimationFrame(() => {
    window.scrollTo(scrollX, scrollY);
  });
}

/**
 * @param {{key:string,label:string,hintHtml:string}} m
 * @param {unknown[]} jobs
 */
function getMetricLabelBase(m, jobs) {
  const hasUs = jobs.some((j) => getTaxModel(j) === "us");
  const hasCn = jobs.some((j) => getTaxModel(j) === "cn");
  const hasHk = jobs.some((j) => getTaxModel(j) === "hk");
  const hasNone = jobs.some((j) => {
    const t = getTaxModel(j);
    return t === "none" || t === "pending";
  });
  const mix = (hasUs ? 1 : 0) + (hasCn ? 1 : 0) + (hasHk ? 1 : 0) >= 2;
  if (m.key === "fiveInsHfDeductPersonal") {
    if (mix) return "个人扣缴（五险一金 / 强积金 / FICA）";
    if (hasUs) return "FICA 雇员（月）";
    if (hasHk) return "强积金雇员（月）";
  }
  if (m.key === "medicalBoth") {
    if (mix) return "医保 / Medicare";
    if (hasUs) return "Medicare 雇员部分";
  }
  if (m.key === "socialBoth") {
    if (mix) return "社保 / SS 雇员";
    if (hasUs) return "Social Security 雇员";
  }
  if (m.key === "hfBoth") {
    if (hasUs) return "住房公积金（美国无）";
  }
  if (m.key === "fiveInsHfDeductCompany") {
    if (hasUs) return "企业侧五险（美国未估算）";
  }
  if (m.key === "fiveInsHfDeductBoth") {
    if (mix) return "扣缴合计（个人+企业）";
    if (hasUs) return "FICA 雇员合计";
  }
  if (m.key === "monthlyIIT") {
    if (mix) return "个税 / 薪俸税 / 所得税预扣（月）";
    if (hasUs) return "所得税预扣（联邦+州，月）";
    if (hasHk) return "薪俸税（估算，月）";
  }
  if (m.key === "feePeriod") {
    if (mix) return "税费缴纳总和（法定扣缴）";
    if (hasUs) return "税费缴纳总和（FICA+所得税）";
    if (hasHk) return "税费缴纳总和（强积金+薪俸税）";
    if (hasNone && !hasCn && !hasUs && !hasHk) return "税费缴纳总和（本列未计税费）";
  }
  if (m.key === "grossMonthly") {
    if (state.period === PERIODS.year) return "税前基本月薪+绩效（折合年薪）";
    if (state.period === PERIODS.day) return "税前基本月薪+绩效（折合工作日薪）";
    return "税前基本月薪+绩效（月薪）";
  }
  if (m.key === "bonusAnnual") {
    if (state.period === PERIODS.year) return "税前年终（折合年薪）";
    if (state.period === PERIODS.day) return "税前年终（折合工作日薪）";
    return "税前年终（按月折算）";
  }
  if (m.key === "extraIncomeMonthlyComputed") {
    if (state.period === PERIODS.year) return "税前额外收入（折合年薪）";
    if (state.period === PERIODS.day) return "税前额外收入（折合工作日薪）";
    return "税前额外收入（按月）";
  }
  if (m.key === "workHoursPerDay") return "日均在岗时长（小时）";
  if (m.key === "onDutyHoursPerDay") return "日均在岗时长（小时）";
  if (m.key === "restHoursOnDutyDisplay") return "在岗休息（小时/日）";
  if (m.key === "actualWorkHoursPerDayDisplay") return "日均实际工作（小时）";
  return m.label;
}

/** 对比表 METRICS 行标签前的装饰性 emoji（仅展示层；与 key 绑定，与 getMetricLabelBase 动态文案独立） */
const METRIC_EMOJI = /** @type {Record<string, string>} */ ({
  baseSalary: "💵",
  perfSalary: "💵",
  grossMonthly: "💰",
  bonusAnnual: "🎁",
  extraIncomeMonthlyComputed: "➕",
  bonusCoef: "🔢",
  workdayMode: "📅",
  workHoursPerDay: "⏰",
  restHoursOnDuty: "☕",
  monthlyRent: "🏠",
  commuteCostOneWay: "🚌",
  commuteMinutesOneWay: "⏱",
  foodBreakfast: "🌅",
  foodLunch: "🍱",
  foodDinner: "🌙",
  foodSnack: "🥤",
  extraIncomeMonthly: "💶",
  extraExpenseMonthly: "📎",
  hasSocialInsurance: "🏥",
  siBase: "📋",
  hasHousingFund: "🏦",
  hfBase: "🏦",
  hfRatePct: "⚖",
  taxExemptExtraMonthly: "📝",
  hkMaritalStatus: "💑",
  hkAllowanceMode: "📜",
  feePeriod: "📊",
  taxToIncomeRatio: "📈",
  necessaryExpenseToIncomeRatio: "📈",
  netIncomeToGrossRatio: "📈",
  disposableIncomeToGrossRatio: "📈",
  netIncomePeriod: "✅",
  housingExpensePeriod: "🏠",
  commuteExpensePeriod: "🚌",
  foodExpensePeriod: "🍱",
  totalExpensePeriod: "💸",
  onDutyHoursPerDay: "🕐",
  restHoursOnDutyDisplay: "😴",
  actualWorkHoursPerDayDisplay: "⚙",
  baseWorkHoursPerDay: "🕗",
  overtimeHoursPerDay: "⚡",
  commuteHoursPerDay: "🚇",
  timeHoursPeriod: "⏳",
});

function getMetricLabel(m, jobs) {
  const s = getMetricLabelBase(m, jobs);
  const e = METRIC_EMOJI[m.key];
  return e ? `${e} ${s}` : `• ${s}`;
}

/**
 * @param {{key:string,label:string,hintHtml:string}} m
 * @param {unknown[]} jobs
 */
function getMetricHint(m, jobs) {
  const hasUs = jobs.some((j) => getTaxModel(j) === "us");
  const hasCn = jobs.some((j) => getTaxModel(j) === "cn");
  const hasHk = jobs.some((j) => getTaxModel(j) === "hk");
  const hasNone = jobs.some((j) => {
    const t = getTaxModel(j);
    return t === "none" || t === "pending";
  });
  const mix = (hasUs ? 1 : 0) + (hasCn ? 1 : 0) + (hasHk ? 1 : 0) >= 2;
  if (m.key === "feePeriod" && hasUs && !mix) return "FICA+联邦+州税（随周期；W-2估）";
  if (m.key === "feePeriod" && hasHk && !mix) return "强积金+薪俸税（随周期）";
  if (m.key === "feePeriod" && mix) {
    const parts = [];
    if (hasCn) parts.push("中：五险+个税");
    if (hasHk) parts.push("港：强积金+薪俸税");
    if (hasUs) parts.push("美：FICA+预扣");
    if (hasNone) parts.push("无税：0");
    return `${parts.join("；")}；随周期`;
  }
  if (m.key === "monthlyIIT" && hasUs && !mix)
    return `联邦+州÷12（Single；${US_TAX_YEAR}；${escapeHtml(String(periodLabel()))}按比例）`;
  if (m.key === "monthlyIIT" && hasHk && !mix)
    return `薪俸税÷12（${HK_TAX_YEAR_LABEL}；${escapeHtml(String(periodLabel()))}按比例）`;
  if (m.key === "monthlyIIT" && mix) {
    const parts = [];
    if (hasCn) parts.push("中：个税/12");
    if (hasHk) parts.push("港：薪俸税/12");
    if (hasUs) parts.push("美：联邦+州/12");
    if (hasNone) parts.push("无税：0");
    return `${parts.join("；")}；随周期`;
  }
  if (m.key === "fiveInsHfDeductPersonal" && hasUs && !mix) return "SS 6.2%+Medicare 1.45%（估）";
  if (m.key === "fiveInsHfDeductPersonal" && hasHk && !mix) return "强积金雇员（阶梯估）";
  if (m.key === "fiveInsHfDeductPersonal" && mix) {
    const parts = [];
    if (hasCn) parts.push("中：五险个人");
    if (hasHk) parts.push("港：强积金");
    if (hasUs) parts.push("美：FICA");
    return `${parts.join("；")}`;
  }
  if (m.key === "netIncomePeriod" && mix) {
    const parts = [];
    if (hasCn) parts.push("中：税前−五险−个税");
    if (hasHk) parts.push("港：税前−强积金−薪俸税");
    if (hasUs) parts.push("美：税前−FICA−预扣");
    if (hasNone) parts.push("无税：税前");
    return `${parts.join("；")}（随周期）`;
  }
  if (m.key === "netIncomePeriod" && hasUs && !mix) return "税前−FICA−联邦/州预扣（随周期）";
  if (m.key === "netIncomePeriod" && hasHk && !mix) return "税前−强积金−薪俸税（随周期）";
  if (m.key === "netIncomePeriod" && hasNone && !mix) return "税前（未扣税；随周期）";
  if ((m.key === "siBase" || m.key === "hfBase") && hasCn) {
    return CN_SI_HF_BASE_METRIC_HINT;
  }
  return m.hintHtml;
}

function amountForPeriodFromMonthly(monthly, c) {
  const wd = c.workdays || 21.75;
  if (state.period === PERIODS.year) return monthly * 12;
  if (state.period === PERIODS.day) return monthly / wd;
  return monthly;
}

function collectBreakdownIds(jobs, computed, listKey) {
  const ids = /** @type {string[]} */ ([]);
  const seen = new Set();
  for (let i = 0; i < jobs.length; i++) {
    const list = (computed[i]?.taxBreakdown || {})[listKey] || [];
    for (const it of list) {
      if (it?.id && !seen.has(it.id)) {
        seen.add(it.id);
        ids.push(it.id);
      }
    }
  }
  return ids;
}

function findBreakdownItemById(jobs, computed, listKey, id) {
  for (let i = 0; i < jobs.length; i++) {
    const list = (computed[i]?.taxBreakdown || {})[listKey] || [];
    const it = list.find((x) => x.id === id);
    if (it) return it;
  }
  return null;
}

function incomeEfficiencyTimeSeconds(c) {
  const a = c.actualWorkSecondsPeriod;
  return Number.isFinite(a) && a > 0 ? a : c.timeSecondsPeriod || 0;
}

function cnOnlyInputHtml(job, innerHtml) {
  return getTaxModel(job) === "cn" ? innerHtml : `<span class="compare-val compare-muted">—</span>`;
}

function hkOnlyInputHtml(job, innerHtml) {
  return getTaxModel(job) === "hk" ? innerHtml : `<span class="compare-val compare-muted">—</span>`;
}

function renderCompareTable() {
  const host = document.getElementById("compareTable");
  if (!host) return;

  const jobs = state.jobs || [];
  if (cnPcasTree) {
    for (const j of jobs) sanitizeJobCnAdcodes(j);
  }
  const jobCountAttr = String(Math.min(MAX_COMPARE_JOBS, Math.max(1, jobs.length)));
  const focusStageEl = document.getElementById("mainFocusStage");
  if (focusStageEl) focusStageEl.dataset.jobCount = jobCountAttr;
  const computed = jobs.map((j) => applyIncomeToCompareMoney(calc(j), effectiveFxRate(j)));
  const cc = getCompareCurrencyCode();
  const showInputs = state.inputViewMode !== INPUT_VIEW_MODES.results;
  const anyCn = jobs.some((j) => getTaxModel(j) === "cn");
  const anyHk = jobs.some((j) => getTaxModel(j) === "hk");
  const colSpan = jobs.length + 1;
  const uc = normalizeUiCollapse(state.uiCollapse);

  const groupRow = (title, note = "") =>
    `<tr class="compare-group"><td colspan="${colSpan}"><div class="compare-group__cell">${escapeHtml(title)}${
      note ? `<span class="compare-group__note">${escapeHtml(note)}</span>` : ""
    }</div></td></tr>`;
  const subgroupRow = (title, note = "") =>
    `<tr class="compare-subgroup"><td colspan="${colSpan}"><div class="compare-subgroup__cell">${escapeHtml(title)}${
      note ? `<span class="compare-group__note">${escapeHtml(note)}</span>` : ""
    }</div></td></tr>`;

  const sectionHeadButton = (sectionId, title, note, expanded) => {
    const arr = expanded ? "▼" : "▶";
    return `<tr class="compare-section__head"><td colspan="${colSpan}"><button type="button" class="compare-section__toggle" data-section-toggle="${sectionId}" aria-expanded="${expanded}">${arr} <span class="compare-section__title">${escapeHtml(
      title
    )}</span>${
      note ? `<span class="compare-group__note">${escapeHtml(note)}</span>` : ""
    }</button></td></tr>`;
  };

  const wrapSectionTbody = (sectionId, title, note, innerRowsHtml, extraTbodyClass = "") => {
    const expanded = uc[sectionId] !== false;
    const extra = extraTbodyClass ? ` ${extraTbodyClass}` : "";
    return `<tbody class="compare-section${expanded ? "" : " is-collapsed"}${extra}" data-section="${sectionId}">${sectionHeadButton(
      sectionId,
      title,
      note,
      expanded
    )}${innerRowsHtml}</tbody>`;
  };

  const taxBundleHidden = uc.calc_tax_wrap === false;
  const taxChildClass = taxBundleHidden ? "compare-tax-bundle-suppressed" : "";

  const sectionHeadEfficiency = (sectionId, title, note, expanded) => {
    const arr = expanded ? "▼" : "▶";
    const eu = normalizeEfficiencyTimeUnit(state.efficiencyTimeUnit);
    const opts = [
      ["minute", "分钟"],
      ["hour", "小时"],
      ["workday", "工作日"],
      ["month", "自然月"],
      ["year", "自然年"],
    ];
    const optsHtml = opts
      .map(([v, lab]) => `<option value="${v}"${eu === v ? " selected" : ""}>${escapeHtml(lab)}</option>`)
      .join("");
    const showEffDenomOpts = eu === "minute" || eu === "hour";
    const incC = state.efficiencyIncludeCommute !== false;
    const incOt = state.efficiencyIncludeOvertime !== false;
    const effDenomOptsHtml = showEffDenomOpts
      ? `<div class="compare-section__effOpts" role="group" aria-label="报酬效率时间分母">
          <label class="compare-eff-opt-label"><input type="checkbox" id="efficiencyIncludeCommute" class="compare-eff-opt-chk"${incC ? " checked" : ""}/> <span>纳入通勤时间</span></label>
          <label class="compare-eff-opt-label"><input type="checkbox" id="efficiencyIncludeOvertime" class="compare-eff-opt-chk"${incOt ? " checked" : ""}/> <span>纳入视同加班部分</span></label>
        </div>`
      : "";
    return `<tr class="compare-section__head compare-section__head--eff"><td colspan="${colSpan}">
      <div class="compare-section__bar compare-section__bar--eff">
        <div class="compare-section__barLeft">
          <button type="button" class="compare-section__toggle" data-section-toggle="${sectionId}" aria-expanded="${expanded}">${arr} <span class="compare-section__title">${escapeHtml(
      title
    )}</span>${note ? `<span class="compare-group__note">${escapeHtml(note)}</span>` : ""}</button>
          <span class="compare-section__warn">分钟/小时/工作日：按工时折算；自然月/年：整段金额。</span>
        </div>
        <div class="compare-section__barRight">
          ${effDenomOptsHtml}
          <label class="compare-eff-unit-label"><span class="compare-eff-unit-label__txt">时间单位</span>
            <select id="efficiencyTimeUnitSelect" class="compare-input compare-input--text compare-eff-unit-select">${optsHtml}</select>
          </label>
        </div>
      </div>
    </td></tr>`;
  };

  const wrapEfficiencySection = (sectionId, title, note, innerRowsHtml) => {
    const expanded = uc[sectionId] !== false;
    return `<tbody class="compare-section${expanded ? "" : " is-collapsed"}" data-section="${sectionId}">${sectionHeadEfficiency(
      sectionId,
      title,
      note,
      expanded
    )}${innerRowsHtml}</tbody>`;
  };

  const taxBreakdownIds = collectBreakdownIds(jobs, computed, "taxItems");
  const welfareBreakdownIds = collectBreakdownIds(jobs, computed, "welfareItems");

  const renderBreakdownRows = (listKey, ids) =>
    ids
      .map((id) => {
        const ref = findBreakdownItemById(jobs, computed, listKey, id);
        const name = ref?.label || id;
        const hint =
          listKey === "taxItems"
            ? ref?.hintRate || ""
            : [ref?.hintRate, ref?.employerHint].filter(Boolean).join("；");
        const rowEmoji = breakDownRowEmoji(listKey);
        const left = metricCellHtml(`${rowEmoji} ${name}`, hint);
        const cells = jobs
          .map((job, idx) => {
            const c = computed[idx];
            const list = (c.taxBreakdown || {})[listKey] || [];
            const it = list.find((x) => x.id === id);
            if (!it) return `<td><div class="compare-val compare-muted">—</div></td>`;
            const amt = amountForPeriodFromMonthly(it.amountMonthly, c);
            const displayAmt = -Math.abs(amt);
            return `<td>${valueCellHtmlMoneyFx(job, c, displayAmt, "neg")}</td>`;
          })
          .join("");
        return `<tr><td>${left}</td>${cells}</tr>`;
      })
      .join("");

  /** @type {{key:string,label:string,hintHtml:string, renderCell:(job:any,c:any,idx:number)=>string}[]} */
  const METRICS = [
    {
      key: "baseSalary",
      label: "税前基本月薪",
      hintHtml: "税前固定月薪（与收入货币一致）",
      renderCell: (job) => inputHtml(job.id, "baseSalary", "number", job.baseSalary, 'inputmode="numeric" min="0" step="1"', job),
    },
    {
      key: "perfSalary",
      label: "税前基本月绩效",
      hintHtml: "税前月绩效，可与基本月薪分开填",
      renderCell: (job) => inputHtml(job.id, "perfSalary", "number", job.perfSalary, 'inputmode="numeric" min="0" step="1"', job),
    },
    {
      key: "grossMonthly",
      label: "税前月薪",
      hintHtml: "基本+绩效（随顶栏缩放）",
      renderCell: (job, c) => valueCellHtmlMoneyFx(job, c, amountForPeriodFromMonthly(c.grossMonthly, c), "pos"),
    },
    {
      key: "bonusAnnual",
      label: "税前年终（单列）",
      hintHtml: "年奖=月薪×系数；随顶栏缩放",
      renderCell: (job, c) => {
        const bonusPeriod =
          state.period === PERIODS.year ? c.annualGross - c.grossMonthly * 12 : state.period === PERIODS.day ? (c.annualGross - c.grossMonthly * 12) / 12 / c.workdays : (c.annualGross - c.grossMonthly * 12) / 12;
        return valueCellHtmlMoneyFx(job, c, bonusPeriod, "pos");
      },
    },
    {
      key: "extraIncomeMonthlyComputed",
      label: "税前额外收入（按月）",
      hintHtml: "补贴等，计税前（随顶栏缩放）",
      renderCell: (job, c) => valueCellHtmlMoneyFx(job, c, amountForPeriodFromMonthly(c.extraIncomeMonthly, c), "pos"),
    },
    {
      key: "bonusCoef",
      label: "年终奖金系数",
      hintHtml: "年奖=月薪×此系数",
      renderCell: (job) => inputHtml(job.id, "bonusCoef", "number", job.bonusCoef, 'inputmode="decimal" min="0" step="0.1"', job),
    },
    {
      key: "workdayMode",
      label: "每月工作日数口径",
      hintHtml: "按日/按年折算用；各档有默认工日/月",
      renderCell: (job) => {
        const wm = WORKDAY_MODES[job.workdayMode] || WORKDAY_MODES.legal;
        const wd = workdaysForMode(job.workdayMode);
        const sel = selectHtml(job.id, "workdayMode", job.workdayMode, [
          { value: "legal", label: "双休(法定)" },
          { value: "bigSmall", label: "大小周" },
          { value: "singleRest", label: "单休" },
          { value: "monthEndSaturday", label: "月末周六" },
          { value: "fourOnThreeOff", label: "上四休三" },
        ]);
        const foot = `<div class="compare-field-footnote">【${escapeHtml(wm.label)}】折算约为 ${wd} 工作日/月</div>`;
        return `<div class="compare-input-stack">${sel}${foot}</div>`;
      },
    },
    {
      key: "workHoursPerDay",
      label: "日均工作时长（小时）",
      hintHtml: "在岗总时长",
      renderCell: (job) => inputHtml(job.id, "workHoursPerDay", "number", job.workHoursPerDay, 'inputmode="decimal" min="0" step="0.5"', job),
    },
    {
      key: "restHoursOnDuty",
      label: "在岗休息（小时/日）",
      hintHtml: "≤日均在岗",
      renderCell: (job) => inputHtml(job.id, "restHoursOnDuty", "number", job.restHoursOnDuty, 'inputmode="decimal" min="0" step="0.25"', job),
    },
    {
      key: "monthlyRent",
      label: "每月租金",
      hintHtml: "月房租，按整月计",
      renderCell: (job) => inputHtml(job.id, "monthlyRent", "number", job.monthlyRent, 'inputmode="numeric" min="0" step="1"', job),
    },
    {
      key: "commuteCostOneWay",
      label: "单趟通勤成本",
      hintHtml: "单程交通花费（与收入货币一致）",
      renderCell: (job) => inputHtml(job.id, "commuteCostOneWay", "number", job.commuteCostOneWay, 'inputmode="decimal" min="0" step="0.1"', job),
    },
    {
      key: "commuteMinutesOneWay",
      label: "单趟通勤时间（分钟）",
      hintHtml: "往返=单趟×2",
      renderCell: (job) => inputHtml(job.id, "commuteMinutesOneWay", "number", job.commuteMinutesOneWay, 'inputmode="numeric" min="0" step="1"', job),
    },
    {
      key: "foodBreakfast",
      label: "日均早餐花销",
      hintHtml: "工作日早餐约花费/日",
      renderCell: (job) => inputHtml(job.id, "foodBreakfast", "number", job.foodBreakfast, 'inputmode="decimal" min="0" step="0.1"', job),
    },
    {
      key: "foodLunch",
      label: "日均午餐花销",
      hintHtml: "工作日午餐约花费/日",
      renderCell: (job) => inputHtml(job.id, "foodLunch", "number", job.foodLunch, 'inputmode="decimal" min="0" step="0.1"', job),
    },
    {
      key: "foodDinner",
      label: "日均晚餐花销",
      hintHtml: "工作日晚餐约花费/日",
      renderCell: (job) => inputHtml(job.id, "foodDinner", "number", job.foodDinner, 'inputmode="decimal" min="0" step="0.1"', job),
    },
    {
      key: "foodSnack",
      label: "日均饮品零食花销",
      hintHtml: "工作日饮品零食约花费/日",
      renderCell: (job) => inputHtml(job.id, "foodSnack", "number", job.foodSnack, 'inputmode="decimal" min="0" step="0.1"', job),
    },
    {
      key: "extraIncomeMonthly",
      label: "额外收入合计（税前，按月）",
      hintHtml: "计税前",
      renderCell: (job) => {
        const row = ensureSingleCustom(job, "extraIncomes", "合计");
        return inputHtml(job.id, "__extraIncomeMonthly", "number", row.amount, 'inputmode="decimal" min="0" step="0.1"', job);
      },
    },
    {
      key: "extraExpenseMonthly",
      label: "额外支出合计（按月）",
      hintHtml: "自定义项合计",
      renderCell: (job) => {
        const row = ensureSingleCustom(job, "extraExpenses", "合计");
        return inputHtml(job.id, "__extraExpenseMonthly", "number", row.amount, 'inputmode="decimal" min="0" step="0.1"', job);
      },
    },
    // ---- 社保/公积金（输入）----
    {
      key: "hasSocialInsurance",
      label: "是否缴纳社保",
      hintHtml: "仅中国综合税制列估算五险",
      renderCell: (job) =>
        cnOnlyInputHtml(
          job,
          selectHtml(job.id, "hasSocialInsurance", job.hasSocialInsurance, [
            { value: "yes", label: "是" },
            { value: "no", label: "否" },
          ])
        ),
    },
    {
      key: "siBase",
      label: "社保基数",
      hintHtml: "不缴则0",
      renderCell: (job) =>
        cnOnlyInputHtml(
          job,
          `<div class="compare-input-stack">${inputHtml(
            job.id,
            "siBase",
            "number",
            job.hasSocialInsurance === "yes" ? job.siBase : 0,
            `inputmode="numeric" min="0" step="1" ${job.hasSocialInsurance === "yes" ? "" : "disabled"}`,
            job
          )}${cnSiHfBaseFootnoteHtml(job, "si")}</div>`
        ),
    },
    {
      key: "hasHousingFund",
      label: "是否缴纳公积金",
      hintHtml: "仅中国综合税制列估算公积金",
      renderCell: (job) =>
        cnOnlyInputHtml(
          job,
          selectHtml(job.id, "hasHousingFund", job.hasHousingFund, [
            { value: "yes", label: "是" },
            { value: "no", label: "否" },
          ])
        ),
    },
    {
      key: "hfBase",
      label: "公积金缴纳基数",
      hintHtml: "不缴则0",
      renderCell: (job) =>
        cnOnlyInputHtml(
          job,
          `<div class="compare-input-stack">${inputHtml(
            job.id,
            "hfBase",
            "number",
            job.hasHousingFund === "yes" ? job.hfBase : 0,
            `inputmode="numeric" min="0" step="1" ${job.hasHousingFund === "yes" ? "" : "disabled"}`,
            job
          )}${cnSiHfBaseFootnoteHtml(job, "hf")}</div>`
        ),
    },
    {
      key: "hfRatePct",
      label: "公积金缴纳比例（%）",
      hintHtml: "5–12%，个企同比例",
      renderCell: (job) =>
        cnOnlyInputHtml(
          job,
          inputHtml(
            job.id,
            "hfRatePct",
            "number",
            job.hasHousingFund === "yes" ? job.hfRatePct : 0,
            `inputmode="numeric" min="5" max="12" step="1" ${job.hasHousingFund === "yes" ? "" : "disabled"}`,
            job
          )
        ),
    },
    {
      key: "taxExemptExtraMonthly",
      label: "个税免税额（额外）",
      hintHtml: "除5000起征外的月减免",
      renderCell: (job) =>
        cnOnlyInputHtml(job, inputHtml(job.id, "taxExemptExtraMonthly", "number", job.taxExemptExtraMonthly, 'inputmode="numeric" min="0" step="1"', job)),
    },
    {
      key: "hkMaritalStatus",
      label: "婚姻状况",
      hintHtml: "影响香港免税额",
      renderCell: (job) =>
        hkOnlyInputHtml(
          job,
          selectHtml(job.id, "hkMaritalStatus", job.hkMaritalStatus, [
            { value: "single", label: "单身" },
            { value: "married", label: "已婚" },
          ])
        ),
    },
    {
      key: "hkAllowanceMode",
      label: "免税额口径",
      hintHtml: "已婚：基本或已婚免税额",
      renderCell: (job) =>
        hkOnlyInputHtml(
          job,
          job.hkMaritalStatus === "married"
            ? selectHtml(job.id, "hkAllowanceMode", job.hkAllowanceMode, [
                { value: "basic", label: "基本免税额（132000/年）" },
                { value: "married", label: "已婚人士免税额（264000/年）" },
              ])
            : `<span class="compare-val compare-muted">—</span>`
        ),
    },
    {
      key: "feePeriod",
      label: "税费缴纳总和",
      hintHtml: "个缴+个税（随周期）",
      renderCell: (job, c) => valueCellHtmlMoneyFx(job, c, -Math.abs(c.feePeriod), "neg"),
    },
    {
      key: "netIncomePeriod",
      label: "税后收入",
      hintHtml: "税前−五险一金−个税（随周期）",
      renderCell: (job, c) =>
        valueCellHtmlMoneyFx(job, c, c.netIncomePeriod, c.netIncomePeriod > 0 ? "pos" : c.netIncomePeriod < 0 ? "neg" : undefined),
    },
    {
      key: "housingExpensePeriod",
      label: "住房支出",
      hintHtml: "月租（随周期；不含水电）",
      renderCell: (job, c) => valueCellHtmlMoneyFx(job, c, -Math.abs(c.housingExpensePeriod), "neg"),
    },
    {
      key: "commuteExpensePeriod",
      label: "通勤支出",
      hintHtml: "工日×2×单趟（随周期）",
      renderCell: (job, c) => valueCellHtmlMoneyFx(job, c, -Math.abs(c.commuteExpensePeriod), "neg"),
    },
    {
      key: "foodExpensePeriod",
      label: "饮食支出",
      hintHtml: "工日×日饮食（随周期）",
      renderCell: (job, c) => valueCellHtmlMoneyFx(job, c, -Math.abs(c.foodExpensePeriod), "neg"),
    },
    {
      key: "totalExpensePeriod",
      label: "支出总和",
      hintHtml: "住+通+食+额外（随周期）",
      renderCell: (job, c) => valueCellHtmlMoneyFx(job, c, -Math.abs(c.totalExpensePeriod), "neg"),
    },
    {
      key: "necessaryExpenseToIncomeRatio",
      label: "必要开支收入比",
      hintHtml: "∣支出总和∣÷税前收入总额（周期）",
      renderCell: (_job, c) => {
        if (c._fxInvalid) return valueCellHtml("—", undefined);
        const g = c.grossIncomePeriod;
        if (!Number.isFinite(g) || g === 0) return valueCellHtml("—", undefined);
        const pct = (Math.abs(c.totalExpensePeriod) / g) * 100;
        return valueCellHtml(fmtPctRatioDisplay(pct), "neg");
      },
    },
    {
      key: "taxToIncomeRatio",
      label: "税费收入比",
      hintHtml: "∣税费缴纳总和∣÷税前收入总额（周期）",
      renderCell: (_job, c) => {
        if (c._fxInvalid) return valueCellHtml("—", undefined);
        const g = c.grossIncomePeriod;
        if (!Number.isFinite(g) || g === 0) return valueCellHtml("—", undefined);
        const pct = (Math.abs(c.feePeriod) / g) * 100;
        return valueCellHtml(fmtPctRatioDisplay(pct), "neg");
      },
    },
    {
      key: "netIncomeToGrossRatio",
      label: "税后收入比",
      hintHtml: "税后收入÷税前收入总额（周期）",
      renderCell: (_job, c) => {
        if (c._fxInvalid) return valueCellHtml("—", undefined);
        const g = c.grossIncomePeriod;
        if (!Number.isFinite(g) || g === 0) return valueCellHtml("—", undefined);
        const pct = (c.netIncomePeriod / g) * 100;
        return valueCellHtml(fmtPctRatioDisplay(pct), c.netIncomePeriod >= 0 ? "pos" : "neg");
      },
    },
    {
      key: "disposableIncomeToGrossRatio",
      label: "可支配所得比",
      hintHtml: "可支配所得÷税前收入总额（周期）",
      renderCell: (_job, c) => {
        if (c._fxInvalid) return valueCellHtml("—", undefined);
        const g = c.grossIncomePeriod;
        if (!Number.isFinite(g) || g === 0) return valueCellHtml("—", undefined);
        const pct = (c.savingsPeriod / g) * 100;
        return valueCellHtml(fmtPctRatioDisplay(pct), c.savingsPeriod >= 0 ? "pos" : "neg");
      },
    },
    {
      key: "onDutyHoursPerDay",
      label: "—",
      hintHtml: "同「日均工作时长」",
      renderCell: (_job, c) => valueCellHtml(fmtHours(c.onDutyHoursPerDay)),
    },
    {
      key: "restHoursOnDutyDisplay",
      label: "—",
      hintHtml: "在岗休息 h/日",
      renderCell: (_job, c) => valueCellHtml(fmtHours(c.restHoursOnDuty)),
    },
    {
      key: "actualWorkHoursPerDayDisplay",
      label: "—",
      hintHtml: "在岗−休息",
      renderCell: (_job, c) => valueCellHtml(fmtHours(c.actualWorkHoursPerDay)),
    },
    {
      key: "baseWorkHoursPerDay",
      label: "基础工作时间（每日）",
      hintHtml: "min(实际工作,8) h/日",
      renderCell: (_job, c) => valueCellHtml(fmtHours(c.baseWorkHoursPerDay), "neg"),
    },
    {
      key: "overtimeHoursPerDay",
      label: "视同加班时间（每日）",
      hintHtml: "工作−8h，≤8 为0",
      renderCell: (_job, c) => valueCellHtml(fmtHours(c.overtimeHoursPerDay), "neg"),
    },
    {
      key: "commuteHoursPerDay",
      label: "通勤时间（每日）",
      hintHtml: "单趟分×2÷60",
      renderCell: (_job, c) => valueCellHtml(fmtHours(c.commuteHoursPerDay), "neg"),
    },
    {
      key: "timeHoursPeriod",
      label: "时间付出（在岗+通勤）",
      hintHtml: "工日×(在岗+通勤)（随周期）",
      renderCell: (_job, c) => {
        const workTimePct = c.workTimePercentage > 0 ? ` (${round1(c.workTimePercentage)}% 全月)` : "";
        return valueCellHtmlWithSub(fmtHours(c.timeHoursPeriod), `占全月时间${workTimePct}`, "neg");
      },
    },
  ];

  const metricRows = (keys) =>
    METRICS.filter((m) => keys.includes(m.key))
      .map((m) => {
        const row = jobs.map((job, idx) => `<td>${m.renderCell(job, computed[idx], idx)}</td>`).join("");
        return `<tr><td>${metricCellHtml(getMetricLabel(m, jobs), getMetricHint(m, jobs))}</td>${row}</tr>`;
      })
      .join("");

  const thead = `
    <thead>
      <tr>
        <th>指标</th>
        ${jobs
          .map(
            (j, idx) => `<th class="compare-th-job">
              <div class="compare-th-job__head">
                <div class="compare-th-job__actionsRow">${actionsHtml(j.id)}</div>
                <div class="compare-th-job__nameRow">
                  <label class="compare-th-job__nameLbl" for="compare-job-name-${escapeHtml(j.id)}">工作名称</label>
                  ${inputHtml(
                    j.id,
                    "name",
                    "text",
                    j.name,
                    `id="compare-job-name-${escapeHtml(j.id)}" placeholder="工作 ${idx + 1}"`,
                    j
                  )}
                </div>
              </div>
              ${jobThMetaHtml(j)}
            </th>`
          )
          .join("")}
      </tr>
    </thead>
  `;

  const fillL1Open = uc.fill !== false;
  const inputSectionsHtml = fillL1Open
    ? `<tbody class="compare-section compare-section--l1" data-section="fill"><tr class="compare-section__head"><td colspan="${colSpan}"><button type="button" class="compare-section__toggle compare-section__toggle--l1" data-section-toggle="fill" aria-expanded="true">▼ <span class="compare-section__title">填写区</span><span class="compare-group__note">折叠全部填写分组</span></button></td></tr></tbody>
${wrapSectionTbody(
        "fill_income",
        "收入（输入）",
        "",
        metricRows(["baseSalary", "perfSalary", "bonusCoef", "workdayMode", "workHoursPerDay", "restHoursOnDuty"])
      )}
${
        anyCn
          ? wrapSectionTbody(
              "fill_si",
              "社保 / 公积金（输入）",
              "",
              metricRows(["hasSocialInsurance", "siBase", "hasHousingFund", "hfBase", "hfRatePct", "taxExemptExtraMonthly"])
            )
          : ""
      }
${
        anyHk
          ? wrapSectionTbody("fill_hk", "香港税制（输入）", "", metricRows(["hkMaritalStatus", "hkAllowanceMode"]))
          : ""
      }
${wrapSectionTbody("fill_housing", "住房（输入）", "", metricRows(["monthlyRent"]))}
${wrapSectionTbody("fill_commute", "通勤（输入）", "", metricRows(["commuteCostOneWay", "commuteMinutesOneWay"]))}
${wrapSectionTbody("fill_food", "饮食（输入）", "", metricRows(["foodBreakfast", "foodLunch", "foodDinner", "foodSnack"]))}
${wrapSectionTbody("fill_custom", "自定义（输入）", "合计项", metricRows(["extraIncomeMonthly", "extraExpenseMonthly"]))}`
    : `<tbody class="compare-section" data-section="fill"><tr class="compare-section__head"><td colspan="${colSpan}"><button type="button" class="compare-section__toggle" data-section-toggle="fill" aria-expanded="false">▶ <span class="compare-section__title">填写区（已折叠）</span><span class="compare-group__note">点击展开全部填写项</span></button></td></tr></tbody>`;

  const calcOpen = uc.calc !== false;

  const taxRegimeInner = (code) => {
    const hasJob = jobs.some((j) => getTaxModel(j) === code);
    const tIds = taxBreakdownIds.filter((id) => id.startsWith(`${code}_`));
    const wIds = welfareBreakdownIds.filter((id) => id.startsWith(`${code}_`));
    if (!hasJob || (tIds.length === 0 && wIds.length === 0)) return "";
    let out = "";
    if (tIds.length) {
      out += subgroupRow("🧾 税款", "");
      out += renderBreakdownRows("taxItems", tIds);
    }
    if (wIds.length) {
      out += subgroupRow("🛡 福利（个人）", "");
      out += renderBreakdownRows("welfareItems", wIds);
    }
    return out;
  };

  const feePeriodRowsHtml = METRICS.filter((m) => ["feePeriod"].includes(m.key))
    .map((m) => {
      const row = jobs.map((job, idx) => `<td>${m.renderCell(job, computed[idx], idx)}</td>`).join("");
      return `<tr><td>${metricCellHtml(getMetricLabel(m, jobs), getMetricHint(m, jobs))}</td>${row}</tr>`;
    })
    .join("");

  const taxRatioRowsHtml = metricRows(["taxToIncomeRatio"]);

  const taxWrapTbodyHtml = () => {
    const expanded = uc.calc_tax_wrap !== false;
    const arr = expanded ? "▼" : "▶";
    const shortcut = state.taxFeeShortcut === true;
    return `<tbody class="compare-section${expanded ? "" : " is-collapsed"}" data-section="calc_tax_wrap">
      <tr class="compare-section__head compare-section__head--tax-bundle"><td colspan="${colSpan}">
        <div class="compare-section__bar compare-section__bar--tax-bundle">
          <button type="button" class="compare-section__toggle" data-section-toggle="calc_tax_wrap" aria-expanded="${expanded}">${arr} <span class="compare-section__title">2. 税费</span></button>
          <label class="compare-tax-show-fee"><input type="checkbox" id="taxFeeShortcutChk"${shortcut ? " checked" : ""}/> <span>仅显示缴纳总和与收入比</span></label>
        </div>
      </td></tr>
      ${feePeriodRowsHtml}
      ${taxRatioRowsHtml}
    </tbody>`;
  };

  const calcIncomeInner =
    (() => {
      const incomeMode = state.incomeDisplayMode || "follow";
      let hint;
      if (incomeMode === "follow") {
        hint = "月薪+年奖折算+额外（随顶栏周期）";
      } else if (incomeMode === "minute") {
        hint = "税前÷有效工作分钟；无效时按含通勤";
      } else {
        hint = "税前÷有效工作小时；同上";
      }
      const preTaxRow = `<tr><td>${prefixedMetricCellHtml("💰", "税前收入总额", hint)}</td>${jobs
        .map((job, idx) => {
          const c = computed[idx];
          if (c._fxInvalid) return `<td>${valueCellHtml("—", undefined)}</td>`;
          const ts = incomeEfficiencyTimeSeconds(c);
          if (incomeMode === "follow") {
            return `<td>${valueCellHtmlMoneyFx(job, c, c.grossIncomePeriod, "pos")}</td>`;
          }
          let amountComp;
          let val;
          if (incomeMode === "minute") {
            amountComp =
              ts > 0
                ? (c.grossIncomePeriod / ts) * 60
                : (c.grossIncomePeriod / (c.timeSecondsPeriod || 1)) * 60;
            val = `${fmtMoney(amountComp)} ${cc}/分钟`;
          } else {
            amountComp =
              ts > 0 ? c.grossIncomePeriod / (ts / 3600) : c.grossIncomePeriod / (c.timeSecondsPeriod / 3600);
            val = `${fmtMoney(amountComp)} ${cc}/小时`;
          }
          return `<td>${valueCellHtmlMoneyFxCustomMain(job, c, amountComp, val, "pos")}</td>`;
        })
        .join("")}</tr>`;
      const metricPart = METRICS.filter((m) => ["grossMonthly", "bonusAnnual", "extraIncomeMonthlyComputed"].includes(m.key))
        .map((m) => {
          const row = jobs.map((job, idx) => `<td>${m.renderCell(job, computed[idx], idx)}</td>`).join("");
          return `<tr><td>${metricCellHtml(getMetricLabel(m, jobs), getMetricHint(m, jobs))}</td>${row}</tr>`;
        })
        .join("");
      return preTaxRow + metricPart;
    })();

  const calcResultInner =
    `${METRICS.filter((m) => ["netIncomePeriod"].includes(m.key))
      .map((m) => {
        const row = jobs.map((job, idx) => `<td>${m.renderCell(job, computed[idx], idx)}</td>`).join("");
        return `<tr><td>${metricCellHtml(getMetricLabel(m, jobs), getMetricHint(m, jobs))}</td>${row}</tr>`;
      })
      .join("")}
      ${metricRows(["netIncomeToGrossRatio"])}
      ${(() => {
        const hint = DISPOSABLE_SAVINGS_HINT_HTML;
        return `<tr><td>${prefixedMetricCellHtml("💳", "可支配所得", hint)}</td>${jobs
          .map((job, idx) => {
            const c = computed[idx];
            if (c._fxInvalid) return `<td>${valueCellHtml("—", undefined)}</td>`;
            const sp = c.savingsPeriod;
            return `<td>${valueCellHtmlMoneyFx(job, c, c.savingsPeriod, sp > 0 ? "pos" : sp < 0 ? "neg" : undefined)}</td>`;
          })
          .join("")}</tr>`;
      })()}${metricRows(["disposableIncomeToGrossRatio"])}`;

  const effUnit = normalizeEfficiencyTimeUnit(state.efficiencyTimeUnit);
  const uPart = efficiencyRowLabelUnit(effUnit);
  const effOpts = {
    includeCommute: state.efficiencyIncludeCommute !== false,
    includeOvertime: state.efficiencyIncludeOvertime !== false,
  };
  const eh = efficiencyRowHintsForUnit(effUnit, effOpts);
  const effTitles =
    effUnit === "minute" || effUnit === "hour"
      ? [`每${uPart}税前收入`, `每${uPart}税费后收入`, `每${uPart}可支配所得`]
      : [`每${uPart}税前收入`, `每${uPart}税费后收入`, `每${uPart}可支配所得（含通勤）`];
  const calcEfficiencyInner = [0, 1, 2]
    .map((ri) => {
      const cells = jobs
        .map((job, idx) => {
          const c = computed[idx];
          const p = formatEfficiencyTripleParts(c, effUnit, effOpts);
          const v = ri === 0 ? p.r1 : ri === 1 ? p.r2 : p.r3;
          const kind = v > 0 ? "pos" : v < 0 ? "neg" : undefined;
          return `<td>${valueCellHtmlMoneyFxCustomMain(job, c, v, formatEfficiencyMoney(v, effUnit, cc), kind)}</td>`;
        })
        .join("");
      return `<tr><td>${metricCellHtml(effTitles[ri], eh[ri])}</td>${cells}</tr>`;
    })
    .join("");

  const calcFxInner = `
      <tr>
        <td>${prefixedMetricCellHtml("💱", "汇率（收入→比较）", "收入币兑比较币")}</td>
        ${jobs.map((job) => `<td>${fxRateCellHtml(job)}</td>`).join("")}
      </tr>
      <tr>
        <td>${prefixedMetricCellHtml("📊", "示例换算", "1万收入币→比较币")}</td>
        ${jobs.map((job) => `<td>${fxSampleCellHtml(job)}</td>`).join("")}
      </tr>
`;

  let tbody = showInputs ? inputSectionsHtml : "";
  if (calcOpen) {
    tbody += `<tbody class="compare-section compare-section--l1" data-section="calc"><tr class="compare-section__head"><td colspan="${colSpan}"><button type="button" class="compare-section__toggle compare-section__toggle--l1" data-section-toggle="calc" aria-expanded="true">▼ <span class="compare-section__title">计算区</span><span class="compare-group__note">折叠全部自动计算分组</span></button></td></tr></tbody>`;
    tbody += wrapSectionTbody(
      "calc_fx",
      "汇率与换算",
      "Frankfurter，仅供参考。首次将收入货币或比较货币换为新币种时，拉取汇率可能需要十余秒，属正常等待而非刷新失败。",
      calcFxInner
    );
    tbody += wrapSectionTbody("calc_income", "1. 收入", "", calcIncomeInner);
    const trCn = taxRegimeInner("cn");
    const trUs = taxRegimeInner("us");
    const trHk = taxRegimeInner("hk");
    tbody += taxWrapTbodyHtml();
    if (!state.taxFeeShortcut) {
      if (trCn) tbody += wrapSectionTbody("calc_tax_cn", "2a. 中国税制", "分项；可折叠", trCn, taxChildClass);
      if (trUs) tbody += wrapSectionTbody("calc_tax_us", "2b. 美国 W-2", "分项；可折叠", trUs, taxChildClass);
      if (trHk) tbody += wrapSectionTbody("calc_tax_hk", "2c. 香港税制", "分项；可折叠", trHk, taxChildClass);
    }
    tbody += wrapSectionTbody(
      "calc_expense",
      "3. 就业地必要开支",
      "租按月；食/通勤按工日",
      metricRows([
        "housingExpensePeriod",
        "commuteExpensePeriod",
        "foodExpensePeriod",
        "totalExpensePeriod",
        "necessaryExpenseToIncomeRatio",
      ])
    );
    tbody += wrapSectionTbody("calc_result", "4. 所得", "税后与可支配（随周期）", calcResultInner);
    tbody += wrapSectionTbody(
      "calc_time",
      "时间",
      "",
      metricRows([
        "onDutyHoursPerDay",
        "restHoursOnDutyDisplay",
        "actualWorkHoursPerDayDisplay",
        "baseWorkHoursPerDay",
        "overtimeHoursPerDay",
        "commuteHoursPerDay",
        "timeHoursPeriod",
      ])
    );
    tbody += wrapEfficiencySection("calc_eff", "报酬效率", "", calcEfficiencyInner);
  } else {
    tbody += `<tbody class="compare-section" data-section="calc"><tr class="compare-section__head"><td colspan="${colSpan}"><button type="button" class="compare-section__toggle" data-section-toggle="calc" aria-expanded="false">▶ <span class="compare-section__title">计算区（已折叠）</span><span class="compare-group__note">点击展开全部自动计算</span></button></td></tr></tbody>`;
  }

  host.innerHTML = `<table class="compare-table">${thead}${tbody}</table>`;

  const needsCnPca = jobs.some((j) => regionEconomyTier(j.region) === "cn");
  if (needsCnPca && !cnPcasTree && !cnPcaLoadError) {
    void ensureCnPcaLoaded()
      .then(() => renderCompareTablePreserveFocus())
      .catch(() => renderCompareTablePreserveFocus());
  }
  const needsCnWage = jobs.some((j) => regionEconomyTier(j.region) === "cn" && normalizeAdcode6(j.cnCityAdcode));
  if (needsCnWage && cnSocialWageByAdcode === null) {
    void ensureCnSocialWageLoaded().then(() => renderCompareTablePreserveFocus());
  }
}

function renderTaxDetail(job, c) {
  const periodLabelText = periodLabel();
  const cc = getCompareCurrencyCode();
  const inc = MAJOR_CURRENCY_CODES.has(job.incomeCurrency) ? job.incomeCurrency : "CNY";
  const lines = [];
  lines.push(`展示口径：${periodLabelText}（统计货币：${cc}）`);
  if (inc !== cc && c._fxRate != null && Number.isFinite(c._fxRate) && c._fxRate > 0) {
    lines.push(`金额已从收入货币 ${inc} 按汇率换算为 ${cc} 展示。`);
    lines.push(`沿用汇率：1 ${inc} = ${fmtFxRate(c._fxRate)} ${cc}`);
  }
  lines.push("");

  if (getTaxModel(job) === "us") {
    lines.push(`美国 W-2 估算（税年 ${c.usTaxYear ?? US_TAX_YEAR}，申报 ${c.usFilingStatus ?? "Single"}，州：${c.usStateCode ?? "—"}）`);
    lines.push("未建模：401(k)、HSA、分项扣除、AMT、地方税、1099 自雇税等。");
    lines.push("");
    lines.push("【年度工资口径】");
    lines.push(`年度工资（含年终与税前额外收入折算）≈ ${fmtMoney(c.annualGrossAll)} ${cc}`);
    lines.push("");
    lines.push("【FICA（雇员）】");
    lines.push(`Social Security 年度 ≈ ${fmtMoney(c.usAnnualSsEmployee)} ${cc}（6.2%，至工资基数上限 ${fmtMoney(US_SS_WAGE_BASE_2024)}）`);
    lines.push(`Medicare 年度 ≈ ${fmtMoney(c.usAnnualMedicareEmployee)} ${cc}（含 1.45% 与超过 $${US_MEDICARE_ADD_THRESHOLD_SINGLE_2024} 的 0.9% 附加）`);
    lines.push(`FICA 雇员合计/月 ≈ ${fmtMoney(c.usMonthlyFica)} ${cc}`);
    lines.push("");
    lines.push("【联邦所得税】");
    lines.push(`标准扣除（Single）≈ ${fmtMoney(c.annualStdDeduction)} ${cc}`);
    lines.push(`联邦应税所得 ≈ ${fmtMoney(c.taxableAnnual)} ${cc}`);
    lines.push(`联邦边际税率（参考）：${fmtPctFromRate(c.bracket.rate)}%`);
    lines.push(`联邦所得税年度 ≈ ${fmtMoney(c.usAnnualFederal)} ${cc}；月 ≈ ${fmtMoney(c.usMonthlyFederal)} ${cc}`);
    lines.push("");
    lines.push("【州所得税】");
    if ((c.usAnnualState ?? 0) <= 0) {
      lines.push("本州无个人所得税（或估算为 0）。");
    } else {
      lines.push(`州所得税年度 ≈ ${fmtMoney(c.usAnnualState)} ${cc}；月 ≈ ${fmtMoney(c.usMonthlyState)} ${cc}`);
    }
    lines.push("");
    lines.push(`所得税预扣合计/月（联邦+州）≈ ${fmtMoney(c.monthlyIIT)} ${cc}`);
    lines.push("");
    lines.push("说明：联邦应税所得未再扣除 FICA；为教学用简化。不构成税务建议。");
  } else if (getTaxModel(job) === "pending") {
    lines.push("本列国家/地区税制未实装：未计算任何税费或个人法定扣缴。");
    lines.push(`年度税前入息（展示）≈ ${fmtMoney(c.annualGrossAll)} ${cc}；税后收入（按月）≈ ${fmtMoney(c.netMonthlySalary)} ${cc}（与税前收入相同，未扣税）。`);
    lines.push("");
    lines.push("说明：对比用展示，不构成税务建议。");
  } else if (getTaxModel(job) === "none") {
    lines.push("本列税制为「不使用」：未计算任何税费或个人法定扣缴。");
    lines.push(`年度税前入息（展示）≈ ${fmtMoney(c.annualGrossAll)} ${cc}；税后收入（按月）≈ ${fmtMoney(c.netMonthlySalary)} ${cc}（与税前收入相同，未扣税）。`);
    lines.push("");
    lines.push("说明：对比用展示，不构成税务建议。");
  } else if (getTaxModel(job) === "hk") {
    lines.push(`香港 强积金（雇员）+ 薪俸税（估算，课税年度 ${c.hkTaxYearLabel ?? HK_TAX_YEAR_LABEL}）`);
    lines.push("对比用简化口径，不构成税务建议。未建模：子女/供养父母免税额、物业利息、自愿医保、合并评税与配偶入息等。");
    lines.push("");
    lines.push("【年度税前入息（估算）】");
    lines.push(`（税前月薪+税前额外按月）×12 + 年终（系数×税前基本月薪）≈ ${fmtMoney(c.annualGrossAll)} ${cc}`);
    lines.push("");
    lines.push("【强积金（雇员）】");
    lines.push(
      `月薪有关入息阶梯（对比用）：低于 ${fmtMoney(HK_MPF_RELEVANT_INCOME_MIN)} 免雇员供款；${fmtMoney(HK_MPF_RELEVANT_INCOME_MIN)}～${fmtMoney(
        HK_MPF_RELEVANT_INCOME_CAP
      )} 按 ${fmtPctFromRate(HK_MPF_EMPLOYEE_RATE)}%；超过则雇员月封顶 ${fmtMoney(HK_MPF_EMPLOYEE_MAX_MONTHLY)}。`
    );
    lines.push(
      `雇员年度供款 ≈ ${fmtMoney(c.hkAnnualMpfEmployee)} ${cc}；薪俸税可扣除认可强积金上限 ${fmtMoney(HK_MPF_MAX_TAX_DEDUCTION_ANNUAL)}/年，本工具扣除额 ≈ ${fmtMoney(
        c.hkMpfTaxDeductionAnnual
      )} ${cc}。`
    );
    lines.push(`强积金（雇员）/月 ≈ ${fmtMoney(c.fiveInsHfDeductPersonal)} ${cc}`);
    lines.push("");
    lines.push("【薪俸税（累进 vs 标准税率取低）】");
    lines.push(`净入息（扣除认可强积金后）≈ ${fmtMoney(c.hkNetAssessableIncome)} ${cc}`);
    lines.push(`免税额（本工具选项）≈ ${fmtMoney(c.hkAllowanceAnnual)} ${cc}`);
    lines.push(`净应课税入息 ≈ ${fmtMoney(c.hkNetChargeableIncome)} ${cc}`);
    lines.push(
      `累进税额 ≈ ${fmtMoney(c.hkProgressiveTax)} ${cc}；标准税率（${fmtPctFromRate(HK_STANDARD_SALARIES_RATE)}%×净入息）≈ ${fmtMoney(
        c.hkStandardTax
      )} ${cc}；取较低 ≈ ${fmtMoney(c.hkAnnualSalariesTax)} ${cc}/年`
    );
    lines.push(`折算月薪俸税 ≈ ${fmtMoney(c.monthlyIIT)} ${cc}/月（净应课税边际约 ${fmtPctFromRate(c.bracket.rate)}%）`);
    lines.push("");
    lines.push("说明：此处为跨地区对比用估算，非税务意见。");
  } else if (getTaxModel(job) === "cn") {
    lines.push("【月应税部分（用于估算）】");
    lines.push(`五险一金(个人) = 个人社保 + 个人医保 + 个人公积金`);
    lines.push(`= ${fmtMoney(c.fiveInsHfDeductPersonal)} ${cc}/月`);
    lines.push(`额外免税额（不含5000起征点）= ${fmtMoney(c.taxExemptExtraMonthly)} ${cc}/月`);
    lines.push(`月应税部分 = max(0, 税前月薪 - 五险一金(个人) - 5000 - 额外免税额)`);
    lines.push(`= max(0, ${fmtMoney(c.grossMonthly)} - ${fmtMoney(c.fiveInsHfDeductPersonal)} - 5000 - ${fmtMoney(c.taxExemptExtraMonthly)})`);
    lines.push(`= ${fmtMoney(c.taxableMonthly)} ${cc}/月`);
    lines.push("");
    lines.push("【年度化估算（并入年终奖）】");
    lines.push(`年度税前收入（展示用）= 税前月薪×12 + 年终奖金(系数×税前基本月薪)`);
    lines.push(`= ${fmtMoney(c.annualGross)} ${cc}`);
    lines.push(`年度基本减除费用（展示用）= ${fmtMoney(c.annualStdDeduction)} ${cc}`);
    lines.push(`年度扣除(个人社保+医保+公积金)（展示用）≈ ${fmtMoney(c.annualInsDeduct)} ${cc}`);
    lines.push(`年度应纳税所得额（估算）= max(0, 月应税部分×12 + 年终奖)`);
    lines.push(`= ${fmtMoney(c.taxableAnnual)} ${cc}`);
    lines.push("");
    const { lower, upper } = iitBracketRange(c.bracket);
    const upperText = Number.isFinite(upper) ? fmtMoney(upper) : "∞";
    lines.push(`税率档位：(${fmtMoney(lower)}, ${upperText}]  边际税率：${fmtPctFromRate(c.bracket.rate)}%`);
    lines.push(`速算扣除数：${fmtMoney(c.bracket.quick)} ${cc}`);
    lines.push(`年度个税 ≈ ${fmtMoney(c.annualIIT)} ${cc}`);
    lines.push(`折算月个税 ≈ ${fmtMoney(c.monthlyIIT)} ${cc}/月`);
    lines.push("");
    lines.push("说明：此处为对比用估算，未计入专项附加扣除、不同地区基数上下限等差异。");
  }

  const body = document.getElementById("taxDialogBody");
  if (!body) return;
  body.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "tax-detail";

  const summary = document.createElement("div");
  const fxNote =
    inc !== cc && c._fxRate != null && Number.isFinite(c._fxRate) && c._fxRate > 0
      ? `<div>已从 <b>${escapeHtml(inc)}</b> 按 1 ${escapeHtml(inc)} = ${escapeHtml(fmtFxRate(c._fxRate))} ${escapeHtml(cc)} 换算为展示货币。</div>`
      : "";
  summary.innerHTML = `
    <div style="color: var(--muted); font-size:12px; line-height:1.6;">
      <div>工作：<b>${escapeHtml(job.name || "未命名")}</b></div>
      ${fxNote}
      <div>税后收入（按月，含额外收入）≈ <b style="color: var(--green)">${fmtMoney(jobSafe(c.netMonthlySalary))}</b> ${escapeHtml(cc)}</div>
    </div>
  `;

  const pre = document.createElement("pre");
  pre.textContent = lines.join("\n");

  wrap.appendChild(summary);
  wrap.appendChild(pre);
  body.appendChild(wrap);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jobSafe(n) {
  return Number.isFinite(n) ? n : 0;
}

function applyDeps(cardEl, job) {
  /** @type {NodeListOf<HTMLElement>} */
  const depNodes = cardEl.querySelectorAll("[data-dep]");
  depNodes.forEach((node) => {
    const dep = node.getAttribute("data-dep") || "";
    const [field, expected] = dep.split(":");
    const actual = String(job[field] ?? "");
    const enabled = actual === expected;

    /** @type {HTMLInputElement | HTMLSelectElement | null} */
    const input = node.querySelector("input,select");
    if (input) input.disabled = !enabled;
    node.classList.toggle("hidden", !enabled);
  });
}

function renderCustomList(cardEl, job, key) {
  const listEl = cardEl.querySelector(`[data-list="${key}"]`);
  if (!listEl) return;
  listEl.innerHTML = "";

  const tpl = document.getElementById("customRowTpl");
  const rows = Array.isArray(job[key]) ? job[key] : [];
  rows.forEach((row, idx) => {
    const frag = tpl.content.cloneNode(true);
    const rowEl = frag.querySelector(".custom-row");
    rowEl.dataset.listKey = key;
    rowEl.dataset.index = String(idx);
    /** @type {HTMLInputElement} */ (frag.querySelector(".custom-row__name")).value = row?.name ?? "";
    /** @type {HTMLInputElement} */ (frag.querySelector(".custom-row__amount")).value = String(asNumber(row?.amount) || "");
    listEl.appendChild(frag);
  });
}

function renderJobCard(job) {
  const tpl = document.getElementById("jobCardTpl");
  const frag = tpl.content.cloneNode(true);
  /** @type {HTMLElement} */
  const cardEl = frag.querySelector(".job-card");
  cardEl.dataset.jobId = job.id;

  // fill inputs
  /** @type {NodeListOf<HTMLInputElement | HTMLSelectElement>} */
  const inputs = cardEl.querySelectorAll("[data-field]");
  inputs.forEach((inp) => {
    const field = inp.dataset.field;
    const v = job[field];
    if (inp instanceof HTMLSelectElement) inp.value = String(v ?? inp.value);
    else inp.value = v ? String(v) : "";
  });

  // tabs
  cardEl.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      cardEl.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-active", b === btn));
      cardEl.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("is-active", p.getAttribute("data-pane") === tab));
    });
  });

  renderCustomList(cardEl, job, "extraIncomes");
  renderCustomList(cardEl, job, "extraExpenses");

  applyDeps(cardEl, job);
  updateJobOutputs(cardEl, job);
  return frag;
}

function updateJobOutputs(cardEl, job) {
  const c = calc(job);
  setText(cardEl.querySelector('[data-out="grossMonthly"]'), fmtMoneyWithUnit(c.grossMonthly));
  setText(cardEl.querySelector('[data-out="workdaysHint"]'), c.workdaysHint);

  // KPI
  setText(cardEl.querySelector('[data-out="perMinute"]'), fmtMoney(c.perMinute) + " /min");
  setText(cardEl.querySelector('[data-out="personalNet"]'), fmtMoney(c.savingsPeriod) + " 元");
  setText(cardEl.querySelector('[data-out="netIncome"]'), fmtMoney(c.netIncomePeriod) + " 元");

  // results (expenses)
  setMoney(cardEl.querySelector('[data-out="housingExpense"]'), -Math.abs(c.housingExpensePeriod));
  setMoney(cardEl.querySelector('[data-out="commuteExpense"]'), -Math.abs(c.commuteExpensePeriod));
  setMoney(cardEl.querySelector('[data-out="foodExpense"]'), -Math.abs(c.foodExpensePeriod));
  setMoney(cardEl.querySelector('[data-out="totalExpense"]'), -Math.abs(c.totalExpensePeriod));

  // results (income)
  setMoney(cardEl.querySelector('[data-out="netIncome2"]'), c.netIncomePeriod);

  // net
  setMoney(cardEl.querySelector('[data-out="personalNet2"]'), c.savingsPeriod);

  // insurance both
  setMoney(cardEl.querySelector('[data-out="medicalBoth"]'), -(c.medicalPersonal + c.medicalCompany) * (state.period === PERIODS.year ? 12 : state.period === PERIODS.day ? 1 / c.workdays : 1));
  setMoney(cardEl.querySelector('[data-out="socialBoth"]'), -(c.socialPersonal + c.socialCompany) * (state.period === PERIODS.year ? 12 : state.period === PERIODS.day ? 1 / c.workdays : 1));
  setMoney(cardEl.querySelector('[data-out="housingFundBoth"]'), -(c.hfPersonal + c.hfCompany) * (state.period === PERIODS.year ? 12 : state.period === PERIODS.day ? 1 / c.workdays : 1));

  // time and per value
  setText(cardEl.querySelector('[data-out="timeHours"]'), fmtHours(c.timeHoursPeriod));
  setMoney(cardEl.querySelector('[data-out="perSecond"]'), c.perSecond);
  setMoney(cardEl.querySelector('[data-out="perMinute2"]'), c.perMinute);
  setMoney(cardEl.querySelector('[data-out="perHour"]'), c.perHour);

  // keep colors for personalNet
  const netEl = cardEl.querySelector('[data-out="personalNet2"]');
  if (netEl) {
    netEl.classList.toggle("pos", c.savingsPeriod > 0);
    netEl.classList.toggle("neg", c.savingsPeriod < 0);
  }
}

function updateDemoChrome() {
  const banner = document.getElementById("demoBanner");
  const enterBtn = document.getElementById("enterDemoBtn");
  if (banner) banner.classList.toggle("is-hidden", !state.demoActive);
  if (enterBtn) enterBtn.classList.toggle("is-hidden", !!state.demoActive);
}

/** 展示口径 period 字段反推「按月」金额（与 calc 中 toPeriod 一致） */
function salarySplitVizPeriodScale(job) {
  const wd = workdaysForMode(job.workdayMode);
  const p = state.period;
  if (p === PERIODS.year) return 12;
  if (p === PERIODS.day) return 1 / wd;
  return 1;
}

/** @param {any} m @param {any} job */
function salarySplitVizExpenseMonthlyParts(m, job) {
  const s = salarySplitVizPeriodScale(job);
  const rent = Number.isFinite(m.housingExpensePeriod) ? m.housingExpensePeriod / s : 0;
  const comm = Number.isFinite(m.commuteExpensePeriod) ? m.commuteExpensePeriod / s : 0;
  const food = Number.isFinite(m.foodExpensePeriod) ? m.foodExpensePeriod / s : 0;
  const total = Number.isFinite(m.totalExpenseMonthly) ? m.totalExpenseMonthly : 0;
  let extra = total - rent - comm - food;
  if (!Number.isFinite(extra) || extra < 0) extra = 0;
  return { rentM: rent, commuteM: comm, foodM: food, extraM: extra };
}

let salarySplitVizHoverSeg = null;

function hideSalarySplitTooltip() {
  const tip = document.getElementById("salarySplitTooltip");
  if (tip) tip.classList.add("is-hidden");
  if (salarySplitVizHoverSeg) {
    salarySplitVizHoverSeg.classList.remove("is-viz-hover");
    salarySplitVizHoverSeg = null;
  }
}

function positionSalarySplitTooltip(tip, seg) {
  if (!tip || !seg) return;
  tip.classList.remove("is-hidden");
  tip.style.position = "fixed";
  tip.style.visibility = "hidden";
  tip.style.left = "-10000px";
  tip.style.top = "0";
  const tw = tip.offsetWidth || 260;
  const th = tip.offsetHeight || 100;
  const r = seg.getBoundingClientRect();
  const margin = 8;
  let left = r.left + r.width / 2 - tw / 2;
  let top = r.bottom + margin;
  if (top + th > window.innerHeight - margin) top = Math.max(margin, r.top - th - margin);
  left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - th - margin));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tip.style.visibility = "";
}

/** @param {HTMLElement} tip @param {string} jobId @param {string} part fee|exp|sav|def */
function fillSalarySplitTooltipContent(tip, jobId, part) {
  const host = document.getElementById("salarySplitVizHost");
  const map = host && host.__vizRowByJobId;
  if (!tip || !map) return;
  const row = map.get(jobId);
  if (!row) return;
  const { gross, fee, exp, sav, m, expenseParts } = row;
  const pctNum = (x) => (gross > 0 && Number.isFinite(x) ? ((x / gross) * 100).toFixed(1) : null);

  if (part === "fee") {
    const tb = m.taxBreakdown || { taxItems: [], welfareItems: [] };
    const items = [];
    for (const x of tb.taxItems || []) {
      if (Number.isFinite(x.amountMonthly) && Math.abs(x.amountMonthly) > 1e-9) {
        items.push(
          `<div class="viz-salary-split__tooltipItem"><span>${escapeHtml(x.label)}</span><span>${fmtMoneyWithCompareUnit(x.amountMonthly)}</span></div>`
        );
      }
    }
    for (const x of tb.welfareItems || []) {
      if (Number.isFinite(x.amountMonthly) && Math.abs(x.amountMonthly) > 1e-9) {
        items.push(
          `<div class="viz-salary-split__tooltipItem"><span>${escapeHtml(x.label)}</span><span>${fmtMoneyWithCompareUnit(x.amountMonthly)}</span></div>`
        );
      }
    }
    const pf = pctNum(fee);
    tip.innerHTML = `
      <div class="viz-salary-split__tooltipTitle">个人扣缴</div>
      <p class="viz-salary-split__tooltipLine">合计 <strong>${fmtMoneyWithCompareUnit(fee)}</strong> · 占税前毛收入 <strong>${pf != null ? `${pf}%` : "—"}</strong></p>
      ${
        items.length
          ? `<div class="viz-salary-split__tooltipSub">组成</div>${items.join("")}`
          : `<p class="viz-salary-split__tooltipLine">（无分项明细）</p>`
      }`;
    return;
  }

  if (part === "exp" && expenseParts) {
    const { rentM, commuteM, foodM, extraM } = expenseParts;
    const pe = pctNum(exp);
    tip.innerHTML = `
      <div class="viz-salary-split__tooltipTitle">必要开支</div>
      <p class="viz-salary-split__tooltipLine">合计 <strong>${fmtMoneyWithCompareUnit(exp)}</strong> · 占税前毛收入 <strong>${pe != null ? `${pe}%` : "—"}</strong></p>
      <div class="viz-salary-split__tooltipSub">组成（按月）</div>
      <div class="viz-salary-split__tooltipItem"><span>住房</span><span>${fmtMoneyWithCompareUnit(rentM)}</span></div>
      <div class="viz-salary-split__tooltipItem"><span>通勤</span><span>${fmtMoneyWithCompareUnit(commuteM)}</span></div>
      <div class="viz-salary-split__tooltipItem"><span>工作日饮食</span><span>${fmtMoneyWithCompareUnit(foodM)}</span></div>
      <div class="viz-salary-split__tooltipItem"><span>其他必要支出</span><span>${fmtMoneyWithCompareUnit(extraM)}</span></div>`;
    return;
  }

  if (part === "sav") {
    const ps = pctNum(sav);
    tip.innerHTML = `
      <div class="viz-salary-split__tooltipTitle">可支配所得</div>
      <p class="viz-salary-split__tooltipLine">金额 <strong>${fmtMoneyWithCompareUnit(sav)}</strong> · 占税前毛收入 <strong>${ps != null ? `${ps}%` : "—"}</strong></p>
      <p class="viz-salary-split__tooltipLine">口径：税前毛收入 − 个人扣缴 − 必要开支（与对比表「所得」一致）。</p>`;
    return;
  }

  if (part === "def") {
    const deficit = -sav;
    const pd = pctNum(deficit);
    tip.innerHTML = `
      <div class="viz-salary-split__tooltipTitle">超支（可支配为负）</div>
      <p class="viz-salary-split__tooltipLine">缺口约 <strong>${fmtMoneyWithCompareUnit(deficit)}</strong> · 占税前毛收入 <strong>${pd != null ? `${pd}%` : "—"}</strong></p>
      <p class="viz-salary-split__tooltipLine">个人扣缴与必要开支合计超过税前毛收入时的赤字示意。</p>`;
  }
}

function initSalarySplitVizInteractions() {
  const host = document.getElementById("salarySplitVizHost");
  const tip = document.getElementById("salarySplitTooltip");
  if (!host || !tip || host.dataset.salarySplitVizBound === "1") return;
  host.dataset.salarySplitVizBound = "1";

  host.addEventListener("pointerout", (e) => {
    const rt = /** @type {Node|null} */ (e.relatedTarget);
    if (rt && host.contains(rt)) return;
    hideSalarySplitTooltip();
  });

  host.addEventListener("pointermove", (e) => {
    const seg = /** @type {HTMLElement|null} */ (e.target && e.target.closest && e.target.closest("[data-viz-seg]"));
    if (!seg || !host.contains(seg)) {
      hideSalarySplitTooltip();
      return;
    }
    const jobId = seg.getAttribute("data-job-id");
    const part = seg.getAttribute("data-viz-seg");
    if (!jobId || !part) return;
    if (salarySplitVizHoverSeg !== seg) {
      if (salarySplitVizHoverSeg) salarySplitVizHoverSeg.classList.remove("is-viz-hover");
      salarySplitVizHoverSeg = seg;
      seg.classList.add("is-viz-hover");
      fillSalarySplitTooltipContent(tip, jobId, part);
      requestAnimationFrame(() => positionSalarySplitTooltip(tip, seg));
      return;
    }
    positionSalarySplitTooltip(tip, seg);
  });
}

const SALARY_SPLIT_LEGEND_LABELS = {
  fee: "个人扣缴（税与五险一金个人等）",
  exp: "必要开支（住、行、食等）",
  sav: "可支配所得",
};

/** 更新横轴刻度与竖线（与绘图区同宽，仅中间列） */
function renderSalarySplitAxisStrip(gMax, hasValidRow) {
  const tickHost = document.getElementById("salarySplitAxisTicks");
  const q1 = document.getElementById("salarySplitAxisQ1");
  const q2 = document.getElementById("salarySplitAxisQ2");
  const q3 = document.getElementById("salarySplitAxisQ3");
  const axis0 = document.getElementById("salarySplitAxis0");
  const axisMax = document.getElementById("salarySplitAxisMax");
  if (!tickHost || !q1 || !q2 || !q3 || !axis0 || !axisMax) return;
  if (!hasValidRow || !Number.isFinite(gMax) || gMax <= 0) {
    tickHost.innerHTML = "";
    q1.textContent = "—";
    q2.textContent = "—";
    q3.textContent = "—";
    axis0.textContent = "0";
    axisMax.textContent = "—";
    return;
  }
  tickHost.innerHTML = [0, 0, 0, 0, 0]
    .map(
      () =>
        `<div class="viz-salary-split__axisTickCol" aria-hidden="true"><div class="viz-salary-split__axisTickStem"></div></div>`
    )
    .join("");
  q1.textContent = fmtMoney(gMax * 0.25);
  q2.textContent = fmtMoney(gMax * 0.5);
  q3.textContent = fmtMoney(gMax * 0.75);
  axis0.textContent = fmtMoney(0);
  axisMax.textContent = fmtMoney(gMax);
}

const SALARY_SPLIT_VB_W = 1000;
const SALARY_SPLIT_VB_H = 22;

/**
 * 全宽 viewBox 表示 0…Gmax；段宽 = amount/Gmax×VB_W，屏上宽度 = amount/Gmax×绘图区宽（跨行可比）。段内不再绘文字，避免非等比拉伸压扁。
 * @param {("fee"|"exp"|"sav")[]} order
 * @param {{ fee: number, exp: number, sav: number, gross: number, name: string, job: { id: string } }} rowCtx
 * @param {number} gMaxAxis 全表最大毛收入（与横轴比例尺一致）
 * @param {string} compare 比较货币代码
 */
function buildSalarySplitSvgTrack(order, rowCtx, gMaxAxis, compare) {
  const { fee, exp, sav, gross, name, job } = rowCtx;
  const jid = escapeHtml(String(job.id));
  const VB_W = SALARY_SPLIT_VB_W;
  const VB_H = SALARY_SPLIT_VB_H;
  const barW = gMaxAxis > 0 && Number.isFinite(gross) ? (gross / gMaxAxis) * VB_W : 0;
  let x = 0;
  let inner = "";
  if (sav >= 0) {
    for (const key of order) {
      let amount = 0;
      let segClass = "";
      /** @type {string} */
      let vizSeg = "fee";
      if (key === "fee") {
        amount = fee;
        segClass = "fee";
        vizSeg = "fee";
      } else if (key === "exp") {
        amount = exp;
        segClass = "exp";
        vizSeg = "exp";
      } else {
        amount = sav;
        segClass = "sav";
        vizSeg = "sav";
      }
      const wRaw = gMaxAxis > 0 && Number.isFinite(amount) && amount > 1e-12 ? (amount / gMaxAxis) * VB_W : 0;
      if (wRaw > 0) {
        inner += `<rect class="viz-salary-split__seg viz-salary-split__svgSeg viz-salary-split__seg--${segClass}" x="${x}" y="0" width="${wRaw}" height="${VB_H}" data-job-id="${jid}" data-viz-seg="${vizSeg}" rx="2" ry="2"/>`;
      }
      x += wRaw;
    }
  } else {
    const deficit = -sav;
    const denom = fee + exp + deficit;
    const safeDenom = denom > 1e-12 ? denom : 1;
    for (const key of order) {
      let frac = 0;
      let segClass = "";
      /** @type {string} */
      let vizSeg = "fee";
      if (key === "fee") {
        frac = fee / safeDenom;
        segClass = "fee";
        vizSeg = "fee";
      } else if (key === "exp") {
        frac = exp / safeDenom;
        segClass = "exp";
        vizSeg = "exp";
      } else {
        frac = deficit / safeDenom;
        segClass = "def";
        vizSeg = "def";
      }
      const rw = frac * barW;
      if (rw > 0) {
        inner += `<rect class="viz-salary-split__seg viz-salary-split__svgSeg viz-salary-split__seg--${segClass}" x="${x}" y="0" width="${rw}" height="${VB_H}" data-job-id="${jid}" data-viz-seg="${vizSeg}" rx="2" ry="2"/>`;
      }
      x += rw;
    }
  }
  const barEnd = barW;
  const rest = VB_W - barEnd;
  if (rest > 0.25) {
    inner += `<rect class="viz-salary-split__svgUnused" x="${barEnd}" y="0" width="${rest}" height="${VB_H}" pointer-events="none"/>`;
  }
  const aria = `${escapeHtml(name)}：税前毛收入 ${fmtMoney(gross)} ${compare}`;
  return `<svg class="viz-salary-split__svg" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none" role="img" aria-label="${aria}"><g>${inner}</g></svg>`;
}

/** @template T @param {T[]} arr @param {number} fromIdx @param {number} toIdx */
function arrayMove(arr, fromIdx, toIdx) {
  const next = arr.slice();
  const [el] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, el);
  return next;
}

function renderSalarySplitLegend() {
  const host = document.getElementById("salarySplitLegendHost");
  if (!host) return;
  const order = normalizeSalarySplitSegOrder(state.salarySplitSegOrder);
  state.salarySplitSegOrder = order;
  const sw = { fee: "viz-salary-split__swatch--fee", exp: "viz-salary-split__swatch--exp", sav: "viz-salary-split__swatch--sav" };
  host.innerHTML = order
    .map((key) => {
      const lab = SALARY_SPLIT_LEGEND_LABELS[key];
      return `<span class="viz-salary-split__legendItem" role="listitem" draggable="true" data-seg-key="${key}" title="拖动排序（改变条内从左到右顺序）"><span class="viz-salary-split__swatch ${sw[key]}"></span>${escapeHtml(lab)}</span>`;
    })
    .join("");
}

function initSalarySplitLegendInteractions() {
  const host = document.getElementById("salarySplitLegendHost");
  if (!host || host.dataset.salarySplitLegendBound === "1") return;
  host.dataset.salarySplitLegendBound = "1";
  host.addEventListener("dragstart", (e) => {
    const item = /** @type {HTMLElement|null} */ (e.target && e.target.closest && e.target.closest("[data-seg-key]"));
    if (!item || !host.contains(item)) return;
    item.classList.add("is-dragging");
    e.dataTransfer?.setData("text/plain", item.getAttribute("data-seg-key") || "");
  });
  host.addEventListener("dragend", () => {
    host.querySelectorAll(".is-dragging").forEach((el) => el.classList.remove("is-dragging"));
    host.querySelectorAll(".is-drag-over").forEach((el) => el.classList.remove("is-drag-over"));
  });
  host.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  host.addEventListener("dragenter", (e) => {
    const item = /** @type {HTMLElement|null} */ (e.target && e.target.closest && e.target.closest("[data-seg-key]"));
    if (item && host.contains(item)) item.classList.add("is-drag-over");
  });
  host.addEventListener("dragleave", (e) => {
    const item = /** @type {HTMLElement|null} */ (e.target && e.target.closest && e.target.closest("[data-seg-key]"));
    if (item && host.contains(item)) item.classList.remove("is-drag-over");
  });
  host.addEventListener("drop", (e) => {
    e.preventDefault();
    host.querySelectorAll(".is-drag-over").forEach((el) => el.classList.remove("is-drag-over"));
    const fromKey = e.dataTransfer?.getData("text/plain") || "";
    const toItem = /** @type {HTMLElement|null} */ (e.target && e.target.closest && e.target.closest("[data-seg-key]"));
    if (!fromKey || !toItem || !host.contains(toItem)) return;
    const toKey = toItem.getAttribute("data-seg-key") || "";
    if (!toKey || fromKey === toKey) return;
    const order = normalizeSalarySplitSegOrder(state.salarySplitSegOrder);
    const fromIdx = order.indexOf(fromKey);
    const toIdx = order.indexOf(toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    state.salarySplitSegOrder = arrayMove(order, fromIdx, toIdx);
    saveState();
    renderAll();
  });
}

function initScrollToChartBtn() {
  const btn = document.getElementById("scrollToChartBtn");
  const sec = document.getElementById("salarySplitVizSection");
  if (!btn || !sec || btn.dataset.scrollToChartBound === "1") return;
  btn.dataset.scrollToChartBound = "1";
  btn.addEventListener("click", () => {
    sec.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      btn.blur();
    } catch {
      // ignore
    }
  });
}

/** 收入结构图：共享横轴比例尺（0～Gmax），毛收入 = 扣缴 + 必要开支 + 可支配（比较货币、按月） */
function renderSalarySplitViz() {
  const host = document.getElementById("salarySplitVizHost");
  const unitEl = document.getElementById("salarySplitVizUnit");
  const axisCode = document.getElementById("salarySplitAxisCode");
  if (!host) return;
  const compare = getCompareCurrencyCode();
  if (unitEl) unitEl.textContent = `（${compare} / 月 · 比较货币）`;
  if (axisCode) axisCode.textContent = compare;

  if (state.fxLoading) {
    host.innerHTML = `<div class="viz-salary-split__loading" role="status">正在获取汇率…</div>`;
    renderSalarySplitAxisStrip(0, false);
    host.__vizRowByJobId = new Map();
    return;
  }

  const jobs = state.jobs || [];
  if (jobs.length === 0) {
    host.innerHTML = `<div class="viz-salary-split__empty">暂无工作列</div>`;
    renderSalarySplitAxisStrip(0, false);
    host.__vizRowByJobId = new Map();
    return;
  }

  const rows = jobs.map((job, idx) => {
    const raw = calc(job);
    const rate = effectiveFxRate(job);
    const m = applyIncomeToCompareMoney(raw, rate);
    const gross = m.grossIncomeMonthly;
    const fee = m.feeMonthly;
    const exp = m.totalExpenseMonthly;
    const sav = m.savingsMonthly;
    const badFx = !!m._fxInvalid;
    const badNums =
      !Number.isFinite(gross) ||
      !Number.isFinite(fee) ||
      !Number.isFinite(exp) ||
      !Number.isFinite(sav) ||
      gross <= 0;
    const invalid = badFx || badNums;
    const expenseParts = !invalid ? salarySplitVizExpenseMonthlyParts(m, job) : null;
    return { job, idx, name: jobDisplayName(job, idx), gross, fee, exp, sav, invalid, badFx, m, expenseParts };
  });

  rows.sort((a, b) => {
    if (a.invalid && !b.invalid) return 1;
    if (!a.invalid && b.invalid) return -1;
    return (b.gross || 0) - (a.gross || 0);
  });

  const validGrosses = rows.filter((r) => !r.invalid).map((r) => r.gross);
  const gMax = validGrosses.length ? Math.max(...validGrosses) : 0;
  renderSalarySplitAxisStrip(gMax, validGrosses.length > 0);

  const segOrder = normalizeSalarySplitSegOrder(state.salarySplitSegOrder);

  const pctOfGross = (part, g) =>
    Number.isFinite(part) && Number.isFinite(g) && g > 0 ? `${((part / g) * 100).toFixed(part / g < 0.08 ? 1 : 0)}%` : "";

  const byJob = new Map();
  for (const row of rows) {
    if (!row.invalid) byJob.set(row.job.id, row);
  }
  host.__vizRowByJobId = byJob;

  host.innerHTML = rows
    .map((row) => {
      if (row.invalid) {
        const reason = row.badFx ? "汇率不可用" : "暂无有效毛收入";
        return `<div class="viz-salary-split__row">
        <div class="viz-salary-split__name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div>
        <div class="viz-salary-split__plotCell">
          <div class="viz-salary-split__barSlot viz-salary-split__barSlot--invalid">
            <div class="viz-salary-split__svgBarWrap">
              <svg class="viz-salary-split__svg" viewBox="0 0 ${SALARY_SPLIT_VB_W} ${SALARY_SPLIT_VB_H}" preserveAspectRatio="none" aria-hidden="true">
                <rect class="viz-salary-split__svgSeg viz-salary-split__svgSeg--muted" x="0" y="0" width="${SALARY_SPLIT_VB_W}" height="${SALARY_SPLIT_VB_H}" rx="4" ry="4"/>
              </svg>
              <span class="viz-salary-split__placeholderMark">—</span>
            </div>
          </div>
        </div>
        <div class="viz-salary-split__meta">${escapeHtml(reason)}</div>
      </div>`;
      }
      const { gross, fee, exp, sav, name, job } = row;
      const retPct = (sav / gross) * 100;
      const retCls = sav < 0 ? "neg" : "";

      const trackSvg = buildSalarySplitSvgTrack(segOrder, { fee, exp, sav, gross, name, job }, gMax, compare);

      const metaLine = `毛收入 ${fmtMoneyWithCompareUnit(gross)} · 有效留存 ${retPct.toFixed(1)}%`;
      return `<div class="viz-salary-split__row">
      <div class="viz-salary-split__name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="viz-salary-split__plotCell">
        <div class="viz-salary-split__barSlot">
          <div class="viz-salary-split__svgBarWrap">
            ${trackSvg}
          </div>
        </div>
      </div>
      <div class="viz-salary-split__meta">${escapeHtml(metaLine)}<br/>可支配 <strong class="${retCls}">${fmtMoneyWithCompareUnit(sav)}</strong></div>
    </div>`;
    })
    .join("");
}

function renderAll() {
  renderCompareTablePreserveFocus();

  const addBtn = document.getElementById("addJobBtn");
  if (addBtn) {
    addBtn.disabled = state.jobs.length >= MAX_COMPARE_JOBS;
    addBtn.textContent = state.jobs.length >= MAX_COMPARE_JOBS ? `已达上限（${MAX_COMPARE_JOBS}）` : "添加工作";
    if (state.jobs.length < MAX_COMPARE_JOBS) {
      addBtn.innerHTML = '<span class="btn__icon">＋</span>添加工作';
    }
  }
  syncToolbarFromState();
  syncThemeToggleButton();
  updateDemoChrome();
  updateWelcomeHint();
  renderSalarySplitLegend();
  renderSalarySplitViz();
}

function fillMajorCurrencySelect(el) {
  if (!el) return;
  el.innerHTML = MAJOR_CURRENCIES.map((o) => `<option value="${escapeHtml(o.code)}">${escapeHtml(o.label)}</option>`).join("");
}

function syncThemeToggleButton() {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  const isDark = normalizeTheme(state.theme) === THEMES.dark;
  btn.textContent = isDark ? "☀" : "🌙";
  btn.setAttribute("aria-label", isDark ? "切换为明亮模式" : "切换为深夜模式");
  btn.title = isDark ? "切换为明亮模式" : "切换为深夜模式";
}

function syncToolbarFromState() {
  const ccSel = document.getElementById("compareCurrencySelect");
  if (ccSel) {
    const code = getCompareCurrencyCode();
    ccSel.value = code;
    if (ccSel.value !== code && MAJOR_CURRENCIES[0]) ccSel.value = MAJOR_CURRENCIES[0].code;
  }
  const ivSel = document.getElementById("inputViewModeSelect");
  if (ivSel) {
    ivSel.value = state.inputViewMode === INPUT_VIEW_MODES.results ? INPUT_VIEW_MODES.results : INPUT_VIEW_MODES.full;
  }
  syncThemeToggleButton();
  document.querySelectorAll(".segmented__btn").forEach((btn) => {
    const period = btn.getAttribute("data-period");
    const savingsMode = btn.getAttribute("data-savings-mode");
    const incomeMode = btn.getAttribute("data-income-mode");
    if (period) btn.classList.toggle("is-active", period === state.period);
    if (savingsMode) btn.classList.toggle("is-active", savingsMode === state.savingsDisplayMode);
    if (incomeMode) btn.classList.toggle("is-active", incomeMode === state.incomeDisplayMode);
  });
}

function getJobById(jobId) {
  return state.jobs.find((j) => j.id === jobId);
}

/**
 * @param {string} jobId
 * @param {string} [field] 若传入且当前仍聚焦同一 input，则跳过整表重绘（与 scheduleCompareTableRefreshAfterInput / compositionend 配合）
 */
function updateOne(jobId, field) {
  const job = getJobById(jobId);
  if (!job) return;
  if (field !== undefined && shouldSkipCompareTableRefreshForActiveInput(jobId, field)) {
    renderSalarySplitViz();
    return;
  }
  renderCompareTablePreserveFocus();
  renderSalarySplitViz();
}

/** 填写项 input 连打时合并重绘，避免每键替换 input DOM */
function scheduleCompareTableRefreshAfterInput(jobId, field) {
  compareTableRefreshDebouncePending = { jobId, field };
  if (compareTableRefreshDebounceTimer) clearTimeout(compareTableRefreshDebounceTimer);
  compareTableRefreshDebounceTimer = setTimeout(() => {
    compareTableRefreshDebounceTimer = null;
    const pending = compareTableRefreshDebouncePending;
    compareTableRefreshDebouncePending = null;
    if (!pending) return;
    updateOne(pending.jobId, pending.field);
  }, 48);
}

function flushCompareTableRefreshDebounce() {
  if (compareTableRefreshDebounceTimer) {
    clearTimeout(compareTableRefreshDebounceTimer);
    compareTableRefreshDebounceTimer = null;
  }
  compareTableRefreshDebouncePending = null;
}

/**
 * 数值 compare-input：编辑态写入 pending + 宽松数值进 model；非数值走 parseFieldValue
 * @param {any} job
 * @param {string} field
 * @param {string} raw
 * @param {boolean} isNumericInput
 */
function applyCompareInputValueToJob(job, field, raw, isNumericInput) {
  if (isNumericInput) {
    compareInputDisplayPending.set(comparePendingInputKey(job.id, field), raw);
    if (field === "__extraIncomeMonthly") {
      const row = ensureSingleCustom(job, "extraIncomes", "合计");
      row.amount = asNumberLooseForCompare(raw);
      return;
    }
    if (field === "__extraExpenseMonthly") {
      const row = ensureSingleCustom(job, "extraExpenses", "合计");
      row.amount = asNumberLooseForCompare(raw);
      return;
    }
    const loose = asNumberLooseForCompare(raw);
    if (field === "restHoursOnDuty") {
      job.restHoursOnDuty = clamp(loose, 0, 24);
    } else if (field === "workHoursPerDay") {
      job.workHoursPerDay = Math.max(0, loose);
    } else {
      job[field] = loose;
    }
    if (field === "workHoursPerDay" || field === "restHoursOnDuty") {
      const wh = Math.max(0, asNumber(job.workHoursPerDay));
      job.workHoursPerDay = wh;
      job.restHoursOnDuty = clamp(asNumber(job.restHoursOnDuty), 0, wh);
    }
    return;
  }
  job[field] = parseFieldValue(field, raw);
  if (field === "workHoursPerDay" || field === "restHoursOnDuty") {
    const wh = Math.max(0, asNumber(job.workHoursPerDay));
    job.workHoursPerDay = wh;
    job.restHoursOnDuty = clamp(asNumber(job.restHoursOnDuty), 0, wh);
  }
}

/**
 * 失焦时把数值格最终写入 model 并清除 pending
 * @param {HTMLInputElement} el
 */
function finalizeCompareNumberInputFromElement(el) {
  if (el.getAttribute("data-input-type") !== "number") return;
  const jobId = el.getAttribute("data-job-id");
  const field = el.getAttribute("data-field");
  if (!jobId || !field) return;
  const job = getJobById(jobId);
  if (!job) return;
  compareInputDisplayPending.delete(comparePendingInputKey(jobId, field));
  if (field === "__extraIncomeMonthly") {
    const row = ensureSingleCustom(job, "extraIncomes", "合计");
    row.amount = asNumber(el.value);
    return;
  }
  if (field === "__extraExpenseMonthly") {
    const row = ensureSingleCustom(job, "extraExpenses", "合计");
    row.amount = asNumber(el.value);
    return;
  }
  job[field] = parseFieldValue(field, el.value);
  if (field === "workHoursPerDay" || field === "restHoursOnDuty") {
    const wh = Math.max(0, asNumber(job.workHoursPerDay));
    job.workHoursPerDay = wh;
    job.restHoursOnDuty = clamp(asNumber(job.restHoursOnDuty), 0, wh);
  }
}

function parseFieldValue(field, raw) {
  // enums
  if (field === "workdayMode") return raw;
  if (field === "hasSocialInsurance") return raw;
  if (field === "hasHousingFund") return raw;
  if (field === "name") return raw;
  if (field === "region") return normalizePrimaryRegion(raw);
  if (field === "incomeCurrency") return MAJOR_CURRENCY_CODES.has(String(raw)) ? String(raw) : "CNY";
  if (field === "taxModel")
    return raw === "us" ? "us" : raw === "hk" ? "hk" : raw === "none" ? "none" : raw === "pending" ? "pending" : "cn";
  if (field === "subRegion") {
    const s = String(raw ?? "").trim();
    if (/^[A-Za-z]{2}$/.test(s)) {
      const u = s.toUpperCase();
      if (u === "MA" || u === "CA" || u === "TX" || u === "NY" || u === "NJ" || u === "WA") return u;
    }
    return s;
  }
  if (field === "cnProvinceAdcode") {
    const s = String(raw ?? "").replace(/\D/g, "");
    return s.length === 6 ? s : "";
  }
  if (field === "cnCityAdcode") {
    const s = String(raw ?? "").replace(/\D/g, "");
    return s.length === 6 ? s : "";
  }
  if (field === "hkMaritalStatus") return raw === "married" ? "married" : "single";
  if (field === "hkAllowanceMode") return raw === "married" ? "married" : "basic";
  if (field === "restHoursOnDuty") return clamp(asNumber(raw), 0, 24);
  // numbers
  return asNumber(raw);
}

function addCustomRow(job, key) {
  const arr = Array.isArray(job[key]) ? job[key] : [];
  arr.push({ name: "", amount: 0 });
  job[key] = arr;
}

function removeCustomRow(job, key, idx) {
  const arr = Array.isArray(job[key]) ? job[key] : [];
  arr.splice(idx, 1);
  job[key] = arr;
}

function initTopbar() {
  fillMajorCurrencySelect(document.getElementById("compareCurrencySelect"));

  const ccSel = document.getElementById("compareCurrencySelect");
  if (ccSel) {
    ccSel.addEventListener("change", () => {
      const v = ccSel.value;
      if (!MAJOR_CURRENCY_CODES.has(v)) return;
      state.compareCurrency = v;
      for (const j of state.jobs) {
        j.compareCurrency = v;
      }
      saveState();
      void refreshFxRates().then(() => renderAll());
    });
  }

  const ivSel = document.getElementById("inputViewModeSelect");
  if (ivSel) {
    ivSel.addEventListener("change", () => {
      state.inputViewMode = ivSel.value === INPUT_VIEW_MODES.results ? INPUT_VIEW_MODES.results : INPUT_VIEW_MODES.full;
      saveState();
      renderCompareTablePreserveFocus();
    });
  }

  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      state.theme = normalizeTheme(state.theme) === THEMES.dark ? THEMES.light : THEMES.dark;
      applyThemeToDom(state.theme);
      saveState();
      syncThemeToggleButton();
    });
  }

  document.querySelectorAll(".segmented__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const period = btn.getAttribute("data-period");
      const savingsMode = btn.getAttribute("data-savings-mode");
      const incomeMode = btn.getAttribute("data-income-mode");
      
      if (period) {
        state.period = period === PERIODS.day || period === PERIODS.year ? period : PERIODS.month;
        document.querySelectorAll("[data-period]").forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-period") === state.period));
      }
      
      if (savingsMode) {
        state.savingsDisplayMode = savingsMode === "minute" || savingsMode === "hour" ? savingsMode : "follow";
        document.querySelectorAll("[data-savings-mode]").forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-savings-mode") === state.savingsDisplayMode));
      }
      
      if (incomeMode) {
        state.incomeDisplayMode = incomeMode === "minute" || incomeMode === "hour" ? incomeMode : "follow";
        document.querySelectorAll("[data-income-mode]").forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-income-mode") === state.incomeDisplayMode));
      }
      
      saveState();
      renderCompareTablePreserveFocus();
    });
  });

  // init selected
  document.querySelectorAll(".segmented__btn").forEach((btn) => {
    const period = btn.getAttribute("data-period");
    const savingsMode = btn.getAttribute("data-savings-mode");
    const incomeMode = btn.getAttribute("data-income-mode");
    
    if (period) {
      btn.classList.toggle("is-active", period === state.period);
    }
    if (savingsMode) {
      btn.classList.toggle("is-active", savingsMode === state.savingsDisplayMode);
    }
    if (incomeMode) {
      btn.classList.toggle("is-active", incomeMode === state.incomeDisplayMode);
    }
  });

  const addBtn = document.getElementById("addJobBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (state.jobs.length >= MAX_COMPARE_JOBS) return;
      const j = defaultJob();
      j.compareCurrency = state.compareCurrency;
      state.jobs.push(j);
      saveState();
      void refreshFxRates().then(() => renderAll());
    });
  }

  const enterDemoBtn = document.getElementById("enterDemoBtn");
  if (enterDemoBtn) {
    enterDemoBtn.addEventListener("click", () => void enterDemoMode());
  }
  const exitDemoBtn = document.getElementById("exitDemoBtn");
  if (exitDemoBtn) {
    exitDemoBtn.addEventListener("click", () => exitDemoMode());
  }

  const welcomeHintDismissBtn = document.getElementById("welcomeHintDismissBtn");
  if (welcomeHintDismissBtn) {
    welcomeHintDismissBtn.addEventListener("click", () => {
      persistDismissWelcomeHint();
      updateWelcomeHint();
    });
  }

  syncToolbarFromState();
  syncThemeToggleButton();
  updateDemoChrome();
  updateWelcomeHint();
}

function initDialog() {
  const dlg = document.getElementById("taxDialog");
  document.querySelectorAll("[data-close-dialog]").forEach((btn) => {
    btn.addEventListener("click", () => safeDialogClose(dlg));
  });
  dlg.addEventListener("click", (e) => {
    const rect = dlg.getBoundingClientRect();
    const inDialog =
      rect.top <= e.clientY && e.clientY <= rect.bottom && rect.left <= e.clientX && e.clientX <= rect.right;
    if (!inDialog) safeDialogClose(dlg);
  });
}

function initCompareEvents() {
  const host = document.getElementById("compareTable");
  if (!host) return;

  host.addEventListener("compositionstart", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("compare-input")) return;
    isComposing = true;
  });

  host.addEventListener("compositionend", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("compare-input")) return;
    isComposing = false;
    const jobId = pendingCompareUpdateJobId || target.getAttribute("data-job-id");
    const field = target.getAttribute("data-field");
    pendingCompareUpdateJobId = null;
    if (jobId && field) updateOne(jobId, field);
  });

  // 点击/Tab 进入输入格时，默认全选已有内容（更像 Excel，避免“0”上输入变成“10”）
  host.addEventListener("focusin", (e) => {
    if (isRestoringCompareInputFocus) return;
    // 仅对“真实用户触发”的 focus 生效，避免重渲染后 restore focus 导致反复全选
    if (!e.isTrusted) return;
    const target = /** @type {HTMLElement} */ (e.target);
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("compare-input")) return;
    // 数值格（text+inputmode）连打依赖不重绘，不做延迟全选以免与重绘/选区冲突
    if (target.getAttribute("data-input-type") === "number") return;
    if (target.getAttribute("data-field") === "region") return;
    // 同一次聚焦只全选一次；失焦后再允许下一次全选
    if (target.dataset.selectedOnFocus === "1") return;
    target.dataset.selectedOnFocus = "1";
    if (compareInputFocusSelectTimer) {
      clearTimeout(compareInputFocusSelectTimer);
      compareInputFocusSelectTimer = null;
    }
    // 防止在 focusin 阶段立刻 select 被浏览器/鼠标覆盖，延迟到下一帧；重绘前须取消，否则会作用在已卸载节点或打断连输
    compareInputFocusSelectTimer = setTimeout(() => {
      compareInputFocusSelectTimer = null;
      if (!target.isConnected) return;
      try {
        target.select();
      } catch {
        // ignore
      }
    }, 0);
  });

  host.addEventListener("focusout", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("compare-input")) return;
    delete target.dataset.selectedOnFocus;
    finalizeCompareNumberInputFromElement(target);
    saveState();
    flushCompareTableRefreshDebounce();
    renderCompareTablePreserveFocus();
  });

  host.addEventListener("input", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!(target instanceof HTMLInputElement)) return;
    const jobId = target.getAttribute("data-job-id");
    const field = target.getAttribute("data-field");
    if (!jobId || !field) return;
    const job = getJobById(jobId);
    if (!job) return;

    if (field === "__extraIncomeMonthly") {
      applyCompareInputValueToJob(job, field, target.value, true);
      saveState();
      if (isComposing) {
        pendingCompareUpdateJobId = jobId;
        return;
      }
      scheduleCompareTableRefreshAfterInput(jobId, field);
      return;
    }
    if (field === "__extraExpenseMonthly") {
      applyCompareInputValueToJob(job, field, target.value, true);
      saveState();
      if (isComposing) {
        pendingCompareUpdateJobId = jobId;
        return;
      }
      scheduleCompareTableRefreshAfterInput(jobId, field);
      return;
    }

    const isNumeric = target.getAttribute("data-input-type") === "number";
    applyCompareInputValueToJob(job, field, target.value, isNumeric);
    saveState();
    if (isComposing) {
      pendingCompareUpdateJobId = jobId;
      return;
    }
    scheduleCompareTableRefreshAfterInput(jobId, field);
  });

  host.addEventListener("change", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.id === "efficiencyTimeUnitSelect" && target instanceof HTMLSelectElement) {
      state.efficiencyTimeUnit = normalizeEfficiencyTimeUnit(target.value);
      saveState();
      renderCompareTablePreserveFocus();
      return;
    }
    if (target.id === "efficiencyIncludeCommute" && target instanceof HTMLInputElement) {
      state.efficiencyIncludeCommute = target.checked;
      saveState();
      renderCompareTablePreserveFocus();
      return;
    }
    if (target.id === "efficiencyIncludeOvertime" && target instanceof HTMLInputElement) {
      state.efficiencyIncludeOvertime = target.checked;
      saveState();
      renderCompareTablePreserveFocus();
      return;
    }
    if (target.id === "taxFeeShortcutChk" && target instanceof HTMLInputElement) {
      state.taxFeeShortcut = target.checked;
      saveState();
      renderCompareTablePreserveFocus();
      return;
    }
    if (!target.classList.contains("compare-input")) return;
    const jobId = target.getAttribute("data-job-id");
    const field = target.getAttribute("data-field");
    if (!jobId || !field) return;
    const job = getJobById(jobId);
    if (!job) return;

    if (target instanceof HTMLInputElement) {
      const prevRegion = field === "region" ? String(job.region ?? "") : "";
      job[field] = parseFieldValue(field, target.value);
      if (field === "region") applyEconomyDefaultsFromRegion(job, prevRegion);
      saveState();
      if (field === "incomeCurrency") {
        void refreshFxRates().then(() => renderCompareTablePreserveFocus());
        return;
      }
      renderCompareTablePreserveFocus();
      return;
    }

    if (!(target instanceof HTMLSelectElement)) return;
    const prevRegion = field === "region" ? String(job.region ?? "") : "";
    job[field] = parseFieldValue(field, target.value);
    if (field === "cnProvinceAdcode") {
      job.cnCityAdcode = "";
    }
    if (field === "region") applyEconomyDefaultsFromRegion(job, prevRegion);
    saveState();
    if (field === "incomeCurrency" || field === "region") {
      void refreshFxRates().then(() => renderCompareTablePreserveFocus());
      return;
    }
    if (
      field === "taxModel" ||
      field === "subRegion" ||
      field === "hkMaritalStatus" ||
      field === "hkAllowanceMode" ||
      field === "cnProvinceAdcode" ||
      field === "cnCityAdcode"
    ) {
      renderCompareTablePreserveFocus();
      return;
    }
    updateOne(jobId);
  });

  host.addEventListener("click", (e) => {
    const toggleEl = e.target.closest("[data-section-toggle]");
    if (toggleEl && host.contains(toggleEl)) {
      e.preventDefault();
      const id = toggleEl.getAttribute("data-section-toggle");
      if (!id) return;
      state.uiCollapse = normalizeUiCollapse(state.uiCollapse);
      state.uiCollapse[id] = state.uiCollapse[id] === false ? true : false;
      saveState();
      renderCompareTablePreserveFocus();
      return;
    }
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const jobId = btn.getAttribute("data-job-id");
    if (!action || !jobId) return;
    const job = getJobById(jobId);
    if (!job) return;

    if (action === "delete") {
      state.jobs = state.jobs.filter((j) => j.id !== jobId);
      if (state.jobs.length === 0) {
        const j = defaultJob();
        j.compareCurrency = state.compareCurrency;
        state.jobs = [j];
      }
      saveState();
      void refreshFxRates().then(() => renderAll());
      return;
    }

    if (action === "duplicate") {
      if (state.jobs.length >= MAX_COMPARE_JOBS) return;
      const cloned = { ...structuredClone(job), id: uid(), name: (job.name || "工作") + "（复制）" };
      delete cloned.usState;
      cloned.compareCurrency = state.compareCurrency;
      syncJobFieldsForRegionTier(cloned);
      state.jobs.push(cloned);
      saveState();
      void refreshFxRates().then(() => renderAll());
      return;
    }

    if (action === "showTax") {
      const raw = calc(job);
      const c = applyIncomeToCompareMoney(raw, effectiveFxRate(job));
      renderTaxDetail(job, c);
      safeDialogShow(document.getElementById("taxDialog"));
      return;
    }
  });
}

// ---- bootstrap ----
const state = {};

async function bootstrap() {
  try {
    const initial = await resolveInitialState();
    Object.assign(state, initial);
  } catch (e) {
    console.warn("[job_salary_evaluation] 初始状态加载失败", e);
    Object.assign(state, emptyNonDemoState());
  }
  state.fxByJobId = state.fxByJobId || {};
  state.theme = normalizeTheme(state.theme);
  state.efficiencyTimeUnit = normalizeEfficiencyTimeUnit(state.efficiencyTimeUnit);
  state.efficiencyIncludeCommute = normalizeEfficiencyBool(state.efficiencyIncludeCommute, true);
  state.efficiencyIncludeOvertime = normalizeEfficiencyBool(state.efficiencyIncludeOvertime, true);
  let taxFeeShortcut = normalizeTaxFeeShortcut(state.taxFeeShortcut);
  if (typeof state.taxFeeShortcut !== "boolean" && state.showTaxFeeTotal !== undefined) {
    taxFeeShortcut = state.showTaxFeeTotal === false;
  }
  state.taxFeeShortcut = taxFeeShortcut;
  state.uiCollapse = normalizeUiCollapse(state.uiCollapse);
  state.salarySplitSegOrder = normalizeSalarySplitSegOrder(state.salarySplitSegOrder);
  applyThemeToDom(state.theme);

  const focusStage = document.getElementById("mainFocusStage");
  if (focusStage) {
    focusStage.dataset.jobCount = String(Math.min(MAX_COMPARE_JOBS, Math.max(1, (state.jobs || []).length)));
  }

  initTopbar();
  initSalarySplitVizInteractions();
  initSalarySplitLegendInteractions();
  initScrollToChartBtn();
  initDialog();
  initCompareEvents();
  void refreshFxRates().then(() => renderAll());
  void ensureCnSocialWageLoaded().catch(() => {});
  void ensureCnPcaLoaded().catch(() => {});
  renderAll();
}

void bootstrap();













