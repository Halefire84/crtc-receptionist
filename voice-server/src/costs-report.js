// `npm run costs`: Claude spend recorded by this service (estimates; the Anthropic Console is the real bill).
import { openStore } from "./store.js";

const store = openStore();
try {
  const budget = Number(process.env.CLAUDE_MONTHLY_BUDGET_USD || 20);
  console.log(`This month (estimated): $${store.monthSpend().toFixed(4)} of a $${budget} receptionist budget`);
  console.table(store.usageTotals());
} finally {
  store.close();
}
