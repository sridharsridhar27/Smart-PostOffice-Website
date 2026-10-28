const express = require("express");
const {
  createDeliveryPerson,
  getDeliveryPersons,
} = require("../controllers/deliveryPersonController");
const {
  lookupCustomerByPhone,
  createParcel,
  getParcels,
  getParcelById,
} = require("../controllers/parcelController");
const { getSlotBookings } = require("../controllers/slotController");
const { protect, authorize } = require("../middleware/auth");
const {
  autoAssignParcel,
  manualAssignParcel,
  previewAssignment,
  getUnassignedParcels,
  getWorkload,
} = require("../controllers/assignmentController");
const { getDashboard } = require("../controllers/dashboardController");
const { runAutoBookNow, getAutoBookStatus } = require("../controllers/jobController");
const {
  markCollectedHandler,
  returnToSenderHandler,
  getReturns,
} = require("../controllers/returnController");

const router = express.Router();

// Every route in this file is admin-only
router.use(protect, authorize("ADMIN"));

// Delivery persons
router.post("/delivery-persons", createDeliveryPerson);
router.get("/delivery-persons", getDeliveryPersons);

// Customers
router.get("/customers/lookup", lookupCustomerByPhone);

// Parcels
router.post("/parcels", createParcel);
router.get("/parcels", getParcels);
router.get("/parcels/:id", getParcelById);

// Slot bookings
router.get("/slot-bookings", getSlotBookings);

// AI assignment
router.get("/assignments/workload", getWorkload);
router.get("/assignments/unassigned", getUnassignedParcels);
router.get("/parcels/:id/ai-preview", previewAssignment);
router.post("/parcels/:id/auto-assign", autoAssignParcel);
router.post("/parcels/:id/assign", manualAssignParcel);
// Dashboard + auto-booking job
router.get("/dashboard", getDashboard);
router.get("/jobs/auto-book/status", getAutoBookStatus);
router.post("/jobs/auto-book/run", runAutoBookNow);

// Returns
router.get("/returns", getReturns);
router.post("/parcels/:id/mark-collected", markCollectedHandler);
router.post("/parcels/:id/return-to-sender", returnToSenderHandler);

module.exports = router;