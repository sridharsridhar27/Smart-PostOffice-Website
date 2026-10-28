const express = require("express");
const { getMyParcels, getMyParcelById } = require("../controllers/customerParcelController");
const { getSlotAvailability, bookSlot, rescheduleSlot } = require("../controllers/slotController");
const {
  requestReturnHandler,
  rebookPickupHandler,
  cancelReturnHandler,
} = require("../controllers/returnController");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect, authorize("CUSTOMER"));

router.get("/parcels", getMyParcels);
router.get("/parcels/:id", getMyParcelById);
router.post("/parcels/:id/book-slot", bookSlot);
router.post("/parcels/:id/reschedule", rescheduleSlot);

// Returns
router.post("/parcels/:id/return", requestReturnHandler);
router.post("/parcels/:id/pickup-slot", rebookPickupHandler);
router.post("/parcels/:id/cancel-return", cancelReturnHandler);

router.get("/slots/availability", getSlotAvailability);

module.exports = router;