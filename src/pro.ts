// Querly Pro: one-time in-app purchase. What is free and what is Pro: see features.ts.
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import { h, icon, modal, native, toast } from './ui';
import { FREE_FILE_MB } from './features';
import { t } from './i18n';

export const PRODUCT_ID = 'com.heyobi.querly.pro';
const KEY = 'qly-pro';

let pro = false;
let price = '';
const listeners = new Set<(v: boolean) => void>();

try { pro = localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }

export const isPro = () => pro;
export const onPro = (fn: (v: boolean) => void) => (listeners.add(fn), () => listeners.delete(fn));

export function setPro(v: boolean) {
  if (v === pro) return;
  pro = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  // Listeners re-render pages, and each new page subscribes again. Iterate over a copy: a Set visits items added
  // during forEach, which turned one Pro change into an endless render loop that froze the app.
  for (const l of [...listeners]) l(v);
}

export async function initPro() {
  if (!native) return; // desktop browser (development): everything unlocked via ?pro in the URL
  await refreshPrice();
  try {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
    if (purchases.some((p) => p.productIdentifier === PRODUCT_ID)) setPro(true);
  } catch { /* keep cached value */ }
}
if (!native && new URLSearchParams(location.search).has('pro')) setPro(true);

/**
 * Localised price from StoreKit. Read fresh each time the paywall opens: StoreKit can report the US price before the
 * storefront is known (seen in TestFlight with a Turkish account: button said $4.99, the Apple sheet ₺249,99).
 * If the storefront is not the US but the price is still in USD, show no price rather than a wrong one —
 * Apple's purchase sheet always shows the real amount.
 */
async function refreshPrice() {
  try {
    const { products } = await NativePurchases.getProducts({ productIdentifiers: [PRODUCT_ID], productType: PURCHASE_TYPE.INAPP });
    const p = products[0];
    let country = '';
    try { country = (await NativePurchases.getStorefront()).countryCode; } catch { /* older iOS */ }
    const mismatch = !!p && p.currencyCode === 'USD' && !!country && !['USA', 'US'].includes(country);
    price = p && !mismatch ? p.priceString : '';
  } catch { /* offline / not configured */ }
}

async function buy(): Promise<boolean> {
  if (!native) { setPro(true); return true; }
  try {
    await NativePurchases.purchaseProduct({ productIdentifier: PRODUCT_ID, productType: PURCHASE_TYPE.INAPP, quantity: 1 } as never);
    setPro(true);
    return true;
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    if (!/cancel/i.test(msg)) toast(msg || 'Purchase failed', 'err');
    return false;
  }
}

async function restore(): Promise<boolean> {
  if (!native) return false;
  try {
    await NativePurchases.restorePurchases();
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
    const ok = purchases.some((p) => p.productIdentifier === PRODUCT_ID);
    if (ok) setPro(true);
    toast(ok ? 'Pro restored' : 'No previous purchase found', ok ? 'ok' : 'err');
    return ok;
  } catch (e) {
    toast((e as Error)?.message || 'Restore failed', 'err');
    return false;
  }
}

/** Resolves true when Pro is (now) active. Shows the paywall otherwise. */
export function requirePro(reason?: string): Promise<boolean> {
  if (pro) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    const buyBtn = h('button', { class: 'btn primary big', onclick: async () => {
      buyBtn.setAttribute('disabled', '');
      if (await buy()) { close(); finish(true); toast(t('Pro unlocked — thank you!')); }
      buyBtn.removeAttribute('disabled');
    } }, price ? `${t('Unlock Pro')} · ${price}` : t('Unlock Pro'));
    if (native) void refreshPrice().then(() => { if (!buyBtn.hasAttribute('disabled')) buyBtn.textContent = price ? `${t('Unlock Pro')} · ${price}` : t('Unlock Pro'); });
    const features: [string, string][] = [
      ['Parquet', t('Query and export Parquet files')],
      ['Excel', t('Query and export .xlsx sheets')],
      [t('Charts'), t('Bar, line and scatter charts')],
      [t('Maps'), t('Spatial SQL with a map view')],
      ['SQLite', t('SQL on .sqlite and .db files')],
      [t('Big files'), `${t('Files over')} ${FREE_FILE_MB} MB`],
    ];
    const content = h('div', { class: 'paywall' },
      h('div', { class: 'pw-badge' }, 'PRO'),
      h('h1', {}, t('All your data, unlocked')),
      reason && h('p', { class: 'muted center' }, reason),
      h('div', { class: 'pw-grid' }, features.map(([a, b]) => h('div', { class: 'pw-item' }, h('b', {}, a), h('span', {}, b)))),
      h('ul', { class: 'pw-list' },
        h('li', {}, icon('check'), t('Export results as Parquet, Excel or JSON')),
        h('li', {}, icon('check'), t('More databases, backups and restores')),
        h('li', {}, icon('check'), t('One-time purchase. No subscription, no account.'))),
    buyBtn,
      h('button', { class: 'link', onclick: async () => { if (await restore()) { close(); finish(true); } } }, t('Restore purchase')),
      h('p', { class: 'muted small center' }, t('Viewing any file, editing CSV files, SQL notebooks and the lessons stay free forever.')));
    const close = modal(content, () => finish(pro));
  });
}
