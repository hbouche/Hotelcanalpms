const cron = require('node-cron');
const { getDb } = require('../db/database');
const { notifyReminder } = require('../notifications');
const logger = require('./logger');

// Helper to format Date as YYYY-MM-DD
function getFutureDateString(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
}

/**
 * Automatically find upcoming bookings (1 day and 3 days ahead) and send check-in reminders.
 */
async function checkAndSendReminders() {
  logger.info('⏰ Running scheduled task: checkAndSendReminders');
  try {
    const db = getDb();
    
    // Check-in tomorrow (1 day ahead)
    const tomorrowStr = getFutureDateString(1);
    const tomorrowReservations = db.prepare(
      "SELECT * FROM reservas_hotel WHERE check_in = ? AND estado = 'Confirmada'"
    ).all(tomorrowStr);
    
    logger.info(`🔍 Found ${tomorrowReservations.length} reservations starting tomorrow (${tomorrowStr})`);
    
    for (const res of tomorrowReservations) {
      const room = db.prepare("SELECT * FROM habitaciones WHERE id = ?").get(res.habitacion_id);
      logger.info(`📧 Sending 1-day reminder to guest ${res.cliente} (Reserva #${res.id})`);
      const results = await notifyReminder(res, room, 1);
      logger.info(`📧 1-day reminder results for Reserva #${res.id}: Email=${!!results?.email?.sent}, WA=${!!results?.whatsapp?.sent}`);
    }

    // Check-in in 3 days (3 days ahead)
    const in3DaysStr = getFutureDateString(3);
    const in3DaysReservations = db.prepare(
      "SELECT * FROM reservas_hotel WHERE check_in = ? AND estado = 'Confirmada'"
    ).all(in3DaysStr);

    logger.info(`🔍 Found ${in3DaysReservations.length} reservations starting in 3 days (${in3DaysStr})`);

    for (const res of in3DaysReservations) {
      const room = db.prepare("SELECT * FROM habitaciones WHERE id = ?").get(res.habitacion_id);
      logger.info(`📧 Sending 3-day reminder to guest ${res.cliente} (Reserva #${res.id})`);
      const results = await notifyReminder(res, room, 3);
      logger.info(`📧 3-day reminder results for Reserva #${res.id}: Email=${!!results?.email?.sent}, WA=${!!results?.whatsapp?.sent}`);
    }
  } catch (error) {
    logger.error('❌ Error executing checkAndSendReminders task:', error);
  }
}

/**
 * Automatically check for reservations with check-out date passed that are still marked as checked-in.
 */
async function checkExpiredStays() {
  logger.info('⏰ Running scheduled task: checkExpiredStays');
  try {
    const db = getDb();
    const todayStr = getFutureDateString(0);
    
    const expiredStays = db.prepare(
      "SELECT * FROM reservas_hotel WHERE check_out < ? AND estado = 'Hospedado'"
    ).all(todayStr);
    
    if (expiredStays.length > 0) {
      logger.warn(`⚠️ Found ${expiredStays.length} active stays that exceeded check_out date without checkout recorded.`);
      for (const res of expiredStays) {
        logger.warn(`Stay expired: Reserva #${res.id} for guest ${res.cliente} (checkout: ${res.check_out}) is still in state 'Hospedado'`);
      }
    } else {
      logger.info('✅ No expired active stays detected.');
    }
  } catch (error) {
    logger.error('❌ Error executing checkExpiredStays task:', error);
  }
}

/**
 * Initialize background cron schedules
 */
function startScheduler() {
  // Check reminders every day at 8:00 AM
  const reminderCronSchedule = process.env.REMINDERS_CRON_SCHEDULE || '0 8 * * *';
  
  logger.info(`⏰ Starting Hotel Panamá Canal PMS background scheduler: Reminders scheduled at '${reminderCronSchedule}'`);
  
  cron.schedule(reminderCronSchedule, async () => {
    await checkAndSendReminders();
    await checkExpiredStays();
  });
}

module.exports = {
  startScheduler,
  checkAndSendReminders,
  checkExpiredStays
};
