/**
 * src/lib/geoCurrency.ts
 *
 * Zero-Cost Multi-Currency Geo-Pricing Engine & Localized Shopify Permalinks.
 * - Supports USD, EUR, GBP, CAD, AUD with zero paid third-party forex API fees.
 * - Option A Charm Pricing: Rounds converted prices to clean psychological price endings (.00, .95, .99).
 * - Zero-latency geo-detection using edge country headers, browser timezones, and sticky cookie memory.
 * - Localized Shopify Cart Permalinks: Appends ?currency=CODE so checkout renders in native currency.
 */

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';

export interface CurrencyConfig {
  code: CurrencyCode;
  name: string;
  symbol: string;
  flag: string;
  rateAgainstUSD: number; // Baseline exchange rate
  formatPrefix: string;
}

export const SUPPORTED_CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  USD: {
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    flag: '🇺🇸',
    rateAgainstUSD: 1.0,
    formatPrefix: '$'
  },
  EUR: {
    code: 'EUR',
    name: 'Euro',
    symbol: '€',
    flag: '🇪🇺',
    rateAgainstUSD: 0.92,
    formatPrefix: '€'
  },
  GBP: {
    code: 'GBP',
    name: 'British Pound',
    symbol: '£',
    flag: '🇬🇧',
    rateAgainstUSD: 0.79,
    formatPrefix: '£'
  },
  CAD: {
    code: 'CAD',
    name: 'Canadian Dollar',
    symbol: 'CA$',
    flag: '🇨🇦',
    rateAgainstUSD: 1.36,
    formatPrefix: 'CA$'
  },
  AUD: {
    code: 'AUD',
    name: 'Australian Dollar',
    symbol: 'A$',
    flag: '🇦🇺',
    rateAgainstUSD: 1.52,
    formatPrefix: 'A$'
  }
};

export const EUR_ZONE_COUNTRIES = new Set([
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'IE',
  'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'
]);

/**
 * European Union (EU 27) + EEA countries (IS, LI, NO) + UK (GB) + Switzerland (CH)
 * where GDPR / UK-GDPR strict opt-in consent is required before analytics/marketing tracking.
 */
export const GDPR_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'GB', 'IS', 'LI', 'NO', 'CH'
]);

export const CCPA_COUNTRIES = new Set(['US']);

export function isConsentRequiredForCountry(
  countryCode: string | undefined | null,
  geoTarget: 'eu_uk_only' | 'all_visitors' = 'eu_uk_only'
): boolean {
  if (geoTarget === 'all_visitors') return true;
  if (!countryCode) return false;
  const upper = countryCode.trim().toUpperCase();
  return GDPR_COUNTRIES.has(upper);
}

/**
 * Parses numeric price from any formatted string like "$49.00", "€45.95", "49", etc.
 */
export function parsePriceAmount(priceStr: string | number | undefined | null): { amount: number; hasDecimals: boolean; ending: '99' | '95' | '00' | 'raw' } {
  if (typeof priceStr === 'number') {
    const hasDecimals = !Number.isInteger(priceStr);
    const cents = Math.round((priceStr % 1) * 100);
    const ending = cents === 99 ? '99' : cents === 95 ? '95' : cents === 0 ? '00' : 'raw';
    return { amount: priceStr, hasDecimals, ending };
  }
  const clean = String(priceStr || '').trim().replace(/[^0-9.-]/g, '');
  const num = parseFloat(clean);
  if (!Number.isFinite(num) || num <= 0) {
    return { amount: 0, hasDecimals: false, ending: '00' };
  }
  const rawClean = String(priceStr || '');
  const hasDecimals = rawClean.includes('.');
  let ending: '99' | '95' | '00' | 'raw' = 'raw';
  if (rawClean.endsWith('.99') || rawClean.endsWith('99')) ending = '99';
  else if (rawClean.endsWith('.95') || rawClean.endsWith('95')) ending = '95';
  else if (!hasDecimals || rawClean.endsWith('.00')) ending = '00';

  return { amount: num, hasDecimals, ending };
}

/**
 * Converts a base USD price to a target currency with Option A charm pricing rounding.
 */
export function convertCurrencyCharm(
  basePrice: string | number,
  targetCurrency: CurrencyCode = 'USD',
  baseCurrency: CurrencyCode = 'USD'
): { formatted: string; amount: number; symbol: string; currency: CurrencyCode } {
  const target = SUPPORTED_CURRENCIES[targetCurrency] || SUPPORTED_CURRENCIES.USD;
  const base = SUPPORTED_CURRENCIES[baseCurrency] || SUPPORTED_CURRENCIES.USD;
  const { amount: baseNum, hasDecimals, ending } = parsePriceAmount(basePrice);

  if (baseNum <= 0) {
    return { formatted: `${target.formatPrefix}0.00`, amount: 0, symbol: target.symbol, currency: target.code };
  }

  // Convert to USD first (if not USD), then to target currency
  const inUSD = baseCurrency === 'USD' ? baseNum : baseNum / base.rateAgainstUSD;
  const rawConverted = inUSD * target.rateAgainstUSD;

  let charmAmount = rawConverted;

  // Option A Charm Pricing Rounding Rules:
  if (ending === '99') {
    charmAmount = Math.max(1, Math.round(rawConverted - 0.99)) + 0.99;
  } else if (ending === '95') {
    charmAmount = Math.max(1, Math.round(rawConverted - 0.95)) + 0.95;
  } else {
    // Round to whole integer for clean psychological pricing (.00)
    charmAmount = Math.max(1, Math.round(rawConverted));
  }

  const formattedNumber = hasDecimals || ending !== '00'
    ? charmAmount.toFixed(2)
    : Math.round(charmAmount).toString();

  const formatted = `${target.formatPrefix}${formattedNumber}`;
  return {
    formatted,
    amount: Number(charmAmount.toFixed(2)),
    symbol: target.symbol,
    currency: target.code
  };
}

/**
 * Detects visitor currency using 100% zero-cost client/edge heuristics:
 * 1. Explicit cookie / localStorage override
 * 2. Edge CDN country header (x-country-code, cf-ipcountry)
 * 3. Browser IANA timezone (Intl.DateTimeFormat)
 */
export function detectVisitorCurrency(options: {
  cookie?: string;
  countryCode?: string;
  timezone?: string;
} = {}): CurrencyCode {
  // 1. Explicit manual preference in cookie
  const cookieMatch = options.cookie?.match(/jv_currency=(USD|EUR|GBP|CAD|AUD)/i);
  if (cookieMatch && cookieMatch[1]) {
    const code = cookieMatch[1].toUpperCase() as CurrencyCode;
    if (SUPPORTED_CURRENCIES[code]) return code;
  }

  // 2. Edge CDN country header check
  const country = String(options.countryCode || '').trim().toUpperCase();
  if (country) {
    if (country === 'US') return 'USD';
    if (country === 'GB' || country === 'UK') return 'GBP';
    if (country === 'CA') return 'CAD';
    if (country === 'AU' || country === 'NZ') return 'AUD';
    if (EUR_ZONE_COUNTRIES.has(country)) return 'EUR';
  }

  // 3. Browser timezone check (zero network overhead, instant)
  let tz = options.timezone;
  if (!tz && typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {}
  }

  if (tz) {
    const lowerTz = tz.toLowerCase();
    if (lowerTz.includes('london') || lowerTz.includes('belfast')) return 'GBP';
    if (lowerTz.startsWith('europe/')) return 'EUR';
    if (lowerTz.startsWith('australia/') || lowerTz.startsWith('pacific/auckland')) return 'AUD';
    if (
      lowerTz.includes('toronto') ||
      lowerTz.includes('vancouver') ||
      lowerTz.includes('montreal') ||
      lowerTz.includes('edmonton') ||
      lowerTz.includes('winnipeg') ||
      lowerTz.includes('halifax') ||
      lowerTz.includes('st_johns')
    ) {
      return 'CAD';
    }
  }

  return 'USD';
}

/**
 * Appends localized currency parameter to Shopify Cart Permalinks:
 * https://store.myshopify.com/cart/42109840192:1?currency=EUR&discount=SAVE10
 */
export function buildLocalizedShopifyCartUrl(
  cartUrl: string,
  currency: CurrencyCode = 'USD'
): string {
  if (!cartUrl) return '';
  const cleanCurrency = (currency || 'USD').toUpperCase();
  
  try {
    const url = new URL(cartUrl, 'https://dummy.base');
    if (cleanCurrency !== 'USD') {
      url.searchParams.set('currency', cleanCurrency);
    } else {
      url.searchParams.delete('currency');
    }
    // Return relative or absolute based on input
    if (cartUrl.startsWith('http://') || cartUrl.startsWith('https://')) {
      return url.toString();
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Simple fallback string concatenation
    if (cleanCurrency === 'USD') return cartUrl;
    const separator = cartUrl.includes('?') ? '&' : '?';
    return `${cartUrl}${separator}currency=${cleanCurrency}`;
  }
}
