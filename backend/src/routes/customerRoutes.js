const express = require("express");
const { getMyParcels, getMyParcelById } = require("../controllers/customerParcelController");
const { getSlotAvailability, bookSlot, rescheduleSlot } = require("../controllers/slotController");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect, authorize("CUSTOMER"));

router.get("/parcels", getMyParcels);
router.get("/parcels/:id", getMyParcelById);
router.post("/parcels/:id/book-slot", bookSlot);
router.post("/parcels/:id/reschedule", rescheduleSlot);

router.get("/slots/availability", getSlotAvailability);

module.exports = router;