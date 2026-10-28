const express = require("express");
const { getMyDeliveries, start, complete, fail } = require("../controllers/deliveryController");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect, authorize("DELIVERY"));

router.get("/parcels", getMyDeliveries);

// Generic routes (deliveries + pickups)
router.patch("/parcels/:id/start", start);
router.patch("/parcels/:id/complete", complete);
router.patch("/parcels/:id/fail", fail);

// Old names kept so the existing frontend and step 5 tests still work
router.patch("/parcels/:id/out-for-delivery", start);
router.patch("/parcels/:id/delivered", complete);
router.patch("/parcels/:id/failed", fail);

module.exports = router;