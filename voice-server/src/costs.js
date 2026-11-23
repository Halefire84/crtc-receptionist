// Estimated Claude API cost per request, for tracking spend against the promo credit.
// Prices are USD per million tokens, Anthropic first-party list prices as cached in the claude-api skill
// (2026-11-03). They are ESTIMATES: the Anthropic Console usage page is the source of truth for the bill.
export const PRICES = {
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, cacheRead: 0.10 },
  "claude-haiku-5-5": { input: 0.10, output: 0.50 },   // prompts up to 100K tokens
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 }
};

const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute cache write
const CACHE_READ_MULTIPLIER = 0.10;  // used when a model has no explicit cache-read price

export function estimateUsd(model, usage = {}) {
  const p = PRICES[model];
  if (!p) return null; // unknown model: logged with a null estimate rather than a guessed one
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const cacheWrite = Number(usage.cache_creation_input_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const readPrice = p.cacheRead ?? p.input * CACHE_READ_MULTIPLIER;
  const usd = (input * p.input + output * p.output + cacheWrite * p.input * CACHE_WRITE_MULTIPLIER +
    cacheRead * readPrice) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
