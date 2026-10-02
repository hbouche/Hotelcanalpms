const express = require('express');
const router = express.Router();
router.use(require('../integration-policy').requireIntegrations);
const { getDb } = require('../db/database');
const { calcNoches, calcReservationWithRates, getConfig } = require('../utils/calculations');
const logger = require('../utils/logger');

function ok(res, data, meta, status = 200) {
  const response = { success: true, data };
  if (meta) response.meta = meta;
  return res.status(status).json(response);
}

function err(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}

// Kommo CRM Webhook handler
router.post('/kommo', async (req, res) => {
  try {
    const db = getDb();
    const secretRow = db.prepare("SELECT valor FROM config_hotel WHERE clave = 'kommo_webhook_secret'").get();
    const configuredSecret = (secretRow ? secretRow.valor : null) || process.env.KOMMO_WEBHOOK_SECRET;

    if (configuredSecret) {
      const clientSecret = req.query.secret || (req.headers && req.headers['x-kommo-secret']);
      if (!clientSecret || clientSecret !== configuredSecret) {
        return err(res, 'UNAUTHORIZED', 'Invalid or missing webhook secret', 401);
      }
    }

    logger.info('📩 Kommo Webhook received:', JSON.stringify(req.body));

    // 1. Detect lead_id from various possible webhook payload structures of Kommo
    let lead_id = req.query.lead_id || req.body.lead_id;
    if (!lead_id && req.body.leads) {
      if (req.body.leads.status && req.body.leads.status[0]) lead_id = req.body.leads.status[0].id;
      else if (req.body.leads.update && req.body.leads.update[0]) lead_id = req.body.leads.update[0].id;
      else if (req.body.leads.add && req.body.leads.add[0]) lead_id = req.body.leads.add[0].id;
    }
    
    // Fallback: URL encoded parameters like 'leads[status][0][id]'
    if (!lead_id) {
      for (const key in req.body) {
        if (key.includes('leads') && key.includes('[id]')) {
          lead_id = req.body[key];
          break;
        }
      }
    }

    if (!lead_id) {
      return err(res, 'VALIDATION_ERROR', 'No lead_id found in request');
    }

    // 2. Fetch Kommo Config from SQLite Database
    const tokenRow = db.prepare("SELECT valor FROM config_hotel WHERE clave = 'kommo_api_token'").get();
    const subdomainRow = db.prepare("SELECT valor FROM config_hotel WHERE clave = 'kommo_subdomain'").get();
    const enabledRow = db.prepare("SELECT valor FROM config_hotel WHERE clave = 'kommo_enabled'").get();

    const kommoToken = tokenRow ? tokenRow.valor : null;
    const kommoSubdomain = subdomainRow ? subdomainRow.valor : null;
    const kommoEnabled = enabledRow ? enabledRow.valor === '1' : false;

    // 3. Initialize default search values
    let check_in = req.query.check_in || req.body.check_in;
    let check_out = req.query.check_out || req.body.check_out;
    let adultos = req.query.adultos || req.body.adultos;
    let menores = req.query.menores || req.body.menores;
    let mascotas = req.query.mascotas || req.body.mascotas;
    let tipo_habitacion = req.query.tipo_habitacion || req.body.tipo_habitacion;
    let plan_codigo = req.query.plan_codigo || req.body.plan_codigo || 'demo_exp';

    let leadData = null;

    // 4. Fetch details from Kommo API if token is configured
    if (kommoToken && kommoSubdomain) {
      const subdomain = kommoSubdomain.replace(/https?:\/\//, '').split('.')[0];
      const leadUrl = `https://${subdomain}.kommo.com/api/v4/leads/${lead_id}?with=contacts`;
      
      logger.info(`Fetching lead ${lead_id} details from Kommo API...`);
      try {
        const leadResp = await fetch(leadUrl, {
          headers: {
            'Authorization': `Bearer ${kommoToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (leadResp.ok) {
          leadData = await leadResp.json();
          const customFields = leadData.custom_fields_values || [];
          
          for (const field of customFields) {
            const name = (field.field_name || '').toLowerCase().trim();
            const val = field.values && field.values[0] ? field.values[0].value : null;
            if (val === null || val === undefined || val === '') continue;

            if (name === 'pms_check_in' && !check_in) check_in = val;
            else if (name === 'pms_check_out' && !check_out) check_out = val;
            else if (name === 'pms_adultos' && !adultos) adultos = val;
            else if (name === 'pms_menores' && !menores) menores = val;
            else if (name === 'pms_mascotas' && !mascotas) mascotas = val;
            else if (name === 'pms_tipo_habitacion' && !tipo_habitacion) tipo_habitacion = val;
            else if (name === 'pms_plan_codigo' && !plan_codigo) plan_codigo = val;
          }
          logger.info(`Successfully mapped search variables from Lead ${lead_id}: check_in=${check_in}, check_out=${check_out}, adults=${adultos}, roomType=${tipo_habitacion}`);
        } else {
          logger.error(`Kommo API returned error status fetching lead: ${leadResp.status}`);
        }
      } catch (e) {
        logger.error('Failed calling Kommo API to fetch lead details:', e.message);
      }
    }

    // 5. Parse and fallback defaults for pricing
    adultos = parseInt(adultos) || 1;
    menores = parseInt(menores) || 0;
    mascotas = parseInt(mascotas) || 0;

    // Validations
    if (!check_in || !check_out || !tipo_habitacion) {
      const missing = [];
      if (!check_in) missing.push('check_in');
      if (!check_out) missing.push('check_out');
      if (!tipo_habitacion) missing.push('tipo_habitacion');
      const errMessage = `Datos de reserva incompletos. Faltan: ${missing.join(', ')}. Llénalos en la tarjeta e intenta de nuevo.`;
      
      // Post warning note if we have Kommo API access
      if (kommoToken && kommoSubdomain) {
        const subdomain = kommoSubdomain.replace(/https?:\/\//, '').split('.')[0];
        await fetch(`https://${subdomain}.kommo.com/api/v4/leads/${lead_id}/notes`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${kommoToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([{
            note_type: 'common',
            params: { text: `⚠️ Error de Cotización PMS:\n\n${errMessage}` }
          }])
        }).catch(e => logger.error('Error posting validation note:', e.message));
      }

      return err(res, 'VALIDATION_ERROR', errMessage);
    }

    // 6. Find plan in DB
    const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1').get(plan_codigo) ||
                 db.prepare("SELECT * FROM planes_tarifa WHERE codigo = 'demo_exp' AND activo = 1").get();
    
    if (!plan) {
      return err(res, 'PLAN_NOT_FOUND', 'No se encontró ningún plan de tarifa activo en el sistema.');
    }

    // 7. Calculate Pricing
    const noches = calcNoches(check_in, check_out);
    const totals = calcReservationWithRates(plan.id, check_in, check_out, adultos, menores, mascotas);
    const deposito = Math.round(totals.monto_total * 0.5 * 100) / 100;

    // 8. Check Availability
    const activeRooms = db.prepare("SELECT id, categoria FROM habitaciones WHERE tipo = ? AND activa = 1").all(tipo_habitacion);
    let isAvailable = false;
    let availableCount = 0;
    
    if (activeRooms.length > 0) {
      const isPasadia = activeRooms[0].categoria === 'Pasadía';
      const conflicts = isPasadia
        ? db.prepare("SELECT habitacion_id FROM reservas_hotel WHERE estado NOT IN ('Cancelada', 'No-Show', 'Check-Out') AND check_in <= ? AND check_out >= ?").all(check_out, check_in).map(r => r.habitacion_id)
        : db.prepare("SELECT habitacion_id FROM reservas_hotel WHERE estado NOT IN ('Cancelada', 'No-Show', 'Check-Out') AND check_in < ? AND check_out > ?").all(check_out, check_in).map(r => r.habitacion_id);
      
      availableCount = activeRooms.filter(r => !conflicts.includes(r.id)).length;
      isAvailable = availableCount > 0;
    }

    // 9. Sync back to Kommo CRM
    if (kommoToken && kommoSubdomain) {
      const subdomain = kommoSubdomain.replace(/https?:\/\//, '').split('.')[0];
      
      // 9a. Fetch fields metadata to resolve IDs and auto-create missing ones
      let fieldIdTotal = null;
      let fieldIdDeposito = null;
      try {
        const fieldsResp = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/custom_fields`, {
          headers: { 'Authorization': `Bearer ${kommoToken}` }
        });
        if (fieldsResp.ok) {
          const fieldsData = await fieldsResp.json();
          const fieldsList = fieldsData._embedded ? fieldsData._embedded.custom_fields : [];
          
          // Map of existing names to lower case
          const existingNames = new Set(fieldsList.map(f => f.name.toLowerCase().trim()));
          
          // Define target fields that must exist in Kommo CRM
          const targetFields = [
            { name: 'pms_check_in', type: 'date' },
            { name: 'pms_check_out', type: 'date' },
            { name: 'pms_adultos', type: 'numeric' },
            { name: 'pms_menores', type: 'numeric' },
            { name: 'pms_mascotas', type: 'numeric' },
            { name: 'pms_tipo_habitacion', type: 'text' },
            { name: 'pms_plan_codigo', type: 'text' },
            { name: 'pms_total_cotizacion', type: 'numeric' },
            { name: 'pms_deposito_minimo', type: 'numeric' }
          ];

          // Determine which ones are missing
          const missingFields = targetFields.filter(tf => !existingNames.has(tf.name));

          if (missingFields.length > 0) {
            logger.info(`Missing required fields in Kommo CRM: ${missingFields.map(m => m.name).join(', ')}. Creating them automatically...`);
            const createResp = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/custom_fields`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${kommoToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(missingFields)
            });

            if (createResp.ok) {
              logger.info('Custom fields created successfully in Kommo CRM!');
              // Refetch fields list to get the newly generated IDs
              const refetchResp = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/custom_fields`, {
                headers: { 'Authorization': `Bearer ${kommoToken}` }
              });
              if (refetchResp.ok) {
                const refetchData = await refetchResp.json();
                const updatedList = refetchData._embedded ? refetchData._embedded.custom_fields : [];
                for (const f of updatedList) {
                  const fname = f.name.toLowerCase().trim();
                  if (fname === 'pms_total_cotizacion') fieldIdTotal = f.id;
                  if (fname === 'pms_deposito_minimo') fieldIdDeposito = f.id;
                }
              }
            } else {
              const errText = await createResp.text();
              logger.error(`Failed to auto-create custom fields in Kommo: ${createResp.status} - ${errText}`);
            }
          } else {
            // All present, just map the IDs
            for (const f of fieldsList) {
              const fname = f.name.toLowerCase().trim();
              if (fname === 'pms_total_cotizacion') fieldIdTotal = f.id;
              if (fname === 'pms_deposito_minimo') fieldIdDeposito = f.id;
            }
          }
        }
      } catch (e) {
        logger.error('Error fetching/creating custom fields metadata from Kommo:', e.message);
      }

      // 9b. Update custom fields values inside Kommo Lead
      if (fieldIdTotal || fieldIdDeposito) {
        const updateBody = { custom_fields_values: [] };
        if (fieldIdTotal) updateBody.custom_fields_values.push({ field_id: fieldIdTotal, values: [{ value: String(totals.monto_total) }] });
        if (fieldIdDeposito) updateBody.custom_fields_values.push({ field_id: fieldIdDeposito, values: [{ value: String(deposito) }] });

        try {
          logger.info(`Updating lead ${lead_id} fields in Kommo...`);
          const patchResp = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/${lead_id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${kommoToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateBody)
          });
          if (patchResp.ok) logger.info('Lead custom fields updated successfully in Kommo!');
          else logger.error(`Kommo API returned error code updating fields: ${patchResp.status}`);
        } catch (e) {
          logger.error('Failed to update custom fields inside Kommo:', e.message);
        }
      }

      // 9c. Write beautiful ready-to-copy Whatsapp template inside Kommo lead timeline/chat notes
      const availabilityLabel = isAvailable 
        ? `✅ DISPONIBILIDAD CONFIRMADA (${availableCount} libres)` 
        : `❌ SIN DISPONIBILIDAD (No hay libres para estas fechas)`;
      
      const whatsappMsg = `¡Hola! Sí tenemos disponibilidad. 🌴\n\nEl costo total de tu estadía para ${adultos} adultos en habitación ${tipo_habitacion} (Check-in: ${check_in} | Check-out: ${check_out}) en plan ${plan.nombre} con desayuno buffet es de:\n\n💰 Total: $${totals.monto_total} USD (impuestos incluidos)\n💳 Abono sugerido para reservar: $${deposito} USD (50%)\n\n¿Deseas que congele la habitación y te envíe los datos de cuenta para realizar el abono?`;

      const noteText = `🌴 *Cotización Automática Hotel Panamá Canal PMS* 🌴\n\n📅 Estadía: ${check_in} ➔ ${check_out} (${noches} noches)\n🏠 Habitación: ${tipo_habitacion}\n👥 Huéspedes: ${adultos} adultos, ${menores} menores\n📊 Estado: ${availabilityLabel}\n💰 Total: $${totals.monto_total} USD\n💳 Abono Mínimo (50%): $${deposito} USD\n\n---------------------------------\n📋 *MENSAJE LISTO PARA WHATSAPP (COPIAR Y ENVIAR):*\n\n${whatsappMsg}`;

      try {
        logger.info(`Posting chat note to lead ${lead_id} in Kommo...`);
        const noteResp = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/${lead_id}/notes`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${kommoToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([{
            note_type: 'common',
            params: { text: noteText }
          }])
        });
        if (noteResp.ok) logger.info('Note added successfully to lead timeline!');
        else logger.error(`Kommo API returned error code creating note: ${noteResp.status}`);
      } catch (e) {
        logger.error('Failed to create note inside Kommo:', e.message);
      }
    }

    // 10. Return success response
    return ok(res, {
      lead_id,
      check_in,
      check_out,
      noches,
      adultos,
      tipo_habitacion,
      plan: plan.nombre,
      subtotal: totals.subtotal,
      impuesto_monto: totals.impuesto_monto,
      monto_total: totals.monto_total,
      deposito_minimo: deposito,
      disponible: isAvailable,
      unidades_disponibles: availableCount
    });

  } catch (e) {
    logger.error('Error processing Kommo webhook:', e);
    return err(res, 'SERVER_ERROR', 'Error interno del servidor procesando webhook de Kommo', 500);
  }
});

// GET query fallback (so user can manually test or debug in their browser!)
router.get('/kommo', async (req, res) => {
  try {
    const db = getDb();
    const secretRow = db.prepare("SELECT valor FROM config_hotel WHERE clave = 'kommo_webhook_secret'").get();
    const configuredSecret = (secretRow ? secretRow.valor : null) || process.env.KOMMO_WEBHOOK_SECRET;

    if (configuredSecret) {
      const clientSecret = req.query.secret || (req.headers && req.headers['x-kommo-secret']);
      if (!clientSecret || clientSecret !== configuredSecret) {
        return err(res, 'UNAUTHORIZED', 'Invalid or missing webhook secret', 401);
      }
    }
  } catch (e) {
    logger.error('Error validating webhook secret in GET fallback:', e);
    return err(res, 'SERVER_ERROR', 'Error validating webhook secret', 500);
  }

  // Redirect to POST execution context by passing query parameters
  req.body = req.query;
  return router.handle(req, res);
});

module.exports = router;
