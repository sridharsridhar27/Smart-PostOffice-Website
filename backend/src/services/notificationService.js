// client can be prisma or a transaction client (tx)
const createNotification = (client, { userId, parcelId = null, type = "GENERAL", title, message }) => {
  return client.notification.create({
    data: { userId, parcelId, type, title, message },
  });
};

module.exports = { createNotification };