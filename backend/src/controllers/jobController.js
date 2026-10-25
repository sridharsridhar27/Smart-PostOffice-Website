const { runAutoBookJob, getJobStatus } = require("../services/autoBookService");

// POST /api/admin/jobs/auto-book/run
const runAutoBookNow = async (req, res, next) => {
  try {
    const result = await runAutoBookJob({ trigger: `manual (${req.user.name})` });
    if (result.skipped) return res.status(409).json({ message: result.reason });
    res.json({ message: `Auto-booking finished: ${result.booked} parcel(s) booked`, result });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/jobs/auto-book/status
const getAutoBookStatus = async (req, res, next) => {
  try {
    res.json(await getJobStatus());
  } catch (err) {
    next(err);
  }
};

module.exports = { runAutoBookNow, getAutoBookStatus };