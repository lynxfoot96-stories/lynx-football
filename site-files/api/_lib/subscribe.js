// Newsletter signup logic. Lives in _lib so it does not count as an extra Vercel function (Hobby plan limit: 12).
// It is called from api/scores.js for POST /api/scores?action=subscribe
// Adds the contact to a Brevo list and stores favourites as contact attributes.
// Env vars (Vercel -> Settings -> Environment Variables):
//   BREVO_API_KEY   your Brevo v3 API key (never put it in front-end code)
//   BREVO_LIST_ID   numeric id of the list that triggers the welcome automation
//

function cleanList(v, max) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(function (x) { return typeof x === 'string'; })
    .map(function (x) { return x.replace(/[|\r\n]/g, ' ').trim().slice(0, 60); })
    .filter(Boolean)
    .slice(0, max);
}

// "|Arsenal|Inter Milan|" -> lets a Brevo segment use "contains |Inter Milan|"
// without accidentally matching "Inter" inside another name.
function piped(list) { return list.length ? '|' + list.join('|') + '|' : ''; }

async function handleSubscribe(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  var key = process.env.BREVO_API_KEY;
  var listId = Number(process.env.BREVO_LIST_ID);
  if (!key || !listId) return res.status(500).json({ error: 'not_configured' });

  var b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  if (b.company) return res.status(200).json({ ok: true }); // honeypot: pretend success

  var email = String(b.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  if (b.consent !== true) return res.status(400).json({ error: 'consent_required' });

  var leagues = cleanList(b.leagues, 10);
  var clubs = cleanList(b.clubs, 20);
  var players = cleanList(b.players, 20);

  // Create these attributes once in Brevo (Contacts -> Settings -> Contact attributes):
  //   FAVORITE_LEAGUES (text), FAVORITE_CLUBS (text), FAVORITE_PLAYERS (text),
  //   MATCHDAY_ALERTS (boolean), SIGNUP_SOURCE (text)
  var payload = {
    email: email,
    listIds: [listId],
    updateEnabled: true,
    attributes: {
      FAVORITE_LEAGUES: piped(leagues),
      FAVORITE_CLUBS: piped(clubs),
      FAVORITE_PLAYERS: piped(players),
      MATCHDAY_ALERTS: b.alerts === true,
      SIGNUP_SOURCE: String(b.source || '').slice(0, 100)
    }
  };

  try {
    var r = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    if (r.status === 201 || r.status === 204) return res.status(200).json({ ok: true });
    var detail = await r.text().catch(function () { return ''; });
    console.error('Brevo error', r.status, detail.slice(0, 300));
    return res.status(502).json({ error: 'provider_error' });
  } catch (err) {
    console.error('Brevo request failed', err && err.message);
    return res.status(502).json({ error: 'provider_unreachable' });
  }
}

module.exports = { handleSubscribe };
