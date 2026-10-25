const prisma = require("../config/prisma");

// GET /api/areas  (public - used for the registration dropdowns)
const getAreas = async (req, res, next) => {
  try {
    const areas = await prisma.area.findMany({
      orderBy: { name: "asc" },
      include: {
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

// POST /api/areas  (admin)
const createArea = async (req, res, next) => {
  try {
    const name = req.body.name?.trim();

    if (!name) {
      return res.status(400).json({ message: "Area name is required" });
    }

    const existing = await prisma.area.findUnique({ where: { name } });
    if (existing) {
      return res.status(409).json({ message: "Area already exists" });
    }

    const area = await prisma.area.create({ data: { name } });

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

    if (!name) {
      return res.status(400).json({ message: "Street name is required" });
    }

    const area = await prisma.area.findUnique({ where: { id: areaId } });
    if (!area) {
      return res.status(404).json({ message: "Area not found" });
    }

    const existing = await prisma.street.findUnique({
      where: { areaId_name: { areaId, name } },
    });
    if (existing) {
      return res.status(409).json({ message: "Street already exists in this area" });
    }

    const street = await prisma.street.create({ data: { name, areaId } });

    res.status(201).json({ message: "Street created", street });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAreas, createArea, createStreet };