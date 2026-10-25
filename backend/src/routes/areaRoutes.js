const express = require("express");
const { getAreas, createArea, createStreet } = require("../controllers/areaController");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.get("/", getAreas);
router.post("/", protect, authorize("ADMIN"), createArea);
router.post("/:areaId/streets", protect, authorize("ADMIN"), createStreet);

module.exports = router;