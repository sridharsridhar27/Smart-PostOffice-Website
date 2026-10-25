const express = require("express");
const {
  getMyDeliveries,
  outForDelivery,
  delivered,
  failed,
} = require("../controllers/deliveryController");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect, authorize("DELIVERY"));

router.get("/parcels", getMyDeliveries);
router.patch("/parcels/:id/out-for-delivery", outForDelivery);
router.patch("/parcels/:id/delivered", delivered);
router.patch("/parcels/:id/failed", failed);

module.exports = router;