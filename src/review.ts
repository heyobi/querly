// Ask for an App Store rating at a good moment: after the user has run a number of queries successfully.
// iOS decides whether the prompt actually appears (at most 3 times a year), so asking is cheap.
import { InAppReview } from '@capacitor-community/in-app-review';
import { native } from './ui';

const KEY = 'qly-review';
const STEPS = [10, 60, 250];

export function querySucceeded() {
  if (!native || import.meta.env.VITE_SHOTS) return; // never during the screenshot tour
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{"n":0,"asked":0}') as { n: number; asked: number };
    s.n++;
    if (STEPS.includes(s.n) && Date.now() - s.asked > 30 * 864e5) {
      s.asked = Date.now();
      setTimeout(() => void InAppReview.requestReview().catch(() => {}), 1200);
    }
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: skip */
  }
}
