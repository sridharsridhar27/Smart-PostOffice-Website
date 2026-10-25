const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const areas = [
  { name: "Area A", streets: ["Gandhi Street", "Nehru Street", "Bazaar Street"] },
  { name: "Area B", streets: ["Temple Street", "Main Road", "School Street"] },
  { name: "Area C", streets: ["Station Road", "Market Street", "Lake View Street"] },
];
const deliveryPersons = [
  { name: "Delivery Person 1", email: "dp1@postoffice.com", phone: "9100000001", area: "Area A" },
  { name: "Delivery Person 2", email: "dp2@postoffice.com", phone: "9100000002", area: "Area A" },
  { name: "Delivery Person 3", email: "dp3@postoffice.com", phone: "9100000003", area: "Area B" },
  { name: "Delivery Person 4", email: "dp4@postoffice.com", phone: "9100000004", area: "Area C" },
];

async function main() {
  // Admin
  const hashed = await bcrypt.hash("admin123", 10);
  await prisma.user.upsert({
    where: { email: "admin@postoffice.com" },
    update: {},
    create: {
      name: "Post Office Admin",
      email: "admin@postoffice.com",
      phone: "9000000000",
      password: hashed,
      role: "ADMIN",
    },
  });

  // Areas and streets
  for (const a of areas) {
    const area = await prisma.area.upsert({
      where: { name: a.name },
      update: {},
      create: { name: a.name },
    });

    for (const s of a.streets) {
      await prisma.street.upsert({
        where: { areaId_name: { areaId: area.id, name: s } },
        update: {},
        create: { name: s, areaId: area.id },
      });
    }
  }

  console.log("Seed completed: admin + areas + streets");
    // Delivery persons (password for all: dp1234)
  const dpPassword = await bcrypt.hash("dp1234", 10);

  for (const dp of deliveryPersons) {
    const homeArea = await prisma.area.findUnique({ where: { name: dp.area } });

    await prisma.user.upsert({
      where: { email: dp.email },
      update: {},
      create: {
        name: dp.name,
        email: dp.email,
        phone: dp.phone,
        password: dpPassword,
        role: "DELIVERY",
        homeAreaId: homeArea.id,
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });