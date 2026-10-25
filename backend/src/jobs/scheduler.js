const cron = require("node-cron");
const { runAutoBookJob } = require("../services/autoBookService");

const startScheduler = () => {
  const expression = process.env.AUTO_BOOK_CRON || "*/15 * * * *";

  if (!cron.validate(expression)) {
    console.error(`[scheduler] Invalid AUTO_BOOK_CRON "${expression}" - scheduler not started`);
    return;
  }

  cron.schedule(
    expression,
    () => {
      runAutoBookJob({ trigger: "cron" }).catch((err) => console.error("[auto-book] job error:", err));
    },
    { timezone: "Asia/Kolkata" }
  );

  // Also run once shortly after startup
  setTimeout(() => {
    runAutoBookJob({ trigger: "startup" }).catch((err) => console.error("[auto-book] job error:", err));
  }, 10000);

  console.log(`[scheduler] Auto-booking job scheduled (${expression})`);
};

module.exports = { startScheduler };