# Hospital OS

Real-time patient monitoring for a hospital ward. Hospital OS shows live vital signs, grades each patient by triage level, assigns beds, equipment and staff automatically, and flags unreliable sensor readings.

Built as the Operating Systems course project *Adaptive Medical Trust Device Scheduling Framework for Intelligent Resource Allocation in Critical Care Systems* at Vellore Institute of Technology.

## Features

- **Live Monitor:** vital signs for every monitored patient, updated every 3 seconds, with an activity and alert log.
- **Patients:** admit and discharge patients, attach or remove sensors, start or stop monitoring.
- **Sensors:** live multi-sensor chart with the safe range, per-sensor cards with trend, battery and reliability score.
- **Automatic triage:** each patient is graded Stable, Serious or Critical from their combined readings.
- **Sensor reliability:** every sensor gets a 0–100% score. Low-reliability readings can't escalate a patient to Critical and are logged as low-confidence instead of raising an alarm.
- **Resources:** ICU beds, ventilators, blood units, staff and more are assigned and released automatically as triage changes, with a capacity overview, waiting list and continuous safety check.
- **Shift report:** one-click CSV export of patients, sensors, resources and events.
- **Database:** everything is stored in a local SQLite database (`hospital.db`).

## Running it

Requires [Node.js](https://nodejs.org/) 22.13 or newer. There is nothing to install.

```bash
cd hospital-os-web
npm start          # or: node server.js
```

Then open <http://localhost:3000>.

The database file is created on first run with ten demo patients. To start again from fresh demo data, stop the server and delete `hospital.db`.

Node may print `ExperimentalWarning: SQLite is an experimental feature`. This is expected and harmless.

Opening `index.html` directly (without the server) also works, but data is then kept only in that browser.

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | Page layout: home page, sidebar and dashboard shell |
| `app.js` | Monitoring loop, triage, sensor reliability, resource allocation and all views |
| `styles.css` | Styling |
| `server.js` | Web server and SQLite storage |

## Team

- Aesha Singh (24BCT0156)
- G. Moksha Manaswi (24BCT0232)
- Kalash Krishnaut (24BDS0447)

Under the guidance of Perepi Rajarajeshwari.
