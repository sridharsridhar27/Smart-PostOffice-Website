const prisma = require("../config/prisma");

const pincodeRegex = /^[1-9][0-9]{5}$/; // 6 digits, not starting with 0

// GET /api/areas  (public - registration dropdowns; pincode included)
const getAreas = async (req, res, next) => {
  try {
    const areas = await prisma.area.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        pincode: true,
        streets: {
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        },
      },
    });

    res.json({ areas });
  } catch (err) {
    next(err);
  }
};

// POST /api/areas  (admin)   body: { name, pincode }
const createArea = async (req, res, next) => {
  try {
    const name = req.body.name?.trim();
    const pincode = String(req.body.pincode || "").trim();

    if (!name) return res.status(400).json({ message: "Area name is required" });
    if (!pincode) return res.status(400).json({ message: "Pincode is required" });
    if (!pincodeRegex.test(pincode)) {
      return res.status(400).json({ message: "Pincode must be 6 digits and cannot start with 0" });
    }

    const sameName = await prisma.area.findUnique({ where: { name } });
    if (sameName) return res.status(409).json({ message: "Area already exists" });

    const samePin = await prisma.area.findUnique({ where: { pincode } });
    if (samePin) {
      return res.status(409).json({ message: `Pincode ${pincode} is already used by ${samePin.name}` });
    }

    const area = await prisma.area.create({ data: { name, pincode } });

    res.status(201).json({ message: "Area created", area });
  } catch (err) {
    next(err);
  }
};

// POST /api/areas/:areaId/streets  (admin)
const createStreet = async (req, res, next) => {
  try {
    const areaId = Number(req.params.areaId);
    const name = req.body.name?.trim();

    if (!name) return res.status(400).json({ message: "Street name is required" });

    const area = await prisma.area.findUnique({ where: { id: areaId } });
    if (!area) return res.status(404).json({ message: "Area not found" });

    const existing = await prisma.street.findUnique({
      where: { areaId_name: { areaId, name } },
    });
    if (existing) return res.status(409).json({ message: "Street already exists in this area" });

    const street = await prisma.street.create({ data: { name, areaId } });

    res.status(201).json({ message: "Street created", street });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAreas, createArea, createStreet };