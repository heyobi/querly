// Small DOM helpers shared by every view.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { ActionSheet, ActionSheetButtonStyle } from '@capacitor/action-sheet';
import { blobToBase64 } from './storage';
import { t } from './i18n';

export const native = Capacitor.isNativePlatform();
export { isDark as dark } from './i18n';

export type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Light taps from the Taptic Engine: tab and view switches, long-press, done and failed. No-ops on the web. */
export const haptic = {
  tap: () => { if (native) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); },
  press: () => { if (native) void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {}); },
  done: () => { if (native) void Haptics.notification({ type: NotificationType.Success }).catch(() => {}); },
  fail: () => { if (native) void Haptics.notification({ type: NotificationType.Error }).catch(() => {}); },
};

export const icon = (name: string) => h('span', { class: `i i-${name}`, 'aria-hidden': 'true' });

export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  if (kind === 'err') haptic.fail(); else haptic.done();
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 2400);
  setTimeout(() => t.remove(), 2800);
}

/** Menus: the system action sheet on iPhone (UIAlertController), the same look in the browser. */
export function sheet(title: string, actions: { label: string; danger?: boolean; run: () => void }[]) {
  if (native) {
    void ActionSheet.showActions({
      title,
      options: [
        ...actions.map((a) => ({ title: a.label, style: a.danger ? ActionSheetButtonStyle.Destructive : ActionSheetButtonStyle.Default })),
        { title: t('Cancel'), style: ActionSheetButtonStyle.Cancel },
      ],
    }).then((r) => { if (!r.canceled && r.index >= 0 && r.index < actions.length) actions[r.index].run(); })
      .catch(() => webSheet(title, actions));
    return;
  }
  webSheet(title, actions);
}

function webSheet(title: string, actions: { label: string; danger?: boolean; run: () => void }[]) {
  const close = () => back.remove();
  const back = h('div', { class: 'sheet-back', onclick: (e: Event) => e.target === back && close() },
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-group' },
        h('div', { class: 'sheet-title' }, title),
        actions.map((a) => h('button', { class: `sheet-btn${a.danger ? ' danger' : ''}`, onclick: () => { close(); a.run(); } }, a.label))),
      h('button', { class: 'sheet-btn cancel', onclick: close }, t('Cancel'))));
  document.body.append(back);
}

export function confirmBox(title: string, body: string, ok: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => { back.remove(); resolve(v); };
    const back = h('div', { class: 'sheet-back center' },
      h('div', { class: 'dialog' },
        h('div', { class: 'dialog-title' }, title),
        h('div', { class: 'dialog-body' }, body),
        h('div', { class: 'dialog-actions' },
          h('button', { onclick: () => done(false) }, t('Cancel')),
          h('button', { class: danger ? 'danger' : 'primary', onclick: () => done(true) }, ok))));
    document.body.append(back);
  });
}

export function promptBox(title: string, label: string, value = '', ok = t('OK'), fallback = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'field', type: 'text', value, 'aria-label': label, placeholder: label, autocapitalize: 'none', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done' }) as HTMLInputElement;
    const hint = h('div', { class: 'field-hint' });
    const done = (v: string | null) => { back.remove(); resolve(v); };
    // An empty name keeps the dialog open with a hint instead of silently closing it.
    const submit = () => {
      const v = input.value.trim() || fallback;
      if (!v) { hint.textContent = t('Type a name first.'); input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); input.focus(); return; }
      done(v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    input.addEventListener('input', () => { hint.textContent = ''; });
    const back = h('div', { class: 'sheet-back center' },
      h('div', { class: 'dialog' },
        h('div', { class: 'dialog-title' }, title),
        h('div', { class: 'dialog-body' }, input, hint),
        h('div', { class: 'dialog-actions' },
          h('button', { onclick: () => done(null) }, t('Cancel')),
          h('button', { class: 'primary', onclick: submit }, ok))));
    document.body.append(back);
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 50);
  });
}

/** Full-screen modal page (paywall, extension details). Returns a close function. */
export function modal(content: HTMLElement, onClose?: () => void): () => void {
  const close = () => { back.classList.add('out'); setTimeout(() => back.remove(), 200); onClose?.(); };
  const back = h('div', { class: 'modal-back' },
    h('div', { class: 'modal' },
      h('button', { class: 'modal-close', 'aria-label': 'Close', onclick: close }, icon('close')),
      content));
  document.body.append(back);
  return close;
}

export async function shareFile(name: string, data: Blob | string, mime: string) {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  if (native) {
    const w = await Filesystem.writeFile({ directory: Directory.Cache, path: name, data: await blobToBase64(blob) });
    await Share.share({ title: name, files: [w.uri] }).catch(() => {});
  } else {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

/** Native "Save to Files" (UIDocumentPickerViewController in export mode), registered in SceneDelegate.swift. */
const SaveToFiles = registerPlugin<{ save(o: { path: string }): Promise<{ saved: boolean }> }>('SaveToFiles');

/**
 * Let the user pick a folder in the Files app and save the file there. Saving into the folder the file came from
 * replaces it after iOS asks. Falls back to the share sheet (which also offers "Save to Files").
 * Resolves true when the file was saved, false when the picker was cancelled.
 */
export async function saveToFiles(name: string, data: Blob): Promise<boolean> {
  if (!native) { await shareFile(name, data, data.type || 'application/octet-stream'); return true; }
  const w = await Filesystem.writeFile({ directory: Directory.Cache, path: name, data: await blobToBase64(data) });
  try {
    return (await SaveToFiles.save({ path: w.uri })).saved;
  } catch {
    await Share.share({ title: name, files: [w.uri] }).catch(() => {});
    return true;
  }
}

export function pickFiles(multiple = true, accept = ''): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', multiple, accept: accept || undefined, style: { display: 'none' } }) as HTMLInputElement;
    input.onchange = () => { resolve([...(input.files ?? [])]); input.remove(); };
    document.body.append(input);
    input.click();
  });
}

export function fmtBytes(n: number) {
  return n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
}

export function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file' }) as HTMLInputElement;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'notebook';

export function fmtMs(ms: number) {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function fmtDate(t: number) {
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** Markdown from files people open is untrusted: drop scripts, frames, event handlers and javascript: links. */
export function safeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, style, link, meta, form, base').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|data:text|vbscript)/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}
